import sys
from pathlib import Path

import boto3
import numpy as np
import pytest
from moto import mock_aws

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
import embed  # noqa: E402
import handler  # noqa: E402

EVENT = {"Details": {"ContactData": {"ContactId": "c-1"}, "Parameters": {"speakerId": "spk_0007", "kvsArn": "arn:x", "kvsFragment": "1"}}}
VP = np.array([1, 0, 0, 0], dtype=np.float32)


@pytest.fixture
def aws(monkeypatch):
    for k, v in dict(AWS_DEFAULT_REGION="us-east-1", AWS_ACCESS_KEY_ID="x", AWS_SECRET_ACCESS_KEY="x", VOICEPRINT_TABLE="vp",
                     VERIFICATION_LOG_TABLE="log", ENROL_BUCKET="enrol-bucket", THRESHOLD_PARAM_PREFIX="/t", RETENTION_DAYS="30").items():
        monkeypatch.setenv(k, v)
    handler._thresholds.clear()
    with mock_aws():
        d = boto3.resource("dynamodb")
        for name, key in (("vp", "speakerId"), ("log", "contactId")):
            d.create_table(TableName=name, KeySchema=[{"AttributeName": key, "KeyType": "HASH"}],
                           AttributeDefinitions=[{"AttributeName": key, "AttributeType": "S"}], BillingMode="PAY_PER_REQUEST")
        ssm = boto3.client("ssm")
        ssm.put_parameter(Name="/t/low", Value="0.4", Type="String")
        ssm.put_parameter(Name="/t/high", Value="0.7", Type="String")
        d.Table("vp").put_item(Item={"speakerId": "spk_0007", "embedding": VP.tobytes()})
        yield d


def stub(monkeypatch, probe, seconds=10):
    monkeypatch.setattr(handler, "_read_kvs_pcm", lambda a, f: b"\x00\x10" * int(8000 * seconds))
    monkeypatch.setattr(embed, "trim_silence", lambda w, sr: w)
    monkeypatch.setattr(embed, "embed", lambda w, sr: np.array(probe, dtype=np.float32))


@pytest.mark.parametrize("probe,decision", [([1, 0, 0, 0], "authenticated"), ([0.55, 0.83, 0, 0], "inconclusive"), ([0, 1, 0, 0], "failed")])
def test_bands(aws, monkeypatch, probe, decision):
    stub(monkeypatch, probe)
    r = handler.verify_handler(EVENT)
    assert r["voiceDecision"] == decision and r["voiceError"] == "false"
    assert all(isinstance(v, str) for v in r.values())  # Connect attributes must be flat strings
    row = aws.Table("log").get_item(Key={"contactId": "c-1"})["Item"]
    assert row["decision"] == decision and "expiresAt" in row and "embedding" not in row


def test_not_enrolled_fails(aws, monkeypatch):
    stub(monkeypatch, [1, 0, 0, 0])
    ev = {"Details": {"ContactData": {"ContactId": "c-2"}, "Parameters": {**EVENT["Details"]["Parameters"], "speakerId": "spk_9999"}}}
    assert handler.verify_handler(ev)["voiceReason"] == "not_enrolled"


def test_too_little_speech_is_inconclusive_not_failed(aws, monkeypatch):
    stub(monkeypatch, [1, 0, 0, 0], seconds=1)
    assert handler.verify_handler(EVENT)["voiceDecision"] == "inconclusive"


def test_never_raises_and_flags_error(aws, monkeypatch):
    monkeypatch.setattr(handler, "_read_kvs_pcm", lambda a, f: (_ for _ in ()).throw(RuntimeError("kvs down")))
    r = handler.verify_handler(EVENT)
    assert r["voiceDecision"] == "failed" and r["voiceError"] == "true"
    assert handler.verify_handler({})["voiceError"] == "true"  # malformed event too


def test_enrol_requires_consent_and_pseudonymous_id(aws):
    assert not handler.enrol_handler({"mode": "enrol", "speakerId": "+15551234567", "consentRef": "c", "keys": []})["ok"]
    r = handler.enrol_handler({"mode": "enrol", "speakerId": "spk_0008", "keys": ["enrol/spk_0008/a.wav"] * 3})
    assert not r["ok"] and "consent" in r["error"]


def test_delete_removes_voiceprint(aws):
    boto3.client("s3").create_bucket(Bucket="enrol-bucket")
    assert handler.enrol_handler({"mode": "delete", "speakerId": "spk_0007"})["ok"]
    assert "Item" not in aws.Table("vp").get_item(Key={"speakerId": "spk_0007"})


def test_stereo_requires_explicit_channel():
    import io, wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(8000)
        left = (np.sin(np.arange(8000) / 5) * 8000).astype("<i2")
        right = np.zeros(8000, dtype="<i2")
        w.writeframes(np.stack([left, right], axis=1).tobytes())
    with pytest.raises(ValueError):
        handler._read_wav(buf.getvalue())
    pcm, sr = handler._read_wav(buf.getvalue(), channel=0)
    assert sr == 8000 and len(pcm) == 8000 and abs(pcm).max() > 0.1
    assert abs(handler._read_wav(buf.getvalue(), channel=1)[0]).max() == 0


def test_enrol_clip_floor(aws):
    r = handler.enrol_handler({"mode": "enrol", "speakerId": "spk_0009", "consentRef": "c", "keys": ["enrol/spk_0009/a.wav"]})
    assert not r["ok"] and "at least 2" in r["error"]


def _wav_bytes(freq, seconds=6, sr=8000):
    import io, wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.sin(np.arange(sr * seconds) * freq) * 8000).astype("<i2").tobytes())
    return buf.getvalue()


def test_score_mode(aws, monkeypatch):
    monkeypatch.setenv("ENROL_BUCKET", "enrol-bucket")
    s3 = boto3.client("s3")
    s3.create_bucket(Bucket="enrol-bucket")
    s3.put_object(Bucket="enrol-bucket", Key="enrol/probe/g.wav", Body=_wav_bytes(0.05))
    s3.put_object(Bucket="enrol-bucket", Key="enrol/probe/short.wav", Body=_wav_bytes(0.05, seconds=1))
    monkeypatch.setattr(embed, "embed", lambda w, sr: np.array([1, 0, 0, 0], dtype=np.float32))
    r = handler.enrol_handler({"mode": "score", "speakerId": "spk_0007", "keys": ["enrol/probe/g.wav", "enrol/probe/short.wav"]})
    assert r["ok"] and r["scores"]["enrol/probe/g.wav"] == 1.0
    assert "insufficient" in r["scores"]["enrol/probe/short.wav"]
    assert not handler.enrol_handler({"mode": "score", "speakerId": "spk_0007", "keys": ["other/x.wav"]})["ok"]
    assert handler.enrol_handler({"mode": "score", "speakerId": "spk_0099", "keys": ["enrol/probe/g.wav"]})["error"] == "not_enrolled"
