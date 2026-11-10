/**
 * @file Production-bound archive contract for the four-agent reasoning run.
 * @change 2026-11-07 FR-FRENEMY-117, TR-FRENEMY-ORCH-121,
 * TEST-FRENEMY-117, AC-FRENEMY-117-04, AC-TR-FRENEMY-ORCH-121-05, and
 * AC-TEST-FRENEMY-117-08: Bind the same archive assertions proven by negative
 * controls to the actual live ZIP bytes and its post-validation receipt.
 * @change 2026-11-07 TEST-FRENEMY-117, AC-TEST-FRENEMY-117-08: Derive the
 * complete archive member set and contents from the ZIP before shared checks.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertFourAgentArchiveEvidence, deriveArchiveEvidence, loadQuestionFixture } from "../contracts/four-agent-reasoning.mjs";
import { inspectZipArchive } from "../contracts/zip-archive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = loadQuestionFixture(join(here, "..", "fixtures", "four-agent-reasoning-questions.json"));
const archivePath = process.env.FRENEMY_FOUR_AGENT_ARCHIVE_PATH;
const validationPath = process.env.FRENEMY_FOUR_AGENT_VALIDATION_PATH;
const repositoryRoot = process.env.FRENEMY_REPO_ROOT;

test("FourAgentReasoningArchiveIntegrationTests live archive satisfies the mock-proven archive contract", () => {
  assert.ok(archivePath, "four-agent archive path was not provided");
  assert.ok(validationPath, "four-agent validation receipt path was not provided");
  assert.ok(repositoryRoot, "repository root was not provided");
  assert.ok(existsSync(archivePath), "four-agent archive does not exist");
  assert.ok(existsSync(validationPath), "four-agent validation receipt does not exist");

  const archiveBytes = readFileSync(archivePath);
  const archiveFiles = inspectZipArchive(archiveBytes);
  assert.ok(archiveFiles.has("manifest.json"), "four-agent archive has no manifest.json");
  const manifest = JSON.parse(archiveFiles.get("manifest.json").toString("utf8"));
  const validationReceipt = JSON.parse(readFileSync(validationPath, "utf8"));
  const sourceFiles = Object.fromEntries(
    manifest.sourceFiles.map(({ path }) => [path, readFileSync(join(repositoryRoot, ...path.split("/")), "utf8")]),
  );
  assertFourAgentArchiveEvidence(deriveArchiveEvidence(archiveBytes, validationReceipt, sourceFiles, fixture));
});
