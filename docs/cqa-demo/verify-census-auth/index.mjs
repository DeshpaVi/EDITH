// Demo Census ID check, called by an ACXD "External" data request.
// Request : POST JSON { censusId }
// Response: 200 JSON { verified: boolean }
// Looks the ID up in the DynamoDB table named by TABLE_NAME (partition key: censusId, String).
// No PII is logged.

const reply = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const parseBody = (event) => {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw);
};

export const makeHandler = (exists, env = process.env) => async (event) => {
  if (env.API_KEY && event.headers?.["x-api-key"] !== env.API_KEY) {
    return reply(401, { error: "unauthorized" });
  }

  let input;
  try {
    input = parseBody(event);
  } catch {
    return reply(400, { error: "invalid JSON body" });
  }

  const censusId = String(input.censusId ?? "").trim();
  if (!censusId) return reply(200, { verified: false });

  return reply(200, { verified: await exists(censusId) });
};

// Production lookup; the AWS SDK v3 is bundled in the Lambda Node.js runtime.
let client;
const existsInDynamo = async (censusId) => {
  const { DynamoDBClient, GetItemCommand } = await import("@aws-sdk/client-dynamodb");
  client ??= new DynamoDBClient({});
  const { Item } = await client.send(
    new GetItemCommand({ TableName: process.env.TABLE_NAME, Key: { censusId: { S: censusId } } }),
  );
  return Boolean(Item);
};

export const handler = makeHandler(existsInDynamo);
