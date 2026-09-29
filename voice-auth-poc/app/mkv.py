"""Minimal Matroska reader for Connect's KVS output: pull one named audio track's PCM.

Connect writes fragmented MKV with tracks AUDIO_FROM_CUSTOMER / AUDIO_TO_CUSTOMER. We descend
into the few master elements we need, skip everything else, and select the track by *name*
(never by position). Lacing is not expected; if seen, we fail loudly rather than guess.
"""
from __future__ import annotations

import time
from typing import BinaryIO, Iterator, Optional

# Element IDs (with their length-marker bits, as they appear on the wire).
SEGMENT, CLUSTER, TRACKS, TRACK_ENTRY, BLOCK_GROUP = 0x18538067, 0x1F43B675, 0x1654AE6B, 0xAE, 0xA0
TRACK_NUMBER, TRACK_NAME, SIMPLE_BLOCK, BLOCK = 0xD7, 0x536E, 0xA3, 0xA1
_MASTERS = {SEGMENT, CLUSTER, TRACKS, TRACK_ENTRY, BLOCK_GROUP}


class MkvError(Exception):
    pass


def _read_exact(f: BinaryIO, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = f.read(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf


def _read_id(f: BinaryIO) -> int:
    first = _read_exact(f, 1)[0]
    length = 1
    mask = 0x80
    while length <= 4 and not (first & mask):
        mask >>= 1
        length += 1
    if length > 4:
        raise MkvError("invalid element id")
    return int.from_bytes(bytes([first]) + _read_exact(f, length - 1), "big")


def _read_size(f: BinaryIO) -> Optional[int]:
    """Data size, or None for the reserved 'unknown size' (live streams use it on Segment/Cluster)."""
    first = _read_exact(f, 1)[0]
    length = 1
    mask = 0x80
    while length <= 8 and not (first & mask):
        mask >>= 1
        length += 1
    if length > 8:
        raise MkvError("invalid element size")
    value = first & (mask - 1)
    rest = _read_exact(f, length - 1)
    for b in rest:
        value = (value << 8) | b
    if value == (1 << (7 * length)) - 1:
        return None
    return value


def _elements(f: BinaryIO) -> Iterator[tuple[int, bytes]]:
    """Yield (id, payload) for leaf elements of interest, flattening master elements."""
    while True:
        try:
            eid = _read_id(f)
        except EOFError:
            return
        size = _read_size(f)
        if eid in _MASTERS:
            continue  # descend: children follow inline
        if size is None:
            raise MkvError(f"unknown-size leaf element 0x{eid:X}")
        try:
            payload = _read_exact(f, size)
        except EOFError:
            return  # truncated tail of a live stream: use what we have
        yield eid, payload


def _uint(b: bytes) -> int:
    return int.from_bytes(b, "big")


def _block(payload: bytes) -> tuple[int, bytes]:
    track = payload[0]
    n = 1
    mask = 0x80
    while n <= 8 and not (track & mask):
        mask >>= 1
        n += 1
    track_no = int.from_bytes(bytes([track & (mask - 1)]) + payload[1:n], "big")
    flags = payload[n + 2]
    if flags & 0x06:
        raise MkvError("laced blocks not supported")
    return track_no, payload[n + 3:]


def extract_pcm(
    f: BinaryIO,
    track_name: str = "AUDIO_FROM_CUSTOMER",
    max_bytes: Optional[int] = None,
    info: Optional[dict] = None,
    deadline: Optional[float] = None,
) -> bytes:
    """Concatenate raw payloads of `track_name`, stopping once `max_bytes` is reached.
    `deadline` (a time.monotonic() value) stops reading at the live edge of a stream, which otherwise delivers
    audio only in real time. If `info` is given it is filled with diagnostics (track names, block counts, why
    reading stopped): no audio content."""
    if info is not None:
        info.update(blocks=0, blocks_selected=0, stopped="eof")
    tracks: dict[int, str] = {}
    cur_no: Optional[int] = None
    cur_name: Optional[str] = None
    out = bytearray()

    def flush_track() -> None:
        nonlocal cur_no, cur_name
        if cur_no is not None and cur_name is not None:
            tracks[cur_no] = cur_name
        cur_no = cur_name = None

    for eid, payload in _elements(f):
        if deadline is not None and time.monotonic() > deadline:
            if info is not None:
                info["stopped"] = "deadline"
            break
        if eid == TRACK_NUMBER:
            flush_track()  # a new TrackEntry begins
            cur_no = _uint(payload)
        elif eid == TRACK_NAME:
            cur_name = payload.decode("utf-8", "replace")
            flush_track()
        elif eid in (SIMPLE_BLOCK, BLOCK):
            flush_track()
            no, data = _block(payload)
            if info is not None:
                info["blocks"] += 1
                info["tracks"] = sorted(tracks.values())
            if tracks.get(no) == track_name:
                if info is not None:
                    info["blocks_selected"] += 1
                out += data
                if max_bytes is not None and len(out) >= max_bytes:
                    if info is not None:
                        info["stopped"] = "max_bytes"
                    return bytes(out[:max_bytes])
    if not tracks:
        raise MkvError("no track metadata seen")
    if track_name not in tracks.values():
        raise MkvError(f"track {track_name!r} not found; saw {sorted(tracks.values())}")
    return bytes(out)
