# Implementation

Build order, with the pieces that are easy to get wrong spelled out. Code here is a
sketch to establish shape and interfaces, not a finished implementation.

## Contents
- [Build order](#build-order)
- [Stage 1: embedding core](#stage-1-embedding-core)
- [Stage 2: Lambda container](#stage-2-lambda-container)
- [Stage 3: KVS reader](#stage-3-kvs-reader)
- [Stage 4: Connect flow](#stage-4-connect-flow)
- [Stage 5: demo](#stage-5-demo)
- [Pitfalls](#pitfalls)

## Build order

| Stage | Deliverable | Proves |
|---|---|---|
| 1 | Local script: two WAVs → similarity score | The model separates voices |
| 2 | Lambda container: enrol + verify from S3 | It runs in AWS |
| 3 | KVS reader: stream ARN → PCM bytes | Live audio is reachable |
| 4 | Connect flow: call in → authenticated | End to end |
| 5 | Demo script with a failure case | It's presentable |

Do not skip stage 1. If the scores don't separate on clean local audio, nothing
downstream will work, and you'll have spent a day on infrastructure to learn it.

## Stage 1: embedding core

```python
# core/embed.py
import torch, torchaudio
from speechbrain.inference.speaker import EncoderClassifier

_enc = None
def encoder():
    global _enc
    if _enc is None:
        _enc = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="/opt/model",           # baked into the image
            run_opts={"device": "cpu"},
        )
    return _enc

def embed(wav: torch.Tensor, sr: int) -> torch.Tensor:
    """wav: 1-D float32 tensor. Returns an L2-normalised 192-d vector."""
    if sr != 16000:
        wav = torchaudio.functional.resample(wav, sr, 16000)
    e = encoder().encode_batch(wav.unsqueeze(0)).squeeze()
    return torch.nn.functional.normalize(e, dim=0)

def score(a: torch.Tensor, b: torch.Tensor) -> float:
    return float(torch.dot(a, b))          # both normalised → cosine similarity
```

Enrolment averages several clips:

```python
def enrol(clips):                           # clips: list[(wav, sr)]
    embs = [embed(w, sr) for w, sr in clips]
    mean = torch.stack(embs).mean(dim=0)
    return torch.nn.functional.normalize(mean, dim=0)
```

Trim silence before embedding — energy-based gating or `webrtcvad`. Silence dilutes the
vector and inflates apparent similarity between different speakers.

**Validate stage 1 like this:** record 4 clips of yourself and 4 of someone else. Enrol on
3 of yours. Score the held-out clip and all of theirs. Your held-out clip should score
clearly higher. If it doesn't, fix that before continuing.

## Stage 2: Lambda container

PyTorch exceeds the 250 MB zip limit, so use a **container image** (up to 10 GB).

```dockerfile
FROM public.ecr.aws/lambda/python:3.12
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir speechbrain numpy boto3 ebmlite webrtcvad
# bake the model in — never download at cold start
COPY model/ /opt/model/
COPY app/ ${LAMBDA_TASK_ROOT}/
CMD ["handler.lambda_handler"]
```

Settings: **memory 3008 MB** (CPU scales with memory; PyTorch is slow at 512 MB),
timeout 60s for the enrol function, 15s for verify. Enable **SnapStart** if it's available
for your runtime, or provisioned concurrency for the verify function — cold starts with
PyTorch run 10-20 seconds and will blow the Connect 8-second budget.

**If cold starts remain a problem, move inference to a SageMaker endpoint** and leave the
Lambda doing only I/O. That is the more robust design for the live path.

## Stage 3: KVS reader

```python
import boto3, io
kv = boto3.client("kinesisvideo")

def read_pcm(stream_arn: str, start_fragment: str, seconds: float = 15.0) -> bytes:
    ep = kv.get_data_endpoint(StreamARN=stream_arn, APIName="GET_MEDIA")["DataEndpoint"]
    media = boto3.client("kinesis-video-media", endpoint_url=ep)
    resp = media.get_media(
        StreamARN=stream_arn,
        StartSelector={
            "StartSelectorType": "FRAGMENT_NUMBER",
            "AfterFragmentNumber": start_fragment,
        },
    )
    # resp["Payload"] is a fragmented MKV byte stream.
    # Parse SimpleBlocks for the AUDIO_FROM_CUSTOMER track and concatenate the PCM.
    # 8 kHz, 16-bit LE mono → 16,000 bytes per second.
    want = int(seconds * 16000)
    return parse_mkv_audio(resp["Payload"], want)
```

Then:

```python
import numpy as np, torch
pcm = read_pcm(arn, frag, seconds=15)
wav = torch.from_numpy(np.frombuffer(pcm, dtype="<i2").astype("float32") / 32768.0)
emb = embed(wav, sr=8000)          # embed() resamples to 16 kHz internally
```

`parse_mkv_audio` is the only fiddly part. `ebmlite` handles the Matroska parsing; the
alternative is a short hand-rolled SimpleBlock reader, since Connect's MKV output is
regular. Read the track metadata rather than assuming track order.

**Test this stage standalone** — invoke the Lambda manually with a stream ARN from a real
call and assert you get sensible PCM (non-silent, correct length) before wiring the flow.

## Stage 4: Connect flow

```
Entry
 └▶ Play prompt          "This call may be recorded. We use voice verification to
                          confirm your identity — say 'agent' at any time to opt out."
 └▶ Start media streaming (customer audio only)
 └▶ Set contact attributes
        kvsArn      ← Media streams → Customer audio stream ARN
        kvsFragment ← Media streams → Customer audio start fragment number
 └▶ Get customer input (Lex)   2-3 questions, ~15s of speech
 └▶ Invoke AWS Lambda  (verifyVoice)
        input:  kvsArn, kvsFragment, speakerId (from ANI lookup or caller-provided ID)
        output: voiceScore, voiceDecision
 └▶ Check contact attributes  on voiceDecision
        ├─ "authenticated" → Set attributes(authLevel=voice) → skip questions → queue
        ├─ "inconclusive"  → OTP step-up → queue
        └─ "failed"/error  → standard agent verification → queue
 └▶ Stop media streaming
```

Lambda returns flat string key/values — Connect contact attributes are strings:

```json
{ "voiceScore": "0.72", "voiceDecision": "authenticated", "voiceSpeakerId": "spk_0007" }
```

**Wire the Lambda error branch to the same place as "failed".** An exception must never
leave a caller stuck — it should fall through to normal verification.

Add the Lambda under Connect console → Flows → AWS Lambda so the invoke permission is set
up properly.

## Stage 5: demo

Script it, and include the parts that fail:

1. **Enrol** — show the 3 recordings and the stored voiceprint (as a vector preview, not
   audio).
2. **Genuine call** — you call in, get authenticated, watch the flow skip security
   questions. Show the score.
3. **Impostor call** — a colleague calls claiming your ID, gets rejected, and lands in
   step-up. **This is the most important slide.** A demo that only succeeds proves
   nothing.
4. **Replay attack** — play a recording of your voice down the line. It will likely pass.
   Show it, then explain why voice is a factor rather than a gate. Being upfront about this
   is far stronger than being asked about it.
5. **Opt-out** — caller declines, gets the standard route with no penalty.

Have the score distribution from stage 1 testing on hand for the inevitable "how accurate
is it?" question. The honest answer is "on N speakers, genuine scored X-Y and impostors
P-Q; that's a pipeline validation, not an accuracy measurement."

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Lambda times out in the flow | Cold start, or waiting for audio in real time | Buffer-then-read; SageMaker endpoint or provisioned concurrency |
| Scores near 1.0 for everyone | Silence dominates the clips, or agent audio is mixed in | VAD trim; stream customer audio only |
| Scores low for the genuine speaker | Enrolment on laptop mic, verification on phone | Re-enrol over the phone |
| `GetMedia` returns nothing | Wrong fragment selector, or the stream hasn't been written yet | Use `AfterFragmentNumber` from the flow attribute; collect speech before invoking |
| Garbled PCM | Wrong track, or endianness | Select `AUDIO_FROM_CUSTOMER`; signed 16-bit little-endian |
| Works locally, fails in Lambda | Model downloading at runtime | Bake the model into the image |
| Attributes empty in the flow | Lambda returned nested JSON or non-strings | Return a flat object of string values |
