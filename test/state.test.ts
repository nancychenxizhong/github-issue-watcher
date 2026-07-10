import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { loadScanState, repoKey, saveScanState } from "../src/state.js";
import type { ScanState } from "../src/types.js";

test("loadScanState returns an empty state for a missing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "giw-state-"));
  const state = await loadScanState(join(dir, "missing.json"));

  assert.deepEqual(state, { schemaVersion: 1, repos: {} });
});

test("saveScanState writes state that loadScanState can read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "giw-state-"));
  const path = join(dir, "issues-state.json");
  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "openai/codex": {
        lastSuccessfulScanStartedAt: "2026-07-09T00:00:00.000Z",
        pageOneEtag: '"etag"',
        issues: {},
      },
    },
  };

  await saveScanState(path, state);

  assert.deepEqual(await loadScanState(path), state);
  assert.equal(JSON.parse(await readFile(path, "utf-8")).schemaVersion, 1);
});

test("loadScanState rejects unsupported schemas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "giw-state-"));
  const path = join(dir, "issues-state.json");
  await saveScanState(path, { schemaVersion: 1, repos: {} });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, JSON.stringify({ schemaVersion: 999, repos: {} }), "utf-8")
  );

  await assert.rejects(loadScanState(path), /unsupported schemaVersion 999/);
});

test("repoKey formats owner and repo names consistently", () => {
  assert.equal(repoKey("openai", "codex"), "openai/codex");
});
