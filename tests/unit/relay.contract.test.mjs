/**
 * @file BDPv4 correct-mock and negative-control proof for the relay contract.
 * @change 2026-11-06 TEST-FRENEMY-114 and TEST-FRENEMY-115: Added green mock
 * coverage for R01-R06 and Q01/Q02 before any production implementation.
 * @change 2026-11-06 FR-FRENEMY-116, TR-FRENEMY-CONFIG-120,
 * TEST-FRENEMY-116: Added correct R07 observations and deliberate negative
 * controls for every selector and configuration acceptance criterion.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assertContractCase, cloneObservation } from "../contracts/relay-contract.mjs";
import { MockRelayProvider } from "./mock-relay-provider.mjs";

const context = {
  platform: "win32",
  cwd: "C:/fixture/workspace",
  grokExecutable: "C:/fixture/bin/grok.exe",
  clineExecutable: "C:/fixture/bin/cline.exe",
  configPath: "C:/fixture/server/frenemy.config.json",
  explicitConfigPath: "C:/fixture/config/custom.json",
  prompt: "  preserve this prompt /workflow list  ",
  marker: "FRENEMY-MARKER-114",
  pins: {
    "ask-claude-mcp.mjs": "075AA86362E6C37C6C17F7CD75F71BA5E87EE7DDAE0EF30B70F380A0286F520F",
    "install.ps1": "69E316D0A8F885CFF85AF1788BB978DCCD351ABB8FA6F743E2709BB5AB544AB2",
    "install.sh": "1087D32506FC86D179DD4BA7F41C874C343D7233E85D13A92977622DD0BF0685",
    "CLAUDE-codex-section.md": "E4882BF81146481C43D09B2977C8613BC4AB8A62293BB9E7B724782B61BB6057",
    "genimg.sh": "D70937612F7BDFE61BD80A960F488A3310F496F471EA843A31F96E506C43D002",
  },
};

const provider = new MockRelayProvider(context);
const caseIds = ["R01", "R02", "R03", "R04", "R05", "R06", "R07", "Q01", "Q02"];

test("RelayContractMockTests correct independent observations satisfy every Phase 3 case", async (t) => {
  for (const caseId of caseIds) {
    await t.test(caseId, () => assertContractCase(caseId, provider.collect(caseId), context));
  }
});

const negativeControls = [
  ["R01 descriptor drift", "R01", (x) => { x.tools[2].name = "ask_wrong"; }],
  ["R01 cross-target dispatch", "R01", (x) => { x.dispatch[0][1] = "cline"; }],
  ["R01 invalid prompt spawned", "R01", (x) => { x.invalidPrompts[0].spawnCount = 1; }],
  ["R02 shell launch", "R02", (x) => { x.grok.shell = true; }],
  ["R02 wrong cwd", "R02", (x) => { x.cline.cwd = "C:/wrong"; }],
  ["R02 unsupported platform discovery", "R02", (x) => { x.unsupportedPreflight.discoveries = 1; }],
  ["R02 invalid override fell back to PATH", "R02", (x) => { x.discovery[1][1] = context.grokExecutable; }],
  ["R02 Linux nonexecutable accepted", "R02", (x) => { x.discovery[4][3] = true; }],
  ["R03 prompt bytes in argv", "R03", (x) => { x.prompt.inArgv = true; }],
  ["R03 write before protection", "R03", (x) => { x.prompt.order = ["write", "protect", "spawn", "cleanup"]; }],
  ["R03 missing verbatim", "R03", (x) => { x.readArgs = x.readArgs.filter((v) => v !== "--verbatim"); }],
  ["R03 partial max tokens answer", "R03", (x) => { x.results.max_tokens = [true, "partial"]; }],
  ["R03 protection failure launched", "R03", (x) => { x.blockedBeforeLaunch.protectionFailure.spawns = 1; }],
  ["R03 missing PowerShell wrote prompt", "R03", (x) => { x.blockedBeforeLaunch.missingPowerShell.writes = 1; }],
  ["R03 cleanup omitted residue path", "R03", (x) => { x.cleanup.residuePath = ""; }],
  ["R04 auto approve enabled", "R04", (x) => { x.args[2] = "true"; }],
  ["R04 filesystem capability", "R04", (x) => { x.initialize.clientCapabilities.fs = true; }],
  ["R04 changed prompt", "R04", (x) => { x.prompt.prompt[0].text = x.prompt.prompt[0].text.trim(); }],
  ["R04 invented permission option", "R04", (x) => { x.options.allow = "invented"; }],
  ["R04 partial refusal accepted", "R04", (x) => { x.failures = x.failures.filter((v) => v !== "refusal"); }],
  ["R04 native input form omitted", "R04", (x) => { x.permissionForms.readAllowed.pop(); }],
  ["R04 wrong-session update accepted", "R04", (x) => { x.messageFiltering.ignoredOtherSessions = 0; }],
  ["R05 fifth call spawned", "R05", (x) => { x.capacity.fifthSpawns = 1; }],
  ["R05 exact limit rejected", "R05", (x) => { x.streams.stdoutAtLimit = "overflow"; }],
  ["R05 many small ACP frames ignored", "R05", (x) => { x.streams.manySmallAcp = "accepted"; }],
  ["R05 oversized final answer accepted", "R05", (x) => { x.streams.finalAnswerOver = "accepted"; }],
  ["R05 leaked slot", "R05", (x) => { x.lifecycle.slotReleases = 0; }],
  ["R05 duplicate reply", "R05", (x) => { x.lifecycle.terminalReplies = 2; }],
  ["R06 Claude descriptor drift", "R06", (x) => { x.tools[0].description = "changed"; }],
  ["R06 Claude flags drift", "R06", (x) => { x.readArgs.pop(); }],
  ["R06 baseline pin drift", "R06", (x) => { x.pins["install.ps1"] = "changed"; }],
  ["R06 prompt coercion drift", "R06", (x) => { x.claudeBehavior.missingPromptCoerced = "undefined"; }],
  ["R06 installer compatibility omitted", "R06", (x) => { x.unchangedFiles.shift(); }],
  ["R07 default config path drift", "R07", (x) => { x.config.defaultPath = "C:/wrong/frenemy.config.json"; }],
  ["R07 config read after startup", "R07", (x) => { x.config.readsAtStartup = 2; }],
  ["R07 neutral config contains selector", "R07", (x) => { x.config.neutral.agents.cline.provider = "local"; }],
  ["R07 schema permits unknown properties", "R07", (x) => { x.schema.strictObjects.pop(); }],
  ["R07 schema selector permits empty", "R07", (x) => { x.schema.selectorStringsRequireNonempty = false; }],
  ["R07 caller precedence lost", "R07", (x) => { x.precedence.claude.model = "config-claude"; }],
  ["R07 cross-agent selector leaked", "R07", (x) => { x.precedence.crossAgentLeak = true; }],
  ["R07 selector joined into one argv value", "R07", (x) => { x.argv.cline.splice(-2, 2, "--thinking high"); }],
  ["R07 Cline provider placed in argv", "R07", (x) => { x.argv.cline.push("--provider", "openai-codex"); }],
  ["R07 Cline provider environment omitted", "R07", (x) => { delete x.clineEnvironment.CLINE_PROVIDER; }],
  ["R07 Cline model environment omitted", "R07", (x) => { delete x.clineEnvironment.CLINE_MODEL; }],
  ["R07 parent environment mutated", "R07", (x) => { x.parentEnvironmentUnchanged = false; }],
  ["R07 shell interpolation enabled", "R07", (x) => { x.argv.shell = true; }],
  ["R07 omission changed compatibility", "R07", (x) => { x.compatibility.cline.push("--provider", "cline"); }],
  ["R07 invalid selector discovered executable", "R07", (x) => { x.invalidSelectors[0].discoveries = 1; }],
  ["R07 invalid selector launched", "R07", (x) => { x.invalidSelectors[1].spawns = 1; }],
  ["R07 invalid config launched", "R07", (x) => { x.invalidConfigs[0][2] = 1; }],
  ["R07 native rejection fell back", "R07", (x) => { x.nativeRejection.fallbacks = 1; }],
  ["R07 native rejection mutated config", "R07", (x) => { x.nativeRejection.configMutations = 1; }],
  ["Q01 answer-only claim", "Q01", (x) => { x.writeBytes = ""; }],
  ["Q01 prompt unprotected", "Q01", (x) => { x.promptProtected = false; }],
  ["Q01 slash marker absent", "Q01", (x) => { x.answerIncludesMarker = false; }],
  ["Q02 option not echoed", "Q02", (x) => { x.offeredOptionsEchoed = false; }],
  ["Q02 missing patch evidence", "Q02", (x) => { x.patchBytes = ""; }],
  ["Q02 slash marker absent", "Q02", (x) => { x.answerIncludesMarker = false; }],
  ["Q02 provider identity mismatch", "Q02", (x) => { x.observedProvider = "cline"; }],
  ["Q02 model identity mismatch", "Q02", (x) => { x.observedModel = "anthropic/claude-sonnet-5.5"; }],
];

test("RelayContractMockTests every planned negative mutation is rejected", async (t) => {
  for (const [name, caseId, mutate] of negativeControls) {
    await t.test(name, () => {
      const observation = cloneObservation(provider.collect(caseId));
      mutate(observation);
      assert.throws(() => assertContractCase(caseId, observation, context), assert.AssertionError);
    });
  }
});
