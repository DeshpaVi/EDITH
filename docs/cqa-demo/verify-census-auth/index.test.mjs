import test from "node:test";
import assert from "node:assert/strict";
import { makeHandler } from "./index.mjs";

const table = new Set(["12345"]);
const handler = makeHandler(async (id) => table.has(id), { API_KEY: "k" });

const call = async (body, headers = { "x-api-key": "k" }) => {
  const res = await handler({ body: JSON.stringify(body), headers });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

test("known census id verifies", async () => {
  assert.deepEqual(await call({ censusId: "12345" }), { status: 200, body: { verified: true } });
});
test("unknown census id fails", async () => {
  assert.equal((await call({ censusId: "99999" })).body.verified, false);
});
test("empty / missing id fails without a lookup", async () => {
  assert.equal((await call({})).body.verified, false);
  assert.equal((await call({ censusId: "  " })).body.verified, false);
});
test("bad JSON -> 400", async () => {
  assert.equal((await handler({ body: "{", headers: { "x-api-key": "k" } })).statusCode, 400);
});
test("wrong or missing API key -> 401", async () => {
  assert.equal((await call({ censusId: "12345" }, {})).status, 401);
});
