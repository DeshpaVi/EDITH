// Create the Live Sync Script, or update it if one with the same name exists (idempotent).
//   node acxd/upsert-script.mjs [--dry-run]
import { makeClient, parseArgs, scriptIdOf } from "./lib.mjs";
import { SCRIPT } from "./script.definition.mjs";

const args = parseArgs(process.argv.slice(2));

if (args["dry-run"]) {
  console.log(JSON.stringify(SCRIPT, null, 2));
  process.exit(0);
}

const { CreateLiveSyncScriptCommand, UpdateLiveSyncScriptCommand, ListLiveSyncScriptsCommand } =
  await import("amazon-connect-acxd-sdk");
const client = await makeClient();

// TODO(acxd-schema): list response key for summaries is unverified (`liveSyncScripts`?
// `items`?). Adjust the line below after the first real response. Pagination ignored for a demo.
const listed = await client.send(new ListLiveSyncScriptsCommand({}));
const summaries = listed.liveSyncScripts ?? listed.items ?? [];
const existing = summaries.find((s) => s.name === SCRIPT.name);

if (existing) {
  // Draft script edits are not live until built and deployed, so no environment gate here.
  const res = await client.send(new UpdateLiveSyncScriptCommand({ liveSyncScriptIdentifier: scriptIdOf(existing), ...SCRIPT }));
  console.log(`Updated script "${SCRIPT.name}" -> ${scriptIdOf(res) ?? scriptIdOf(existing)}`);
} else {
  const res = await client.send(new CreateLiveSyncScriptCommand(SCRIPT));
  console.log(`Created script "${SCRIPT.name}" -> ${scriptIdOf(res)}`);
  // The full resource includes a sensitive apiKey. Deliberately NOT printed.
  console.log("Script apiKey omitted from output. Copy it from the ACXD console / GetLiveSyncScript when needed.");
}
