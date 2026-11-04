// Touchpoint embed. Bundled to web/public/touchpoint.bundle.js by `npm run build:web`.
//
// Secrets rule: the Live Sync deploymentKey/apiKey are NEVER constants in this file or the
// bundle. They are fetched at runtime from the server route /livesync-token.
import { Touchpoint } from "@amazon-connect-touchpoint/web";
// TODO(acxd-schema): export name and init() signature come from the handoff doc, which says
// "confirm export name in package docs". Check node_modules/@amazon-connect-touchpoint/web
// typings after `npm install` and adjust this file if they differ.

const API = (window.CENSUS_CONFIG?.apiBase ?? "").replace(/\/$/, "");

async function boot() {
  if (!API || API.startsWith("REPLACE_")) throw new Error("Set apiBase in web/public/config.js");
  const cfg = await fetch(`${API}/config`).then((r) => r.json());
  const { deploymentKey, apiKey } = await fetch(`${API}/livesync-token`).then((r) => {
    if (!r.ok) throw new Error(`livesync-token failed: ${r.status}`);
    return r.json();
  });

  Touchpoint.init({
    instanceId: cfg.instanceId,
    region: cfg.region,
    contactFlowId: cfg.contactFlowId,
    // Lambda endpoint (calls Connect StartChatContact).
    // TODO(acxd-schema): confirm the response shape Touchpoint expects from this endpoint.
    startChatEndpoint: `${API}/start-chat`,
    liveSync: { deploymentKey, apiKey },
  });
}

boot().catch((err) => {
  // Fail visibly in the console; the static demo site still works without the widget.
  console.error("[livesync-demo] Touchpoint failed to start:", err);
});
