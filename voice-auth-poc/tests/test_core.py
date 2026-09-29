import io
import json
import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
import mkv  # noqa: E402
from scoring import cosine, decide, valid_speaker_id  # noqa: E402


def test_decide_bands_and_boundaries():
    assert decide(0.80, 0.4, 0.7) == "authenticated"
    assert decide(0.70, 0.4, 0.7) == "authenticated"  # high is inclusive
    assert decide(0.55, 0.4, 0.7) == "inconclusive"
    assert decide(0.40, 0.4, 0.7) == "inconclusive"  # low is inclusive
    assert decide(0.39, 0.4, 0.7) == "failed"
    with pytest.raises(ValueError):
        decide(0.5, 0.8, 0.7)


def test_cosine():
    assert cosine([1, 0], [1, 0]) == pytest.approx(1)
    assert cosine([1, 0], [0, 1]) == pytest.approx(0)
    with pytest.raises(ValueError):
        cosine([0, 0], [1, 0])


@pytest.mark.parametrize("sid,ok", [("spk_0007", True), ("+15551234567", False), ("alice", False), ("spk_", False), ("", False)])
def test_speaker_id(sid, ok):
    assert valid_speaker_id(sid) is ok


# ---- synthetic Matroska --------------------------------------------------------------
def vint_size(n):
    return bytes([0x80 | n]) if n < 0x7F else bytes([0x40 | (n >> 8), n & 0xFF])


def el(eid: int, payload: bytes) -> bytes:
    idb = eid.to_bytes((eid.bit_length() + 7) // 8, "big")
    return idb + vint_size(len(payload)) + payload


def track(no, name):
    return el(mkv.TRACK_ENTRY, el(mkv.TRACK_NUMBER, bytes([no])) + el(mkv.TRACK_NAME, name.encode()))


def block(no, data):
    return el(mkv.SIMPLE_BLOCK, bytes([0x80 | no]) + struct.pack(">h", 0) + b"\x80" + data)


UNKNOWN = b"\x01\xff\xff\xff\xff\xff\xff\xff"


def stream(unknown_sizes=False):
    seg_hdr = (b"\x18\x53\x80\x67" + (UNKNOWN if unknown_sizes else b"\x01\x00\x00\x00\x00\x00\x00\x00"))
    tracks = el(mkv.TRACKS, track(1, "AUDIO_TO_CUSTOMER") + track(2, "AUDIO_FROM_CUSTOMER"))
    cluster = el(mkv.CLUSTER, block(1, b"AGENT") + block(2, b"cust") + block(1, b"AGENT") + block(2, b"omer"))
    return seg_hdr + tracks + cluster


def test_selects_track_by_name_not_position():
    assert mkv.extract_pcm(io.BytesIO(stream())) == b"customer"


def test_unknown_size_segment_and_max_bytes():
    assert mkv.extract_pcm(io.BytesIO(stream(True)), max_bytes=6) == b"custom"


def test_truncated_live_tail_is_tolerated():
    assert mkv.extract_pcm(io.BytesIO(stream()[:-4])) == b"cust"


def test_missing_track_fails_loudly():
    with pytest.raises(mkv.MkvError):
        mkv.extract_pcm(io.BytesIO(stream()), track_name="NOPE")
