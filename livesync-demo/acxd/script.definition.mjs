// Live Sync Script definition for the Census 2030 demo site.
// Edit steps here; `npm run acxd:script` creates or updates the script idempotently.
//
// stepIds are fixed UUIDv4s so re-running updates the same steps instead of creating new ones.

export const SCRIPT_NAME = "census-2030-demo-guide";

// TODO(acxd-schema): `trigger.query` is documented only as "a selector/query document".
// The CSS-selector shape below is a best guess. Verify it against a script authored in the
// ACXD Canvas (GetLiveSyncScript) and change ONLY this helper if the shape differs.
const q = (id) => ({ selector: `[data-livesync="${id}"]` });

export const SCRIPT = {
  name: SCRIPT_NAME,
  description: "Guides a visitor through the Census 2030 demo site by voice or chat",
  steps: [
    {
      stepId: "1dff8dca-ec1c-4c92-bd23-e37d8bdecb9c",
      name: "home-welcome",
      group: "home",
      body: "Welcome to the Census 2030 demo! I can walk you through responding. Ready to start?",
      action: "continue",
      trigger: { event: "pageLoad", once: true, urlCondition: { operator: "matches_regex", value: "^https?://[^/]+/(index\\.html)?$" } },
    },
    {
      stepId: "75393baf-3bef-44d6-9012-c334f42db519",
      name: "home-start-button",
      group: "home",
      body: "This is the Start the census button. Select it whenever you're ready.",
      action: "continue",
      trigger: { event: "appear", query: q("start-census"), highlight: true, once: true },
    },
    {
      stepId: "ca0d3ce5-3423-4f78-a55e-fa90f49e50a4",
      name: "respond-intro",
      group: "respond",
      body: "This is the response form. I'll point out each field. First, how many people live at your address?",
      action: "continue",
      trigger: { event: "pageLoad", once: true, urlCondition: { operator: "contains", value: "/respond" } },
    },
    {
      stepId: "b9e4e6f3-8aaf-4a34-8973-dfc5b7a9bd98",
      name: "respond-household-size",
      group: "respond",
      body: "Enter the number of people who live here most of the time, babies included.",
      action: "continue",
      trigger: { event: "enterViewport", query: q("household-size"), highlight: true, once: true, urlCondition: { operator: "contains", value: "/respond" } },
      // TODO(acxd-schema): stateModifications[].value is an "operand object" with no published
      // shape. Add e.g. { type: "context", name: "householdSize", modification: "set", value: ... }
      // once the operand shape is confirmed from a Canvas-authored script.
    },
    {
      stepId: "52fb540e-aa21-4ac3-8ec8-961bed310539",
      name: "respond-address",
      group: "respond",
      body: "Now your street address and ZIP code. This is a demo, so please use a made-up address.",
      action: "continue",
      trigger: { event: "enterViewport", query: q("street"), highlight: true, once: true, urlCondition: { operator: "contains", value: "/respond" } },
    },
    {
      stepId: "3430df52-424c-44fa-8556-4c427cb44380",
      name: "respond-submit",
      group: "respond",
      body: "All set? Select Submit my response. Nothing is stored in this demo.",
      action: "continue",
      trigger: { event: "appear", query: q("submit-census"), highlight: true, once: true, urlCondition: { operator: "contains", value: "/respond" } },
    },
    {
      stepId: "50f0d07d-7fb8-4a53-8860-022fdc48b980",
      name: "respond-talk-to-person",
      group: "escalation",
      body: "Connecting you with a person now.",
      action: "escalate",
      trigger: { event: "click", query: q("need-help"), highlight: false, urlCondition: { operator: "contains", value: "/respond" } },
    },
  ],
};
