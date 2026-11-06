// Demo Census authentication, called by an ACXD "External" data request.
// Request : POST JSON { censusId, zipCode?, ssnLastFour? }
// Response: 200 JSON { verified: boolean }
// Verified = the Census ID exists in the DynamoDB table named by TABLE_NAME (partition key
// censusId, String) AND the caller's zipCode or ssnLastFour matches the stored one.
// No PII is logged and the response never says which field was wrong.

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

export const makeHandler = (getRecord, env = process.env) => async (event) => {
  if (env.API_KEY && event.headers?.["x-api-key"] !== env.API_KEY) {
    return reply(401, { error: "unauthorized" });
  }

  let input;
  try {
    input = parseBody(event);
  } catch {
    return reply(400, { error: "invalid JSON body" });
  }

  const text = (v) => String(v ?? "").trim();
  const censusId = text(input.censusId);
  const zipCode = text(input.zipCode);
  const ssnLastFour = text(input.ssnLastFour);
  if (!censusId || (!zipCode && !ssnLastFour)) return reply(200, { verified: false });

  const record = await getRecord(censusId);
  const matches = (given, stored) => given !== "" && given === text(stored);
  const verified = Boolean(record) && (matches(zipCode, record.zipCode) || matches(ssnLastFour, record.ssnLastFour));
  return reply(200, { verified });
};

// Production lookup; the AWS SDK v3 is bundled in the Lambda Node.js runtime.
let client;
const getRecordFromDynamo = async (censusId) => {
  const { DynamoDBClient, GetItemCommand } = await import("@aws-sdk/client-dynamodb");
  client ??= new DynamoDBClient({});
  const { Item } = await client.send(
    new GetItemCommand({ TableName: process.env.TABLE_NAME, Key: { censusId: { S: censusId } } }),
  );
  return Item && { zipCode: Item.zipCode?.S, ssnLastFour: Item.ssnLastFour?.S };
};

export const handler = makeHandler(getRecordFromDynamo);
