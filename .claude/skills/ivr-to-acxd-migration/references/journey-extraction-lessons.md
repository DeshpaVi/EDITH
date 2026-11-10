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
- Keep a real model's output as a regression fixture (`fixtures/census-cqa.extracted-nova.journey.json`) and test the checks against it.

## 5. Ideas for the app
- **"What the model will read" preview:** show the consultant the text and graph the reader extracted (with the legend and ignored items marked) before calling the model. Most extraction problems are visible there.
- **Per-format readers share one graph model** (shapes, arrows, labels, legend): add legend and noise handling once in the shared model, and per format only the parsing.
- **Model comparison:** run the same deck through two models and show the differences; wording differences are the important ones (the verbatim check already flags them).
- **Image and PDF sources:** the model has no shapes-and-arrows graph, so the rules matter more: legends, markers and unique ids must be stated; expect lower fidelity and always review.
