// AWS Lambda (Node.js 20.x) behind an API Gateway HTTP API (payload format 2.0).
//   GET  /config          non-secret Connect identifiers
//   GET  /livesync-token  Live Sync deployment key + API key
//   POST /start-chat      Connect StartChatContact -> participant credentials
// @aws-sdk/client-connect is bundled in the Node.js 20 Lambda runtime; no packaging needed.
import { ConnectClient, StartChatContactCommand } from "@aws-sdk/client-connect";

const env = (k) => process.env[k] ?? "";
const ALLOWED_ORIGINS = (env("ALLOWED_ORIGINS") || "http://localhost:3000").split(",").map((s) => s.trim());
const connect = new ConnectClient({});

const reply = (statusCode, body, origin) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    // Reflect only allow-listed origins. (If you also set CORS on the API Gateway API, remove these.)
    ...(ALLOWED_ORIGINS.includes(origin) && {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      vary: "origin",
    }),
  },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = event.rawPath ?? "";
  const origin = event.headers?.origin ?? event.headers?.Origin ?? "";

  if (method === "OPTIONS") return reply(204, {}, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply(403, { error: "origin not allowed" }, origin);

  try {
    if (method === "GET" && path.endsWith("/config")) {
      return reply(200, {
        instanceId: env("CONNECT_INSTANCE_ID"),
        region: env("AWS_REGION"),
        contactFlowId: env("CONNECT_CONTACT_FLOW_ID"),
      }, origin);
    }

    if (method === "GET" && path.endsWith("/livesync-token")) {
      const deploymentKey = env("LIVESYNC_DEPLOYMENT_KEY");
      const apiKey = env("LIVESYNC_API_KEY");
      if (!deploymentKey || !apiKey) return reply(500, { error: "Live Sync keys not configured" }, origin);
      return reply(200, { deploymentKey, apiKey }, origin);
    }

    if (method === "POST" && path.endsWith("/start-chat")) {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch { /* ignore bad JSON */ }
      const out = await connect.send(new StartChatContactCommand({
        InstanceId: env("CONNECT_INSTANCE_ID"),
        ContactFlowId: env("CONNECT_CONTACT_FLOW_ID"),
        ParticipantDetails: { DisplayName: String(body.displayName ?? "Census visitor").slice(0, 256) },
        // Demo only; do not put real PII in attributes.
        Attributes: { source: "census-2030-demo", page: String(body.page ?? "").slice(0, 200) },
        SupportedMessagingContentTypes: ["text/plain", "text/markdown"],
      }));
      // TODO(acxd-schema): confirm the field names Touchpoint reads from this response.
      return reply(200, {
        ContactId: out.ContactId,
        ParticipantId: out.ParticipantId,
        ParticipantToken: out.ParticipantToken,
        region: env("AWS_REGION"),
      }, origin);
    }

    return reply(404, { error: "not found" }, origin);
  } catch (err) {
    console.error(err);
    return reply(500, { error: "internal error" }, origin);
  }
};
