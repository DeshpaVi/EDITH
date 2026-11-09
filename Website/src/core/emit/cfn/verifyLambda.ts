/**
 * Source of the verification Lambda, embedded in the template as inline code (CloudFormation's
 * ZipFile limit is 4096 characters, so this must stay small; a test enforces it).
 *
 * Inline code (CloudFormation `ZipFile`) is saved by Lambda as index.js and loaded as CommonJS: use `exports.handler`, never `export`/`import`
 * statements (a real deployment failed with "SyntaxError: Unexpected token 'export'"). Dynamic `import()` is fine.
 *
 * Generic: the identifier fields come from the IDENTIFIER_FIELDS env var. The first field is the
 * table's partition key; each other field has a global secondary index named "<field>-index".
 * Request { authValue }, response { verified }. Verified when authValue matches ANY ONE field.
 * No PII is logged and the response never says which field matched.
 */
export const VERIFY_LAMBDA_SOURCE = [
  'const FIELDS = (process.env.IDENTIFIER_FIELDS || "").split(",").filter(Boolean);',
  'const reply = (statusCode, body) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });',
  'const parseBody = (event) => {',
  '  if (!event.body) return {};',
  '  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;',
  '  return JSON.parse(raw);',
  '};',
  'let client;',
  'const exists = async (field, value) => {',
  '  const { DynamoDBClient, GetItemCommand, QueryCommand } = await import("@aws-sdk/client-dynamodb");',
  '  client ??= new DynamoDBClient({});',
  '  const TableName = process.env.TABLE_NAME;',
  '  if (field === FIELDS[0]) {',
  '    const { Item } = await client.send(new GetItemCommand({ TableName, Key: { [field]: { S: value } } }));',
  '    return Boolean(Item);',
  '  }',
  '  const { Count } = await client.send(new QueryCommand({',
  '    TableName,',
  '    IndexName: field + "-index",',
  '    KeyConditionExpression: "#f = :v",',
  '    ExpressionAttributeNames: { "#f": field },',
  '    ExpressionAttributeValues: { ":v": { S: value } },',
  '    Limit: 1,',
  '  }));',
  '  return Count > 0;',
  '};',
  'exports.handler = async (event) => {',
  '  if (process.env.API_KEY && (event.headers || {})["x-api-key"] !== process.env.API_KEY) return reply(401, { error: "unauthorized" });',
  '  let input;',
  '  try { input = parseBody(event); } catch { return reply(400, { error: "invalid JSON body" }); }',
  '  const value = String(input.authValue ?? "").trim();',
  '  if (!value) return reply(200, { verified: false });',
  '  for (const field of FIELDS) {',
  '    if (await exists(field, value)) return reply(200, { verified: true });',
  '  }',
  '  return reply(200, { verified: false });',
  '};',
  '',
].join('\n')
