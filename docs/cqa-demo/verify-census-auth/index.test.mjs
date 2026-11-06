import test from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "./index.mjs";

const table = { 12345: { zipCode: "411018", ssnLastFour: "6789" } };
const handler = makeHandler(async (id) => table[id], { API_KEY: "k" });

const call = async (body, headers = { "x-api-key": "k" }) => {
  const res = await handler({ body: JSON.stringify(body), headers });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
const verified = async (body) => (await call(body)).body.verified;

test("census id + correct zip verifies", async () => {
  assert.deepEqual(await call({ censusId: "12345", zipCode: "411018" }), { status: 200, body: { verified: true } });
});
test("census id + correct last four verifies", async () => {
  assert.equal(await verified({ censusId: "12345", ssnLastFour: "6789" }), true);
});
test("wrong zip fails, even with an unknown-to-record field", async () => {
  assert.equal(await verified({ censusId: "12345", zipCode: "99999" }), false);
});
test("wrong last four fails", async () => {
  assert.equal(await verified({ censusId: "12345", ssnLastFour: "0000" }), false);
});
test("unknown census id fails", async () => {
  assert.equal(await verified({ censusId: "00000", zipCode: "411018" }), false);
});
test("census id alone, or blank second factors, fail", async () => {
  assert.equal(await verified({ censusId: "12345" }), false);
  assert.equal(await verified({ censusId: "12345", zipCode: " ", ssnLastFour: "" }), false);
});
test("record with a missing field cannot be matched by an empty value", async () => {
  const h = makeHandler(async () => ({ zipCode: "411018" }), {});
  const res = await h({ body: JSON.stringify({ censusId: "1", ssnLastFour: "" }) });
  assert.equal(JSON.parse(res.body).verified, false);
});
test("bad JSON -> 400; wrong API key -> 401", async () => {
  assert.equal((await handler({ body: "{", headers: { "x-api-key": "k" } })).statusCode, 400);
  assert.equal((await call({ censusId: "12345", zipCode: "411018" }, {})).status, 401);
});
