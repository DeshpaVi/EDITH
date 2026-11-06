import test from "node:test";
import assert from "node:assert/strict";
import { handler } from "./index.mjs";

const call = async (body, headers = {}) => {
  const res = await handler({ body: JSON.stringify(body), headers });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

test("valid census id + zip verifies", async () => {
  assert.deepEqual(await call({ censusId: "12345", zipCode: "411018" }), { status: 200, body: { verified: true } });
});
test("wrong zip fails", async () => {
  assert.equal((await call({ censusId: "12345", zipCode: "99999" })).body.verified, false);
});
test("wrong census id fails", async () => {
  assert.equal((await call({ censusId: "00000", zipCode: "411018" })).body.verified, false);
});
test("missing second factor fails", async () => {
  assert.equal((await call({ censusId: "12345" })).body.verified, false);
});
test("ssn path fails until DEMO_SSN4 is set, then works", async () => {
  assert.equal((await call({ censusId: "12345", ssnLastFour: "" })).body.verified, false);
  process.env.DEMO_SSN4 = "6789";
  assert.equal((await call({ censusId: "12345", ssnLastFour: "6789" })).body.verified, true);
  delete process.env.DEMO_SSN4;
});
test("bad JSON -> 400", async () => {
  const res = await handler({ body: "{", headers: {} });
  assert.equal(res.statusCode, 400);
});
test("API_KEY enforced when set", async () => {
  process.env.API_KEY = "k";
  assert.equal((await call({ censusId: "12345", zipCode: "411018" })).status, 401);
  assert.equal((await call({ censusId: "12345", zipCode: "411018" }, { "x-api-key": "k" })).status, 200);
  delete process.env.API_KEY;
});
