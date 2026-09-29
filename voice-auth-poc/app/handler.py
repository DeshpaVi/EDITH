"""Lambda entry points. One image, two functions:
  handler.enrol_handler  - enrol / delete (invoked by hand or script, never by Connect)
  handler.verify_handler - invoked by Connect's Invoke AWS Lambda block (8 s budget)

Logging rule: scores and decisions only. Never audio, never embeddings.
"""
from __future__ import annotations

import io
import json
import logging
import os
import time
import wave
from datetime import datetime, timedelta, timezone
from typing import Any

import boto3
import numpy as np

import embed
import mkv
from scoring import cosine, decide, valid_speaker_id

log = logging.getLogger()
log.setLevel(logging.INFO)

# With provisioned concurrency this runs in the init phase, off the caller's clock, so the first real
# request finds torch imported and the model loaded. Left off for enrol and for tests.
if os.environ.get("PRELOAD_MODEL") == "1":
    embed.encoder()

TELEPHONY_SR = 8000  # what Connect puts in KVS
# The caller's answers are spread through a conversation in which the bot talks most of the time, so read a wide
# window of buffered audio, drop the silence, and score the speech: the first 15 s held only 2-3 s of caller speech.
VERIFY_MAX_RAW_SECONDS = float(os.environ.get("VERIFY_MAX_RAW_SECONDS", "45"))  # cap on raw audio read
VERIFY_LOOKBACK = float(os.environ.get("VERIFY_LOOKBACK", "18"))  # start this many seconds before now; 0 = from the start
VERIFY_READ_BUDGET = float(os.environ.get("VERIFY_READ_BUDGET", "3.5"))  # wall-clock cap on the read (Connect gives 8 s)
VERIFY_SPEECH_CAP = float(os.environ.get("VERIFY_SPEECH_CAP", "20"))  # score at most this much net speech
# Minimum net speech to attempt a score. Below ~2 s an embedding is mostly noise; shorter audio also widens the
# genuine/impostor score spread, so thresholds calibrated on long clips should be re-checked if this is lowered.
VERIFY_MIN_SPEECH = float(os.environ.get("VERIFY_MIN_SPEECH", "2.0"))
_thresholds: dict[str, float] = {}


def _ddb():
    return boto3.resource("dynamodb")


def _retention() -> tuple[str, int]:
    until = datetime.now(timezone.utc) + timedelta(days=int(os.environ["RETENTION_DAYS"]))
    return until.isoformat(), int(until.timestamp())  # ISO for humans, epoch seconds for DynamoDB TTL


def _threshold(name: str) -> float:
    if name not in _thresholds:
        ssm = boto3.client("ssm")
        p = ssm.get_parameter(Name=f"{os.environ['THRESHOLD_PARAM_PREFIX']}/{name}")
        _thresholds[name] = float(p["Parameter"]["Value"])
    return _thresholds[name]


# ------------------------------- enrol -------------------------------------------------


def _read_wav(data: bytes, channel: int | None = None) -> tuple[np.ndarray, int]:
    """Stereo call recordings carry the caller on one channel and other audio (prompts, agent) on the
    other. Averaging them would bake that audio into the voiceprint, so stereo requires an explicit channel."""
    with wave.open(io.BytesIO(data)) as w:
        if w.getsampwidth() != 2:
            raise ValueError("enrolment audio must be 16-bit PCM WAV")
        n = w.getnchannels()
        pcm = embed.pcm16_to_float(w.readframes(w.getnframes()))
        if n > 1:
            if channel is None or not 0 <= channel < n:
                raise ValueError(f"{n}-channel audio: set 'channel' (0..{n - 1}) to the caller's channel")
            pcm = pcm.reshape(-1, n)[:, channel]
        return pcm, w.getframerate()


def enrol_handler(event: dict[str, Any], _ctx: Any = None) -> dict[str, Any]:
    """{"mode":"enrol","speakerId":"spk_0007","consentRef":"...","keys":["enrol/spk_0007/a.wav",...]}
       {"mode":"delete","speakerId":"spk_0007"}
    Stereo clips need "channel": 0 or 1 (the caller's channel).
    Enrolment audio should be recorded over the phone so it matches verification conditions."""
    mode, sid = event.get("mode"), event.get("speakerId", "")
    if not valid_speaker_id(sid):
        return {"ok": False, "error": "speakerId must match spk_[a-z0-9]{4,32} (pseudonymous)"}
    table = _ddb().Table(os.environ["VOICEPRINT_TABLE"])
    s3 = boto3.client("s3")
    bucket = os.environ["ENROL_BUCKET"]

    if mode == "delete":
        table.delete_item(Key={"speakerId": sid})
        deleted = 0
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"enrol/{sid}/"):
            for obj in page.get("Contents", []):
                s3.delete_object(Bucket=bucket, Key=obj["Key"])
                deleted += 1
        log.info(json.dumps({"event": "delete", "speakerId": sid, "audioObjects": deleted}))
        return {"ok": True, "deletedAudio": deleted}

    if mode == "score":
        return _score(table, s3, bucket, sid, event)

    if mode != "enrol":
        return {"ok": False, "error": "mode must be enrol, score or delete"}
    if not event.get("consentRef"):
        return {"ok": False, "error": "consentRef is required: no voiceprint without recorded consent"}
    keys = event.get("keys") or []
    min_clips = int(os.environ.get("MIN_ENROL_CLIPS", "2"))  # skill recommends 3-5; 2 is the POC floor
    if len(keys) < min_clips:
        return {"ok": False, "error": f"need at least {min_clips} clips"}
    prefix = f"enrol/{sid}/"
    if not all(k.startswith(prefix) for k in keys):
        return {"ok": False, "error": f"keys must be under {prefix}"}

    embs = []
    for k in keys:
        try:
            wav, sr = _read_wav(s3.get_object(Bucket=bucket, Key=k)["Body"].read(), event.get("channel"))
        except ValueError as exc:
            return {"ok": False, "error": f"{k}: {exc}"}
        wav = embed.trim_silence(wav, sr)
        if embed.speech_seconds(wav, sr) < embed.MIN_SPEECH_SECONDS:
            return {"ok": False, "error": f"{k}: under {embed.MIN_SPEECH_SECONDS}s of speech after trimming"}
        embs.append(embed.embed(wav, sr))
    voiceprint = embed.average(embs)
    until_iso, until_epoch = _retention()
    table.put_item(
        Item={
            "speakerId": sid,
            "embedding": voiceprint.tobytes(),
            "enrolledAt": datetime.now(timezone.utc).isoformat(),
            "sampleCount": len(embs),
            "consentRef": event["consentRef"],
            "retentionUntil": until_iso,
            "expiresAt": until_epoch,
        }
    )
    log.info(json.dumps({"event": "enrol", "speakerId": sid, "samples": len(embs)}))
    return {"ok": True, "samples": len(embs)}


def _score(table: Any, s3: Any, bucket: str, sid: str, event: dict[str, Any]) -> dict[str, Any]:
    """Offline check of the scoring path: raw cosine of each S3 clip against the stored voiceprint.
    Returns scores only (no embeddings, no decisions); compare them to your thresholds by hand.
    Impostor probes can be any public-dataset clip; genuine probes must NOT be enrolment clips."""
    item = table.get_item(Key={"speakerId": sid}).get("Item")
    if not item:
        return {"ok": False, "error": "not_enrolled"}
    enrolled = np.frombuffer(bytes(item["embedding"]), dtype=np.float32)
    keys = event.get("keys") or []
    if not keys or not all(k.startswith("enrol/") for k in keys):
        return {"ok": False, "error": "keys must be a non-empty list under enrol/"}
    scores: dict[str, Any] = {}
    for k in keys:
        try:
            wav, sr = _read_wav(s3.get_object(Bucket=bucket, Key=k)["Body"].read(), event.get("channel"))
        except ValueError as exc:
            scores[k] = f"error: {exc}"
            continue
        wav = embed.trim_silence(wav, sr)
        if embed.speech_seconds(wav, sr) < embed.MIN_SPEECH_SECONDS:
            scores[k] = "error: insufficient speech"
            continue
        scores[k] = round(float(cosine(embed.embed(wav, sr), enrolled)), 4)
    log.info(json.dumps({"event": "score", "speakerId": sid, "scores": scores}))
    return {"ok": True, "scores": scores}


# ------------------------------- verify ------------------------------------------------


def _result(
    decision: str, score: float | None = None, sid: str = "", reason: str = "", error: bool = False, detail: str = ""
) -> dict[str, str]:
    """Connect attributes are flat strings. Never nest, never return non-strings."""
    return {
        "voiceDecision": decision,
        "voiceScore": "" if score is None else f"{score:.4f}",
        "voiceSpeakerId": sid,
        "voiceReason": reason,
        "voiceError": "true" if error else "false",
        "voiceDetail": detail,
    }


def _read_kvs_pcm(arn: str, fragment: str, info: dict | None = None) -> bytes:
    """Read the most recent VERIFY_LOOKBACK seconds of caller audio (the answers come last in the conversation),
    falling back to 'everything after the start fragment' if the timestamp read fails or returns nothing.
    TODO(verify): SERVER_TIMESTAMP semantics when the start time precedes the stream's first fragment."""
    info = info if info is not None else {}
    kv = boto3.client("kinesisvideo")
    ep = kv.get_data_endpoint(StreamARN=arn, APIName="GET_MEDIA")["DataEndpoint"]
    media = boto3.client("kinesis-video-media", endpoint_url=ep)
    want = int(VERIFY_MAX_RAW_SECONDS * TELEPHONY_SR * 2)  # 16-bit mono
    deadline = time.monotonic() + VERIFY_READ_BUDGET
    selectors = []
    if VERIFY_LOOKBACK > 0:
        selectors.append(
            {"StartSelectorType": "SERVER_TIMESTAMP", "StartTimestamp": datetime.now(timezone.utc) - timedelta(seconds=VERIFY_LOOKBACK)}
        )
    selectors.append({"StartSelectorType": "FRAGMENT_NUMBER", "AfterFragmentNumber": fragment})
    pcm = b""
    for i, selector in enumerate(selectors):
        try:
            resp = media.get_media(StreamARN=arn, StartSelector=selector)
            pcm = mkv.extract_pcm(resp["Payload"], "AUDIO_FROM_CUSTOMER", max_bytes=want, info=info, deadline=deadline)
        except Exception as exc:  # noqa: BLE001 - try the next selector, keep the reason for the log
            info["selector_error"] = type(exc).__name__
            if i == len(selectors) - 1:
                raise
            continue
        info["selector"] = selector["StartSelectorType"]
        if pcm:
            return pcm
    return pcm


def verify_handler(event: dict[str, Any], _ctx: Any = None) -> dict[str, str]:
    """Never raises: an exception would strand the caller. Every failure maps to a decision."""
    sid = ""
    contact = ""
    try:
        contact = event["Details"]["ContactData"]["ContactId"]
        p = event["Details"]["Parameters"]
        sid, arn, frag = p.get("speakerId", ""), p["kvsArn"], p["kvsFragment"]
        if not valid_speaker_id(sid):
            return _finish(contact, _result("failed", sid=sid, reason="bad_speaker_id"))

        item = _ddb().Table(os.environ["VOICEPRINT_TABLE"]).get_item(Key={"speakerId": sid}).get("Item")
        if not item:
            return _finish(contact, _result("failed", sid=sid, reason="not_enrolled"))
        enrolled = np.frombuffer(bytes(item["embedding"]), dtype=np.float32)

        info: dict = {}
        raw = embed.pcm16_to_float(_read_kvs_pcm(arn, frag, info))
        wav = embed.trim_silence(raw, TELEPHONY_SR)[: int(VERIFY_SPEECH_CAP * TELEPHONY_SR)]
        detail = f"{embed.audio_stats(raw, wav, TELEPHONY_SR)} sel={info.get('selector', '?')} stop={info.get('stopped', '?')} blocks={info.get('blocks_selected', '?')}/{info.get('blocks', '?')} tracks={','.join(info.get('tracks', []))}"
        if embed.speech_seconds(wav, TELEPHONY_SR) < VERIFY_MIN_SPEECH:
            return _finish(contact, _result("inconclusive", sid=sid, reason="insufficient_speech", detail=detail))

        score = cosine(embed.embed(wav, TELEPHONY_SR), enrolled)
        decision = decide(score, _threshold("low"), _threshold("high"))
        return _finish(contact, _result(decision, score, sid, detail=detail))
    except Exception as exc:  # noqa: BLE001 - deliberate catch-all, see docstring
        log.error(json.dumps({"event": "verify_error", "type": type(exc).__name__, "contactId": contact}))
        return _finish(contact, _result("failed", sid=sid, reason="error", error=True))


def _finish(contact: str, res: dict[str, str]) -> dict[str, str]:
    log.info(json.dumps({"event": "verify", "contactId": contact, "decision": res["voiceDecision"], "score": res["voiceScore"], "reason": res["voiceReason"], "detail": res["voiceDetail"]}))
    if contact:
        try:
            _, exp = _retention()
            _ddb().Table(os.environ["VERIFICATION_LOG_TABLE"]).put_item(
                Item={
                    "contactId": contact,
                    "speakerId": res["voiceSpeakerId"],
                    "score": res["voiceScore"],
                    "decision": res["voiceDecision"],
                    "reason": res["voiceReason"],
                    "detail": res["voiceDetail"],
                    "timestamp": int(time.time()),
                    "expiresAt": exp,
                }
            )
        except Exception:  # noqa: BLE001 - audit failure must not strand the caller
            log.error(json.dumps({"event": "audit_write_failed", "contactId": contact}))
    return res
