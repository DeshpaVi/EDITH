// Demo Census authentication, called by an ACXD "External" data request.
// Request : POST JSON { censusId?, zipCode?, ssnLastFour? }   (send whichever the caller gave)
// Response: 200 JSON { verified: boolean }
// Verified = ANY ONE provided field matches a record in the DynamoDB table TABLE_NAME
// (partition key censusId; GSIs zipCode-index and ssnLastFour-index). The caller can fail on
// one field and succeed on a retry with another. No PII is logged and the response never says
// which field matched or failed.

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

  const fields = ["censusId", "zipCode", "ssnLastFour"]
    .map((name) => [name, String(input[name] ?? "").trim()])
    .filter(([, value]) => value !== "");

  for (const [name, value] of fields) {
    if (await exists(name, value)) return reply(200, { verified: true });
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
