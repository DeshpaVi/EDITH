// Demo-only Census authentication check, called by an ACXD "External" data request.
// Request : POST JSON { censusId, zipCode?, ssnLastFour? }
// Response: 200 JSON { verified: boolean }
// No PII is logged and the response never says which field was wrong.

const demo = () => ({
  censusId: process.env.DEMO_CENSUS_ID ?? "12345",
  zipCode: process.env.DEMO_ZIP ?? "411018",
  ssnLastFour: process.env.DEMO_SSN4 ?? "", // empty = SSN path always fails until configured
});

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

export const handler = async (event) => {
  const expectedKey = process.env.API_KEY;
  if (expectedKey && event.headers?.["x-api-key"] !== expectedKey) {
    return reply(401, { error: "unauthorized" });
  }

  let input;
  try {
    input = parseBody(event);
  } catch {
    return reply(400, { error: "invalid JSON body" });
  }

  const d = demo();
  const id = String(input.censusId ?? "").trim();
  const zip = String(input.zipCode ?? "").trim();
  const ssn = String(input.ssnLastFour ?? "").trim();

  const secondFactor = (zip && zip === d.zipCode) || (ssn && d.ssnLastFour && ssn === d.ssnLastFour);
  return reply(200, { verified: Boolean(id && id === d.censusId && secondFactor) });
};
