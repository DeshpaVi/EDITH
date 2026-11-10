# Reading a customer journey from a deck, PDF, diagram or image: lessons

Learned reading the Census CQA deck (a `.pptx` call-flow diagram) through the JourneyForge extractor with several different models. They apply to every
source format (PowerPoint, Visio, Word, PDF, images, text) and every model. Use this as a checklist when adding a format or changing a prompt.

## 1. Remove the noise deterministically, before any model sees it
A model will turn anything it is shown into a step. Do the cleanup in the file reader (plain code, testable), not in the prompt:
- **Legends:** the box titled "Legend" and its sample shapes ("Start", "Settings", "Announcements", "Lambda", "Separate Flow", "Prompts / Input") explain colours; they are not part of the flow. Give the model the colour meanings, not the sample shapes. (Done for `.pptx`; do the same for Visio, and for PDFs and images tell the model in the rules.)
- **Other non-flow content to consider dropping or labelling:** slide titles and page numbers, footers and headers, speaker notes, copyright lines, "draft" watermarks, off-slide shapes, hidden slides.
- **Start and end markers** ("Incoming Call", "Start") say nothing to the caller: they are where the journey begins, not steps with wording.
- Keep everything a person must copy verbatim: prompts, disclosures, consent language, branch labels.

## 2. Tell every model what each kind of step must contain
- Weaker models fill only fields marked `required` in the schema. Put the fields each step kind needs in the system prompt and in each property's `description` ("REQUIRED and non-empty for greeting, announcement, ...").
- Do not require every kind-specific field of every step: that invites invented text. Flat optional fields plus descriptions plus a strict validator works.
- Never give a spoken kind (greeting, announcement, confirmation, intent_capture, authentication, closing) to a shape that has no wording.

## 3. Make the model's mistakes repairable
- The extractor validates the answer and asks the model to repair it (up to 3 times). A bare "must be a non-empty string" is not enough: add a one-line fix hint per field ("put the exact words spoken to the caller, copied from the source").
- Duplicate ids: one step per shape; several arrows to the same shape are several edges to one step.
- Every "unmapped" item needs a source ("slide 1, shape 69", or "source not identified").
- **Send the model its previous answer with the problems**, and say "change only what the problems require". Without it each repair re-reads the source from scratch and the errors move around between rounds instead of shrinking.
- Terminal steps (end, transfer) have `next: []`, never a missing field; an edge target must be a step id (add an `end` step; never point to the word "end"). The pipeline does not patch the model's answer, with one recorded exception: a missing `next` on an `end` or `escalation` step (terminal by definition) is treated as `[]` and noted in `assumptions`, because models omit it however often they are told. A missing `next` on any other kind stays an error (it could be a dropped edge). When a rule plus a hint plus a repair round still do not change a model's habit, add a narrow, recorded normalisation rather than failing the read.
- Show the consultant the validation result, not a silent guess. Unmapped content stays visible as review items.

## 4. Different models fail differently: make the extractor tolerant, and measure
- Models differ on: forced tool choice, the `temperature` field, maximum output tokens, reasoning blocks, text-only input, Marketplace subscription, and account restrictions. Each is handled in the extractor (see deployment-lessons.md).
- `DEBUG_SHAPE=1` logs which fields each step has or leaves empty (names only, never content). Use it to see what a model omits before changing a prompt.
- A good test source is a real deck with a legend, start markers, loops back to earlier steps, branch labels as separate text boxes, and shapes reached from several arrows (the Census deck has all of these). Keep it as the regression fixture for every reader change.

## 4b. A journey that validates can still break the next stage
- The checklist builder crashed on a valid journey whose escalation lists no hand-over context ("requires unknown item acxd.contextVariable.customerIntent"). Baseline items that other items rely on (the safety flow's hand-back variables, the escalation flow after authentication, `stuckPoint`) must be created whatever the journey says, and a test must build the checklist and the bundle from sparse variants of the real journey (empty lists, missing optional fields, no escalation, no authentication).
- Never swallow an error after a successful read: show it, keep the journey, and offer it for download so it can be reproduced. A silent "nothing happened" cost a round trip.

## 4c. What a real model reading of the Census deck got wrong even when the answer validated (Nova Pro)
Comparing the extracted journey with the hand-made one (their checklists and their generated bundles) showed what a schema cannot catch. Each is now a deterministic check in the browser (`extract/semantic.ts`) that sends the finding back to the model with its previous answer:
- **A start marker became the greeting.** "Incoming Call" was given as spoken wording, so the generated main flow would have greeted callers with "Incoming Call".
- **Diagram titles inside prompts.** Shapes read "Main Greeting: Thank you for calling...", "Authentication: To proceed...", "Intent Failure: I'm sorry...". The title is the diagram's name for the shape, not spoken wording. Detect the convention (most spoken steps follow it) before treating it as a title; a genuine "Note: this call is recorded" is wording and must be kept whole.
- **Shapes silently dropped** ("Set es_US", the enumeration self-service box): in neither a step nor `unmapped`. Check every non-legend shape with text is cited as `slide N, shape M` somewhere. Skip the check when the model cites no shape numbers at all.
- On the last attempt keep the journey and record the findings as review entries ("Reader check: ..."), so the read is not lost and nothing is hidden.
- **What the deck does not say stays unknown, by design.** The model set the authentication backend and the FAQ content source to "unknown", so no authentication flow, DynamoDB table or Lambda was generated and two blockers appeared. The consultant's **Notes** box supplies such facts ("records live in DynamoDB; any one identifier is enough; FAQ answers come from a knowledge base").
- Granularity differs: a model gives one step per shape while a person groups related shapes. Compare checklists and bundles, not step lists.
- **A check that asks the model to ADD things can break an answer that was fine.** The shape-coverage check flagged a narrative text box on slide 2 (not a flow); the model added a batch of steps without `next` and the whole read failed. Rules learned: apply coverage only to slides that contain arrows; tell the model what a new step must contain; and keep the best valid reading so far, falling back to it (with the open findings as "Reader check" entries) if a later repair makes the structure invalid. A read should only fail when no attempt was ever valid.
- **Check the model's arrows against the file's arrows.** The reader knows every arrow exactly (glued ends) or by nearest shape (unglued, flagged as a heuristic). In the second Census reading the model got 19 of 22 arrows right, invented one (Detect Spanish speaker? to the intent-failure message) and missed two whose ends are not glued. Compare both directions deterministically (edge with no arrow; arrow with no edge) and send the findings back; that is also what produced the "step never reached" warnings.
- **Never put example wording in a field description.** A schema example ("summary of the conversation") came back as real data in the journey. Describe what a field is for, say "do not invent", and add a test that no description carries example content.
- A step the reader marks as a start marker stays a marker even if the model gives it another step's wording (check the label as well as the text).
- Group stray branch labels ("Y", "N", "fallback: 3x") into one info review so the real "not modelled" warnings are visible.
- A diagram can be genuinely incomplete (the enumeration box in the Census deck has no arrow at all): "never reached" is then a true finding for the consultant, not a model error.
- **Repair rounds can damage what was right.** In the third Census reading the arrows became perfect (0 invented, 0 missed of 22) but the repairs re-labelled a decision diamond ("Utterance recognized?") as an `intent_capture` and the real intent prompt as a plain announcement. Add a deterministic check for every kind of damage you see: here, a shape whose geometry is `flowChartDecision` must be a `decision`. Compare readings round to round (kind changes, dropped and added steps) before trusting a repaired answer; the pipeline picks the valid reading with the fewest findings, which does not see kind damage.
- A diamond is a branch point: the question inside it is not spoken. The prompt asked before it is its own step.
- **Information-free cleanups are fine and are recorded as assumptions:** an empty edge label is no label; a missing `next` on `end`/`escalation` is `[]`; a start marker kept as an unclassified step with nothing leading into it is dropped.
- **Stop asking the model to repair what the file already settles.** The fourth Census reading (16 items, no authentication step, edge labels that were other steps' names) came from repair rounds that kept re-labelling steps. Division of labour that works: the model supplies meaning (kinds, wording, fields); the file supplies the graph (shapes, arrows, labels, markers, geometry). So `extract/reconcile.ts` corrects, deterministically and with every change recorded in `assumptions`: start markers removed, diagram titles stripped from wording, edges made to match the arrows (invented removed, missed added, unglued ends flagged), labels taken from the file's branch labels. Only what needs judgement (a diamond given a spoken kind, an uncovered shape) goes back to the model.
- **Choose between readings by capability first, findings second.** "Fewest findings" picked a reading that had silently lost authentication. Prefer the reading with more distinct step kinds; among equals, fewer findings. A later reading must never be able to erase a capability an earlier one had.
- Replay every real reading you have kept through the current pipeline whenever it changes (`fixtures/census-cqa.extracted-nova*.journey.json`): the table of items, authentication present, findings left is the regression report.
- Keep a real model's output as a regression fixture (`fixtures/census-cqa.extracted-nova.journey.json`) and test the checks against it.

## 5. Ideas for the app
- **"What the model will read" preview:** show the consultant the text and graph the reader extracted (with the legend and ignored items marked) before calling the model. Most extraction problems are visible there.
- **Per-format readers share one graph model** (shapes, arrows, labels, legend): add legend and noise handling once in the shared model, and per format only the parsing.
- **Model comparison:** run the same deck through two models and show the differences; wording differences are the important ones (the verbatim check already flags them).
- **Image and PDF sources:** the model has no shapes-and-arrows graph, so the rules matter more: legends, markers and unique ids must be stated; expect lower fidelity and always review.
