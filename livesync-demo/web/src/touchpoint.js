// Touchpoint embed. Bundled to web/public/touchpoint.bundle.js by `npm run build:web`.
//
// API shape confirmed from @amazon-connect-touchpoint/web 1.0.5 (README + typings):
//   create({ config: {chatEndpoint, instanceId, contactFlowId, region, participantDisplayName},
//            input, windowSize, liveSync: {deploymentKey, apiKey} })
//   touchpoint.sendContext({ actions: [{ action, description, schema, handler }] })
//
// Secrets rule: the Live Sync deploymentKey/apiKey are NEVER constants in this file or the
// bundle. They are fetched at runtime from the Lambda route /livesync-token.
import { create } from "@amazon-connect-touchpoint/web";

const API = (window.CENSUS_CONFIG?.apiBase ?? "").replace(/\/$/, "");

const field = (name) => document.querySelector(`[data-livesync="${name}"]`);

function highlight(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("livesync-highlight");
  setTimeout(() => el.classList.remove("livesync-highlight"), 4000);
}

function fill(name, value) {
  const el = field(name);
  if (!el) return `No field "${name}" on this page`;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  highlight(el);
  return "ok";
}

// TODO(acxd-schema): the `action` names below must match the actions declared on the Live Sync
// node in the ACXD Canvas (or the agent will never call them). Rename here or in the Canvas
// so they agree. Demo data only; do not use real personal information.
const ACTIONS = [
  {
    action: "set_household_size",
    description: "Enter how many people live at the address",
    schema: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 30 } }, required: ["count"] },
    handler: ({ count }) => fill("household-size", String(count)),
  },
  {
    action: "set_tenure",
    description: "Choose whether the home is owned or rented",
    schema: {
      type: "object",
      properties: { tenure: { type: "string", enum: ["Owned with a mortgage", "Owned free and clear", "Rented", "Occupied without rent"] } },
      required: ["tenure"],
    },
    handler: ({ tenure }) => fill("tenure", tenure),
  },
  {
    action: "set_street",
    description: "Enter the street address",
    schema: { type: "object", properties: { street: { type: "string" } }, required: ["street"] },
    handler: ({ street }) => fill("street", street),
  },
  {
    action: "set_zip",
    description: "Enter the 5-digit ZIP code",
    schema: { type: "object", properties: { zip: { type: "string", pattern: "^[0-9]{5}$" } }, required: ["zip"] },
    handler: ({ zip }) => fill("zip", zip),
  },
  {
    action: "highlight_element",
    description: "Highlight an element on the page to point the visitor at it",
    schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["start-census", "household-size", "tenure", "street", "zip", "submit-census", "need-help"],
        },
      },
      required: ["target"],
    },
    handler: ({ target }) => (highlight(field(target)), "ok"),
  },
  {
    action: "go_to_page",
    description: "Navigate to a page of the site",
    schema: { type: "object", properties: { page: { type: "string", enum: ["home", "respond", "faq"] } }, required: ["page"] },
    handler: ({ page }) => {
      location.href = { home: "/", respond: "/respond.html", faq: "/faq.html" }[page];
      return "ok";
    },
  },
];

async function boot() {
  if (!API || API.startsWith("REPLACE_")) throw new Error("Set apiBase in web/public/config.js");
  const cfg = await fetch(`${API}/config`).then((r) => r.json());
  const { deploymentKey, apiKey } = await fetch(`${API}/livesync-token`).then((r) => {
    if (!r.ok) throw new Error(`livesync-token failed: ${r.status}`);
    return r.json();
  });

  const touchpoint = await create({
    config: {
      chatEndpoint: `${API}/start-chat`,
      participantDisplayName: "Census visitor",
      instanceId: cfg.instanceId,
      contactFlowId: cfg.contactFlowId,
      region: cfg.region,
    },
    input: "text",
    windowSize: "floating",
    liveSync: { deploymentKey, apiKey },
  });

  // Advertise the actions the agent may take (README: sent once a contact exists).
  await touchpoint.sendContext({ actions: ACTIONS });

  // TODO(acxd-schema): Live Sync Script steps (acxd/script.definition.mjs) are signalled by the
  // page via touchpoint.sendStep({ stepId, scriptId, apiKey, context }). Not wired yet: confirm
  // from the ACXD docs whether triggers fire automatically or need explicit sendStep calls.
  window.touchpoint = touchpoint; // handy for console debugging
}

boot().catch((err) => {
  // Fail visibly in the console; the static demo site still works without the widget.
  console.error("[livesync-demo] Touchpoint failed to start:", err);
});
