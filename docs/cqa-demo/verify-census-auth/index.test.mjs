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

test("each field alone verifies", async () => {
  assert.deepEqual(await call({ censusId: "12345" }), { status: 200, body: { verified: true } });
  assert.equal(await verified({ zipCode: "411018" }), true);
  assert.equal(await verified({ ssnLastFour: "6789" }), true);
});
test("wrong census id then retry with zip (separate calls) verifies", async () => {
  assert.equal(await verified({ censusId: "00000" }), false);
  assert.equal(await verified({ zipCode: "411018" }), true);
});
test("one wrong field plus one correct field still verifies", async () => {
  assert.equal(await verified({ censusId: "00000", zipCode: "411018" }), true);
});
test("all wrong fails", async () => {
  assert.equal(await verified({ censusId: "00000", zipCode: "99999", ssnLastFour: "0000" }), false);
});
test("nothing / blank values fail without a lookup", async () => {
  assert.equal(await verified({}), false);
  assert.equal(await verified({ censusId: " ", zipCode: "", ssnLastFour: " " }), false);
});
test("bad JSON -> 400; wrong API key -> 401", async () => {
  assert.equal((await handler({ body: "{", headers: { "x-api-key": "k" } })).statusCode, 400);
  assert.equal((await call({ censusId: "12345" }, {})).status, 401);
});
