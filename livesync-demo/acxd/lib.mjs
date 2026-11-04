import { createInterface } from "node:readline/promises";

export const ENVIRONMENTS = ["development", "qa", "staging", "production"];

export async function makeClient() {
  const { AgenticCXDesignerClient } = await import("amazon-connect-acxd-sdk");
  const apiKey = process.env.ACXD_API_KEY;       // acxd_live_<prefix>.<secret> — server-side env only
  const workspaceId = process.env.ACXD_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    console.error("Set ACXD_API_KEY and ACXD_WORKSPACE_ID (see .env.example).");
    process.exit(1);
  }
  return new AgenticCXDesignerClient({ apiKey, workspaceId });
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i]; }
  }
  return out;
}

// Human review gate: nothing live happens until the operator types the environment name.
export async function confirm(action, environment) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`About to ${action} — target environment: "${environment}".\nType the environment name to continue: `);
  rl.close();
  if (answer.trim() !== environment) { console.log("Aborted."); process.exit(1); }
}

// TODO(acxd-schema): response id field names are unverified. The handoff doc uses
// `liveSyncScriptId` / `buildId`; list summaries are unconfirmed. Centralised here so a
// mismatch is a one-line fix.
export const scriptIdOf = (r) => r.liveSyncScriptId;
export const buildIdOf = (r) => r.buildId;
export const deploymentIdOf = (r) => r.deploymentId;
