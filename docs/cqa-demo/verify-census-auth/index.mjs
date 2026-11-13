// Demo Census authentication, called by an ACXD "External" data request.
// Request : POST JSON { authValue }   (whatever the caller said: Census ID, zip code or SSN last four)
// Response: 200 JSON { verified: boolean }
// Verified = authValue matches ANY ONE of censusId / zipCode / ssnLastFour in the DynamoDB table
// TABLE_NAME (partition key censusId; GSIs zipCode-index and ssnLastFour-index). The caller can
// fail with one value and succeed on a retry with another. No PII is logged and the response never
// says which field matched.

const FIELDS = ["censusId", "zipCode", "ssnLastFour"];

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

  const authValue = String(input.authValue ?? "").trim();
  if (!authValue) return reply(200, { verified: false });

  // Identifiers may be alphanumeric (a Census ID such as A1B2C3D4). Try the value as given, then a compact form
  // (spaces and hyphens removed, capital letters): a spoken ID can arrive as "a1b2-c3 d4". Store IDs in capitals, no spaces.
  const compact = authValue.replace(/[\s-]+/g, "").toUpperCase();
  for (const field of FIELDS) {
    for (const value of new Set([authValue, compact])) {
      if (value && (await exists(field, value))) return reply(200, { verified: true });
    }
  }
  return reply(200, { verified: false });
};

// Production lookup; the AWS SDK v3 is bundled in the Lambda Node.js runtime.
let client;
const existsInDynamo = async (field, value) => {
  const { DynamoDBClient, GetItemCommand, QueryCommand } = await import("@aws-sdk/client-dynamodb");
  client ??= new DynamoDBClient({});
  const TableName = process.env.TABLE_NAME;
  if (field === "censusId") {
    const { Item } = await client.send(new GetItemCommand({ TableName, Key: { censusId: { S: value } } }));
    return Boolean(Item);
  }
  const { Count } = await client.send(new QueryCommand({
    TableName,
    IndexName: `${field}-index`,
    KeyConditionExpression: "#f = :v",
    ExpressionAttributeNames: { "#f": field },
    ExpressionAttributeValues: { ":v": { S: value } },
    Limit: 1,
  }));
  return Count > 0;
};

export const handler = makeHandler(existsInDynamo);
