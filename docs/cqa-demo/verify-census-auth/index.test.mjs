import test from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "./index.mjs";

const records = [{ censusId: "12345", zipCode: "411018", ssnLastFour: "6789" }];
const exists = async (field, value) => records.some((r) => r[field] === value);
const handler = makeHandler(exists, { API_KEY: "k" });

const call = async (body, headers = { "x-api-key": "k" }) => {
  const res = await handler({ body: JSON.stringify(body), headers });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const verified = async (body) => (await call(body)).body.verified;

test("a census id, zip or last four given as authValue each verify", async () => {
  assert.deepEqual(await call({ authValue: "12345" }), { status: 200, body: { verified: true } });
  assert.equal(await verified({ authValue: "411018" }), true);
  assert.equal(await verified({ authValue: "6789" }), true);
});
test("wrong value then retry with another value verifies (separate calls)", async () => {
  assert.equal(await verified({ authValue: "00000" }), false);
  assert.equal(await verified({ authValue: "411018" }), true);
});
test("unknown value fails", async () => {
  assert.equal(await verified({ authValue: "99999" }), false);
});
test("missing or blank authValue fails without a lookup", async () => {
  assert.equal(await verified({}), false);
  assert.equal(await verified({ authValue: "  " }), false);
});
test("bad JSON -> 400; wrong API key -> 401", async () => {
  assert.equal((await handler({ body: "{", headers: { "x-api-key": "k" } })).statusCode, 400);
  assert.equal((await call({ authValue: "12345" }, {})).status, 401);
});
