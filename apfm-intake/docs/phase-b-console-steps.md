# Phase B: console exercise 1

**Goal:** find out, with no Lambda and no real data, whether a Generative Journey agent
reliably calls a tool after each captured answer, and what that costs per turn on a voice
call. Everything here is configured by hand in the ACXD workspace and Connect console.

**Use fake caller details only.** Nothing in this phase should contain a real person's data.

Labels below come from the AWS ACXD pages for Flows, Nodes, Generative Journey, Data
requests, Slots and Secrets. I have not read the Applications and Connect-block pages
directly (labels there come from our migration skill notes), so if a label differs on your
screen, use what you see and tell me.

---

## B1. Slots (Resources > Slots)

Create four custom slots. Add the values, and for each value add the synonyms shown
(Expand a value > Add synonym). Keep **Sensitive** off for these four.

| Slot name | Values | Example synonyms |
|---|---|---|
| `CallerFor` | SELF, RELATIVE, COUPLE, OTHER | SELF: me, myself. RELATIVE: mom, dad, parent, wife, husband. COUPLE: both of us. OTHER: friend, client, patient |
| `BenefitType` | HOUSING, VETERAN, BOTH, OUT_OF_SCOPE | HOUSING: assisted living, memory care, somewhere to live. VETERAN: VA benefits, Aid and Attendance. OUT_OF_SCOPE: Medicaid, Medicare |
| `CareLevel` | ASSISTED, MEMORY, INDEPENDENT | ASSISTED: bathing, meds. MEMORY: dementia, wandering. INDEPENDENT: mostly independent |
| `MoveTimeline` | URGENT, 1_MONTH, 3_MONTHS, EXPLORING | URGENT: asap, this week. 1_MONTH: next month. 3_MONTHS: a few months. EXPLORING: just researching |

Phone and city use **built-in** slots chosen in B3 (built-in Phone number, and Freeform
text for city; a built-in city type was not documented, so we do not assume one).

## B2. Data request (Resources > Data requests > New data request)

1. Name: `SaveIntakeField`. Description: "Silently records one captured intake answer.
   Result is not needed for the conversation."
2. **Implementation:** Static.
3. **Request model** (these are the fields the agent will fill):
   - `action` (String)
   - `conversation_id` (String)
   - `field` (String)
   - `value` (String)
   - `evidence_quote` (String)
4. **Response model:** `saved` (Boolean).
5. **Static response:** `{"saved": true}`.
6. Settings: leave **Send context** on. Do not mark it Sensitive for this exercise.
7. Select **Test**, run it, and confirm it returns `saved: true`. Save.

## B3. Flow (Resources > Flows > New flow)

1. Name: `IntakePOC` (no spaces). Create flow.
2. **Settings > Attached slots > Attach new slot** (repeat, save at the end):
   `CallerFor`, `BenefitType`, `CareLevel`, `MoveTimeline` (custom), built-in **Phone
   number** named `Phone`, built-in **Freeform text** named `City`.
3. On the Canvas add: **Generative Journey** node, then **Basic** node, then **Exit
   application** node. Connect Start to the Journey.
4. Rename the Journey node `IntakeJourney`.

### Journey node settings

- **Data capture:** required slots `CallerFor`, `BenefitType`, `Phone`, `City`,
  `CareLevel`, `MoveTimeline`. Turn **Exit upon completion** on.
- **Tools:** add Data request `SaveIntakeField`. Tool inputs:
  - `action`: **Explicit text** = `save_field`
  - `conversation_id`: **Variable** = `{System.conversationId}`
  - `field`, `value`, `evidence_quote`: **LLM prompt**
  - Interim message: leave **empty** (we want to measure the raw pause first).
  - Tool prompt:
    ```
    Call this after you capture any answer, without telling the caller and without
    pausing the conversation. field is one of: caller_for, benefit_type, phone, city,
    care_level, move_timeline. value is what you captured. evidence_quote is the
    caller's exact words. Ignore the result completely: it must never change what you
    say or ask next. If the caller changes an earlier answer, call it again for that field.
    ```
- **Exit conditions** (each connected to the next node): `Caller asked for a person`
  (connect to an **Escalate** node with message "Connecting you to an advisor now."),
  and the automatic completion path (connect to the Basic node).
- **Failure** and **Timeout** paths: connect both to the same Escalate node.
- **Settings:** pick the lowest-latency model offered. Max steps: 3. Set a sensible Timeout.
- **Prompt:**
  ```
  You are a warm, patient intake assistant for a senior living referral service.
  Collect these details through natural conversation, one question at a time, using
  open questions. Never read out a list of options. If the caller gives several
  answers in one sentence, accept them all and do not re-ask.
  Details: who the search is for; what kind of support they want (housing, veteran
  benefits, or both); a callback phone number; the city they are in; the level of
  help needed day to day; how soon they want to move.
  After each answer, use the SaveIntakeField tool as described in its instructions.
  Never mention the tool, never mention confidence, and never repeat or confirm an
  answer unless it is genuinely unclear. Do not give medical, legal, pricing or
  eligibility advice. If the caller asks for a person, use the "Caller asked for a
  person" exit. Finish when every detail has been captured.
  ```
  (This prompt is for the exercise only. Compliance wording is not included and will come
  from APFM later.)
- Basic node message: "Thanks, I have what I need." Then Exit application.
- **Validation** (toolbar): resolve any red items. **Save.**

## B4. Application, build and deploy

1. **Applications:** create `APFM-Intake-POC` (or use an existing sandbox app), attach
   flow `IntakePOC`, and set it as the Welcome flow if there is a default-behaviour setting.
   Attach the Escalation behaviour to an Escalate-ending flow if the app requires one.
2. Open the application > **Deploy** tab > environment **development** > **Build &
   deploy**. Fix any critical (red) validation errors, add a changelog line, **Build**.
3. When the build is **BUILT**, hover its status and choose **Deploy**. Wait for **Live**.

## B5. Chat test (Canvas **Test** widget)

Run each script and fill the table in B8. Look in the test widget's troubleshooting/trace
view for whether `SaveIntakeField` was called and with what arguments.

| # | You say (in order, one reply per question) |
|---|---|
| 1 | "It's for my mom" / "assisted living" / "415 555 0132" / "Dallas, Texas" / "she needs help with bathing" / "next month" |
| 2 | **One sentence:** "My mom's getting forgetful and we're in Tampa" then answer the rest |
| 3 | Answer "me", then later say "actually it's for my dad" |
| 4 | Answer vaguely: "not sure" / "I'm a veteran" / "four one five double five oh one three two" / "Columbus" / "some help, not sure" / "a few months" |
| 5 | Say "I want to speak to someone right now" mid-way |

## B6. Minimal Connect flow for the voice test

1. Create a contact flow: **Set voice** (choose a voice) then the **Agentic CX** block.
2. Block settings: your workspace, application `APFM-Intake-POC`, alias **Development**.
   Turn **Audio filler** on only after the first timing run (see B7). Pick the speech
   recognition engine manually.
3. Connect **Escalation**, **Error** and **Timeout** each to **Disconnect** for now.
   (Routing to queues is phase E.)
4. Save and publish. Attach the flow to a test phone number.

## B7. Voice test and timing

Place at least two calls with script 1 and script 2.

- For each answer, note the pause between you finishing and the assistant's next words
  (a phone stopwatch is fine; record the call if your policy allows, and use fake data).
- **Baseline:** open `IntakeJourney`, remove the `SaveIntakeField` tool, save, build,
  deploy, and repeat script 1. The difference between the two runs is the cost of the tool call.
- Then put the tool back and run once with an interim message and once with Audio filler on,
  to see which one hides the pause best.

## B8. What to send back to me

| Question | Your finding |
|---|---|
| Does the agent call the tool after every captured answer? (count calls vs answers, scripts 1 to 5) | |
| Are `field` names exactly the six allowed strings, and is `evidence_quote` the caller's real words? | |
| Script 2: does one sentence fill several fields and trigger several calls? | |
| Script 3: is a changed answer saved again? | |
| Does the agent ever mention or react to the tool? | |
| Median pause per answer, with tool vs baseline (seconds) | |
| Did interim message or audio filler help? | |
| Is a per-turn ASR confidence or the raw transcript visible anywhere (trace, conversation history)? | |
| Does the live transcript appear in Connect (Contact Lens real-time) for ACXD turns? | |
| Does the trace show the `ani`/caller number anywhere (System.userId is the phone number on voice per the docs)? | |
| Any label or step that differed from this guide | |

**Decision after this exercise (proposed, adjust if you disagree):**
the silent tool call stays our approach if the tool is called for at least about 90% of
captured answers and the added pause is acceptable to you. If calls are skipped or the pause
is too long, we switch to the fallback: one scoring call after the Journey with the full
transcript (`{System.transcript}`), or the live-transcript option if B8 shows it exists.
