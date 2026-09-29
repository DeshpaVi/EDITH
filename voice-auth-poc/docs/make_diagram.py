#!/usr/bin/env python3
"""Generates architecture.svg (no dependencies). Render to PNG with any browser if needed."""
from xml.sax.saxutils import escape as esc

W, H = 1880, 1050
C = dict(eng="#DD344C", comp="#ED7100", stor="#7AA116", db="#3B48CC", sec="#8C4FFF", mgmt="#E7157B", dev="#0A6EBD",
         ink="#232F3E", mute="#5F6B7A", line="#39485C", zone="#F4F6F8", zline="#B8C2CC")
out = []


def add(s):
    out.append(s)


def text(x, y, s, size=13, weight="400", fill=None, anchor="start"):
    fam = "'Segoe UI',Arial,sans-serif"
    add(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill or C["ink"]}" text-anchor="{anchor}">{esc(s)}</text>')


def zone(x, y, w, h, label):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{C["zone"]}" stroke="{C["zline"]}" stroke-dasharray="6 4"/>')
    text(x + 12, y + 20, label, 13, "700", C["mute"])


def box(x, y, w, h, title, lines=(), color="comp", dashed=False, tsize=13):
    d = ' stroke-dasharray="5 4"' if dashed else ""
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#fff" stroke="{C[color]}" stroke-width="1.6"{d}/>')
    add(f'<rect x="{x}" y="{y}" width="7" height="{h}" rx="3" fill="{C[color]}"/>')
    text(x + 18, y + 20, title, tsize, "700")
    for i, l in enumerate(lines):
        text(x + 18, y + 38 + i * 16, l, 11.5, "400", C["mute"])


def arrow(pts, dashed=False, color=None):
    d = "M" + " L".join(f"{px},{py}" for px, py in pts)
    da = ' stroke-dasharray="6 4"' if dashed else ""
    add(f'<path d="{d}" fill="none" stroke="{color or C["line"]}" stroke-width="1.8"{da} marker-end="url(#ah)"/>')


def badge(x, y, n):
    add(f'<circle cx="{x}" cy="{y}" r="11" fill="{C["ink"]}"/>')
    text(x, y + 4, str(n), 12, "700", "#fff", "middle")


add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
add('<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">'
    f'<path d="M0,0 L10,5 L0,10 z" fill="{C["line"]}"/></marker></defs>')
add(f'<rect width="{W}" height="{H}" fill="#fff"/>')
text(30, 38, "Voice authentication POC: AWS architecture", 22, "700")
text(30, 60, "Region us-east-1 · POC scope: consenting voices only · voice is one factor, not the gate", 13, "400", C["mute"])

# ---- runtime ----
text(30, 92, "VERIFICATION CALL (runtime)", 12, "700", C["mute"])
box(30, 430, 150, 70, "Caller", ["Phone (PSTN)", "test number"], "mgmt")
zone(230, 100, 530, 570, "Amazon Connect instance (existing) · flow APFM_Auth_Flow")
blocks = [("Play consent prompt", ""), ("Start media streaming", "customer audio only"),
          ("Set attributes", "kvsArn · kvsFragment · speakerId"), ("Get customer input", "asks name / address"),
          ("Invoke Lambda  verify:live", "synchronous, 8 s limit"),
          ("Check voiceDecision", "authenticated / inconclusive / failed"),
          ("Play result, then disconnect", "or transfer to APFM_Flow")]
by = [135 + i * 64 for i in range(7)]
for (t, s), y in zip(blocks, by):
    box(250, y, 290, 50, t, [s] if s else [], "eng")
for y in by[:-1]:
    arrow([(395, y + 50), (395, y + 64)])
box(590, 300, 150, 100, "Amazon Lex V2", ["APFM_Auth_Bot", "TestBotAlias", "keeps the caller", "talking"], "eng")

box(830, 110, 330, 120, "Kinesis Video Streams",
    ["Live media streaming (existing config)", "prefix vmail-connect-win-demo-manual-contact-",
     "customer audio, 8 kHz PCM · 1 h retention", "key aws/kinesisvideo"], "comp")
zone(810, 260, 370, 330, "AWS Lambda · 3008 MB")
box(830, 290, 330, 280, "voice-auth-poc-verify : live", [
    "container image · provisioned concurrency = 1",
    "model preloaded at init (off the caller's clock)",
    "", "a  GetMedia: last ~18 s of caller audio",
    "b  parse MKV, pick AUDIO_FROM_CUSTOMER",
    "c  trim silence (energy gate)",
    "d  ECAPA-TDNN embedding (192-d)",
    "e  cosine vs enrolled voiceprint",
    "f  band: high / middle / low",
    "g  audit row: score + decision only",
    "", "returns flat string attributes:",
    "voiceDecision · voiceScore · voiceReason",
    "never raises: errors map to 'failed'"], "comp")

zone(1210, 100, 370, 570, "Data, config and security")
box(1240, 140, 310, 90, "DynamoDB  voiceprints",
    ["speakerId → 192-d embedding", "KMS encrypted · TTL expiresAt · no PITR"], "db")
box(1240, 260, 310, 90, "DynamoDB  verification-log",
    ["contactId, score, decision, reason", "no audio, no embeddings · TTL"], "db")
box(1240, 380, 310, 90, "SSM Parameter Store",
    ["/voice-auth-poc/threshold/high  0.60", "/voice-auth-poc/threshold/low   0.35"], "mgmt")
box(1240, 500, 310, 60, "AWS KMS (customer key)", ["encrypts bucket, tables, ECR"], "sec")
box(1240, 580, 310, 70, "Amazon CloudWatch Logs",
    ["Lambda + CodeBuild · 30-day retention", "scores and decisions only"], "mgmt")

# runtime arrows
arrow([(180, 465), (230, 465)]); badge(205, 452, 1)
arrow([(540, 224), (580, 224), (580, 170), (830, 170)]); badge(690, 158, 2)
arrow([(540, 352), (590, 352)]); badge(565, 340, 3)
arrow([(540, 416), (830, 416)]); badge(690, 404, 4)
arrow([(995, 230), (995, 290)]); badge(1013, 245, 5)
arrow([(1160, 330), (1200, 330), (1200, 185), (1240, 185)]); badge(1200, 250, 6)
arrow([(1160, 378), (1220, 378), (1220, 305), (1240, 305)]); badge(1222, 340, 7)
arrow([(1160, 425), (1240, 425)])
arrow([(830, 480), (540, 480)]); badge(690, 468, 8)

# ---- enrolment ----
text(30, 712, "ENROLMENT (run by hand)", 12, "700", C["mute"])
box(30, 770, 150, 70, "You (admin)", ["upload clips,", "invoke enrol"], "mgmt")
box(250, 755, 250, 100, "S3  enrolment bucket",
    ["enrol/spk_0001/*.wav", "SSE-KMS · 30-day lifecycle", "no versioning · public access off"], "stor")
box(830, 730, 330, 130, "voice-auth-poc-enrol",
    ["same image · 300 s timeout", "mode enrol: needs consentRef,", "  averages clips into one voiceprint",
     "mode score: raw scores only", "mode delete: voiceprint + audio"], "comp")
box(1240, 755, 310, 100, "DynamoDB  voiceprints", ["(same table as above)"], "db", dashed=True)
arrow([(180, 805), (250, 805)]); badge(215, 793, "A")
arrow([(500, 805), (830, 805)]); badge(665, 793, "B")
arrow([(1160, 805), (1240, 805)]); badge(1200, 793, "C")

# ---- build ----
text(30, 905, "BUILD AND DEPLOY", 12, "700", C["mute"])
box(250, 930, 230, 80, "S3  build source", ["source.zip", "(Dockerfile + app/)"], "stor")
box(540, 930, 250, 80, "AWS CodeBuild", ["docker build, model baked in", "push, prints image digest"], "dev")
box(850, 930, 250, 80, "Amazon ECR", ["voice-auth-poc/scorer", "KMS encrypted · scan on push"], "comp")
box(1240, 930, 310, 80, "AWS CloudFormation",
    ["3 stacks: foundation · compute · image-build", "IAM roles: one per function, least privilege"], "mgmt")
arrow([(480, 970), (540, 970)]); badge(510, 958, "a")
arrow([(790, 970), (850, 970)]); badge(820, 958, "b")
arrow([(975, 930), (975, 860)]); badge(993, 895, "c")
text(1010, 902, "image digest → verify and enrol", 11.5, "400", C["mute"])

# ---- legend ----
lx = 1610
text(lx, 118, "Verification call, step by step", 14, "700")
steps = ["1  Caller dials the test number.", "2  Flow plays the consent notice and",
         "    starts streaming caller audio.", "3  Lex bot asks for name and address so",
         "    the caller speaks continuously.", "4  Flow invokes Lambda verify:live",
         "    (kvsArn, kvsFragment, speakerId).", "5  Lambda reads the latest ~18 s of",
         "    caller audio from Kinesis.", "6  Loads the voiceprint (DynamoDB).",
         "7  Scores it against the thresholds", "    (SSM) and writes the audit row.",
         "8  Returns the decision; the flow", "    branches on it."]
for i, s in enumerate(steps):
    text(lx, 146 + i * 20, s, 12.5)
text(lx, 460, "Not built (out of POC scope)", 14, "700")
for i, s in enumerate(["• Anti-spoofing / replay detection", "• SMS one-time-code step-up",
                       "• SageMaker endpoint (warm Lambda", "   is used instead)",
                       "• Amazon Transcribe liveness check"]):
    text(lx, 488 + i * 20, s, 12.5, "400", C["mute"])
text(lx, 620, "Colour key", 14, "700")
for i, (k, n) in enumerate([("eng", "Customer engagement"), ("comp", "Compute"), ("stor", "Storage"),
                            ("db", "Database"), ("mgmt", "Management / integration"), ("sec", "Security"),
                            ("dev", "Developer tools")]):
    add(f'<rect x="{lx}" y="{636 + i * 22}" width="14" height="14" rx="3" fill="{C[k]}"/>')
    text(lx + 22, 648 + i * 22, n, 12.5)
add("</svg>")
open("architecture.svg", "w").write("\n".join(out))
print("wrote architecture.svg")
