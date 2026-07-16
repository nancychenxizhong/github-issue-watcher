import assert from "node:assert/strict";
import test from "node:test";
import { scanWatchlist } from "../src/scanner.js";
import type { Config, GitHubIssue, ScanState, StoredIssue } from "../src/types.js";

const config: Config = {
  repos: [{ owner: "example", repo: "repo" }],
  lookbackDays: 1,
  minSeverity: 3,
  format: "json",
};

function issue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 1,
    number: 1,
    title: "Silent data loss",
    body: null,
    html_url: "https://github.com/example/repo/issues/1",
    state: "open",
    labels: [],
    reactions: { total_count: 0, "+1": 0, "-1": 0 },
    comments: 0,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    user: { login: "fixture" },
    ...overrides,
  };
}

function storedIssue(value: GitHubIssue, lastSeverity: number): StoredIssue {
  return {
    firstSeenAt: "2026-07-14T00:00:00.000Z",
    lastSeenAt: "2026-07-15T00:00:00.000Z",
    lastSeverity,
    issue: value,
  };
}

test("preserves previous severity for unchanged cached repositories", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 304 });

  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "example/repo": {
        lastSuccessfulScanStartedAt: "2026-07-15T00:00:00.000Z",
        pageOneEtag: "fixture-etag",
        issues: { "1": storedIssue(issue(), 6) },
      },
    },
  };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.repositories[0]?.scanStatus, "unchanged");
    assert.equal(report.issues[0]?.previousSeverity, 6);
    assert.equal(report.issues[0]?.severity, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports an empty repository scan separately from an unavailable scan", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", { status: 200 });

  const state: ScanState = { schemaVersion: 1, repos: {} };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.repositories[0]?.status, "ok");
    assert.equal(report.repositories[0]?.scanStatus, "empty");
    assert.equal(report.failureCount, 0);
    assert.equal(report.issues.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
