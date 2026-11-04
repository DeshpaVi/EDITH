// Tiny server: serves the demo site and the three server-side routes the widget needs.
//   GET  /api/config          non-secret Connect identifiers
//   GET  /api/livesync-token  Live Sync deployment key + API key (from env, never bundled)
//   POST /api/start-chat      calls Connect StartChatContact, returns participant credentials
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ConnectClient, StartChatContactCommand } from "@aws-sdk/client-connect";

const PUBLIC_DIR = join(fileURLToPath(new URL("../web/public", import.meta.url)));
const PORT = Number(process.env.PORT ?? 3000);

const env = (k) => process.env[k] ?? "";
const REGION = env("AWS_REGION") || "us-east-1";
// Origins allowed to fetch the keys. Keys must reach the browser for Touchpoint to work,
// so this only limits casual cross-site use; rotate keys if they leak.
const ALLOWED_ORIGINS = (env("ALLOWED_ORIGINS") || `http://localhost:${PORT}`).split(",").map((s) => s.trim());

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function originOk(req) {
  const origin = req.headers.origin;
  // Same-origin fetches from a page often send no Origin on GET; allow those, check when present.
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const connect = new ConnectClient({ region: REGION });

async function startChat(req, res) {
  const instanceId = env("CONNECT_INSTANCE_ID");
  const contactFlowId = env("CONNECT_CONTACT_FLOW_ID");
  if (!instanceId || !contactFlowId) return json(res, 500, { error: "CONNECT_INSTANCE_ID / CONNECT_CONTACT_FLOW_ID not set" });
  const body = await readBody(req).catch(() => ({}));
  const out = await connect.send(new StartChatContactCommand({
    InstanceId: instanceId,
    ContactFlowId: contactFlowId,
    ParticipantDetails: { DisplayName: String(body.displayName ?? "Census visitor").slice(0, 256) },
    // Demo site only; do not put real PII in attributes.
    Attributes: { source: "census-2030-demo", page: String(body.page ?? "").slice(0, 200) },
    SupportedMessagingContentTypes: ["text/plain", "text/markdown"],
  }));
  // TODO(acxd-schema): confirm the field names Touchpoint reads from this response.
  json(res, 200, {
    ContactId: out.ContactId,
    ParticipantId: out.ParticipantId,
    ParticipantToken: out.ParticipantToken,
    region: REGION,
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let p = normalize(decodeURIComponent(url.pathname));
  if (p.includes("..")) { res.writeHead(400); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  try {
    const data = await readFile(join(PUBLIC_DIR, p));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname === "/api/config" && req.method === "GET") {
      return json(res, 200, {
        instanceId: env("CONNECT_INSTANCE_ID"),
        region: REGION,
        contactFlowId: env("CONNECT_CONTACT_FLOW_ID"),
      });
    }
    if (pathname === "/api/livesync-token" && req.method === "GET") {
      if (!originOk(req)) return json(res, 403, { error: "origin not allowed" });
      const deploymentKey = env("LIVESYNC_DEPLOYMENT_KEY");
      const apiKey = env("LIVESYNC_API_KEY");
      if (!deploymentKey || !apiKey) return json(res, 500, { error: "LIVESYNC_DEPLOYMENT_KEY / LIVESYNC_API_KEY not set" });
      return json(res, 200, { deploymentKey, apiKey });
    }
    if (pathname === "/api/start-chat" && req.method === "POST") {
      if (!originOk(req)) return json(res, 403, { error: "origin not allowed" });
      return await startChat(req, res);
    }
    if (req.method === "GET") return await serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (err) {
    console.error(err);
    json(res, 500, { error: "internal error" });
  }
}).listen(PORT, () => console.log(`Census 2030 demo on http://localhost:${PORT}`));
