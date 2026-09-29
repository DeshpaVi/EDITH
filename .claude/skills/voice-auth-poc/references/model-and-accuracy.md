# Model, Scoring and Accuracy

## Contents
- [How speaker verification works](#how-speaker-verification-works)
- [Model choice](#model-choice)
- [Scoring and thresholds](#scoring-and-thresholds)
- [The 8 kHz problem](#the-8-khz-problem)
- [Enrolment protocol](#enrolment-protocol)
- [Testing with few speakers](#testing-with-few-speakers)
- [Spoofing](#spoofing)

## How speaker verification works

A speaker embedding model converts a few seconds of speech into a fixed-length vector
(a "voiceprint") that captures voice characteristics rather than words. Two clips from the
same person land close together in that vector space; clips from different people land
further apart.

Verification is then just:

```
score = cosine_similarity(embedding(new_audio), stored_embedding)
decision = score >= threshold
```

This is **text-independent**: the caller can say anything. No passphrase needed, which is
what made Voice ID feel seamless.

Terms worth using correctly in front of stakeholders:
- **Verification (1:1)** — "is this the person they claim to be?" This is what you're
  building.
- **Identification (1:N)** — "who is this out of N enrolled people?" Much harder, and
  accuracy degrades as N grows.

## Model choice

| Model | Licence | Size | Notes |
|---|---|---|---|
| **SpeechBrain ECAPA-TDNN** (`spkrec-ecapa-voxceleb`) | Apache 2.0 | ~80 MB | Recommended. 192-d embeddings, strong published accuracy, clean Python API, no gated download. |
| Resemblyzer (GE2E) | MIT | ~17 MB | Lighter, older, less accurate. Fine if size matters. |
| pyannote embedding | MIT, gated | ~17 MB | Requires a Hugging Face token and licence acceptance — friction in CI. |
| NVIDIA TitaNet (NeMo) | Apache 2.0 | ~100 MB+ | Excellent, but NeMo is a heavy dependency. |
| WeSpeaker / 3D-Speaker | Apache 2.0 | varies | Good, includes some 8 kHz-friendly variants worth checking. |

Go with **ECAPA-TDNN** for the POC: best accuracy-to-friction ratio, and the SpeechBrain
API is three lines.

```python
from speechbrain.inference.speaker import EncoderClassifier
encoder = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb")
emb = encoder.encode_batch(waveform_16k)   # → (1, 1, 192)
```

**Bake the model into the container image.** Do not download from Hugging Face at cold
start — it adds seconds, and it makes the function fail when HF is unreachable.

## Scoring and thresholds

Cosine similarity ranges -1 to 1; in practice same-speaker pairs cluster high and
different-speaker pairs cluster lower, with an overlap region that determines your error
rates.

Two error types, always in tension:

- **FAR (false accept)** — an impostor passes. Security failure.
- **FRR (false reject)** — the genuine caller fails. Experience failure.
- **EER** — the threshold where the two are equal. A useful single number for comparing
  models, but a poor choice for production, where FAR usually matters more.

**Use three bands, not two.** A binary pass/fail forces you to choose between annoying
genuine callers and admitting impostors. Three bands lets the middle go to step-up:

| Band | Action |
|---|---|
| score ≥ high threshold | Authenticated — skip security questions |
| low ≤ score < high | Inconclusive — step up (OTP, or agent verification) |
| score < low threshold | Not authenticated — full standard verification |

Do not hardcode the thresholds. Put them in SSM Parameter Store so they can be tuned
without redeploying, and log every score so the distribution can be reviewed later.

**Do not copy threshold values from a blog post.** They depend on the model, the audio
channel, and the population. Derive yours from your own data as described below.

## The 8 kHz problem

This is the single biggest technical risk, and the one most likely to make a demo
underwhelm.

Published speaker-verification benchmarks (~1% EER for ECAPA-TDNN on VoxCeleb) are
measured on **16 kHz wideband** audio. Telephony is **8 kHz narrowband**, which discards
everything above ~4 kHz — a large part of the spectral detail these models rely on. Expect
materially worse accuracy over a phone line. Treat the published figures as an upper bound
you will not reach.

Mitigations, in order of impact:

1. **Match enrolment and verification channels.** Enrol over the phone if verification
   happens over the phone. Mismatched channels are the most common cause of a POC that
   "works on my laptop" and fails on a call.
2. **Use more speech.** 15-20 seconds beats 10. The buffer-then-read design makes this
   cheap.
3. **Average multiple enrolment clips** (3-5 separate recordings) into one voiceprint.
   This is the single easiest accuracy win.
4. **Check for an 8 kHz-trained variant** of whichever model you choose before assuming
   upsampling is the only option.

Upsampling 8 → 16 kHz is required to match the model's input shape. It does not restore
the missing information, and it is not a fix.

## Enrolment protocol

Keep it consistent, or scores become noise:

- 3-5 clips per speaker, recorded on separate occasions if possible.
- 30+ seconds of net speech per clip (excluding silence). Voice ID used 30s for a reason.
- Same channel as verification (phone).
- Natural speech, not a fixed phrase — the model is text-independent, and varied content
  generalises better.
- Store the **average** of the clip embeddings, L2-normalised, as the voiceprint.
- Record how many clips were averaged (`sampleCount`) so quality is traceable.

Trim silence before embedding (simple energy-based VAD, or `webrtcvad`). Silence dilutes
the embedding.

## Testing with few speakers

Three voices cannot produce a meaningful FAR/FRR. Be honest about that, and design the
test to show what it *can* show:

1. **Genuine trials** — each speaker verified against their own voiceprint, multiple
   separate recordings. Expect high scores. Any low score here is a red flag.
2. **Impostor trials** — each speaker against every *other* speaker's voiceprint. With 4
   speakers that's 12 impostor pairs. Expect clearly lower scores.
3. **Plot the two distributions.** The gap between them is the result. If they overlap on
   a handful of speakers, they will overlap far worse at scale.
4. **Add a public dataset for volume** if a defensible number is needed: VoxCeleb1 test
   pairs, downsampled to 8 kHz to mimic telephony, gives hundreds of trials and a real EER
   estimate.

Report it as: "on N speakers and M trials, genuine scores ranged X-Y and impostor scores
ranged P-Q." Never report a single accuracy percentage from a handful of samples.

## Spoofing

**A recording of the enrolled voice will pass.** The model compares voice characteristics;
it has no notion of whether the audio came from a live person.

Three attack classes, all realistic in 2026:
- **Replay** — a recorded clip played down the line.
- **TTS cloning** — a synthetic voice built from seconds of sample audio, widely available.
- **Conversion** — an attacker's live speech converted to the target's voice.

Voice ID shipped spoofing detection. A DIY build has none, and building credible
anti-spoofing is a research project, not a sprint.

What to do about it:
- **Never let voice be the only factor** for anything with financial or account-control
  consequences.
- **Pair it with something the attacker doesn't have**: a device/ANI signal, an OTP, a
  knowledge factor.
- **Use it to reduce friction, not to grant access.** "Skip two security questions" is a
  defensible use. "Reset the password" is not.
- Say this explicitly in the demo. Someone will ask, and having the answer ready is much
  better than being caught out.
