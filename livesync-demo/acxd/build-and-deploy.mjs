// Build the script, wait for the build, deploy it. Asks for confirmation naming the environment.
//   node acxd/build-and-deploy.mjs --env development
//   node acxd/build-and-deploy.mjs --env development --build <buildId>   # redeploy a previous build = rollback
import { makeClient, parseArgs, confirm, ENVIRONMENTS, scriptIdOf, buildIdOf, deploymentIdOf } from "./lib.mjs";
import { SCRIPT_NAME } from "./script.definition.mjs";

const args = parseArgs(process.argv.slice(2));
const environment = args.env;
if (!ENVIRONMENTS.includes(environment)) {
  console.error(`--env is required: one of ${ENVIRONMENTS.join(", ")}`);
  process.exit(1);
}

const {
  ListLiveSyncScriptsCommand,
  CreateLiveSyncScriptBuildCommand,
  GetLiveSyncScriptBuildCommand,
  CreateLiveSyncScriptDeploymentCommand,
} = await import("amazon-connect-acxd-sdk");
const client = await makeClient();
// TODO(acxd-schema): list response key unverified, same as upsert-script.mjs.
const listed = await client.send(new ListLiveSyncScriptsCommand({}));
const found = (listed.liveSyncScripts ?? listed.items ?? []).find((s) => s.name === SCRIPT_NAME);
if (!found) { console.error(`Script "${SCRIPT_NAME}" not found. Run: npm run acxd:script`); process.exit(1); }
const liveSyncScriptIdentifier = scriptIdOf(found);

let buildIdentifier = args.build;
await confirm(args.build ? `redeploy build ${args.build}` : "create a new build and deploy it", environment);

if (!buildIdentifier) {
  const build = await client.send(new CreateLiveSyncScriptBuildCommand({
    liveSyncScriptIdentifier,
    description: `census demo ${new Date().toISOString()}`,
    languageSettings: [{ languageCode: "en-US" }],
  }));
  buildIdentifier = buildIdOf(build);
  console.log(`Build ${buildIdentifier} created. Waiting...`);

  // TODO(acxd-schema): only PENDING is documented. Terminal success/failure status strings
  // are unconfirmed, so: any non-PENDING status ends the wait, and a status containing
  // "fail"/"error" aborts. Print the status so the real values can be recorded.
  for (let i = 0; i < 60; i++) {
    const b = await client.send(new GetLiveSyncScriptBuildCommand({ liveSyncScriptIdentifier, buildIdentifier }));
    if (b.status !== "PENDING") {
      console.log(`Build status: ${b.status}`);
      if (/fail|error/i.test(String(b.status))) process.exit(1);
      break;
    }
    if (i === 59) { console.error("Timed out waiting for build."); process.exit(1); }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const dep = await client.send(new CreateLiveSyncScriptDeploymentCommand({
  liveSyncScriptIdentifier,
  buildIdentifier,
  description: `census demo -> ${environment}`,
  environment,
}));
console.log(`Deployed build ${buildIdentifier} to ${environment}. Deployment: ${deploymentIdOf(dep)}`);
