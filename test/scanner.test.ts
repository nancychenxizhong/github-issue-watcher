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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", etag: '"next"' },
  });
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
    assert.equal(report.activeIssues[0]?.previousSeverity, 6);
    assert.equal(report.activeIssues[0]?.severity, 6);
    assert.equal(report.alertCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("establishes an empty repository baseline separately from an unavailable scan", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("[]", { status: 200 });

  const state: ScanState = { schemaVersion: 1, repos: {} };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.repositories[0]?.status, "ok");
    assert.equal(report.repositories[0]?.scanStatus, "baseline");
    assert.equal(report.failureCount, 0);
    assert.equal(report.issues.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("establishes a baseline without flagging historical issues as new", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse([issue({ updated_at: "2026-07-15T00:30:00.000Z" })]);
  const state: ScanState = { schemaVersion: 1, repos: {} };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.repositories[0]?.scanStatus, "baseline");
    assert.equal(report.activeCount, 1);
    assert.equal(report.alertCount, 0);
    assert.equal(report.issues.length, 0);
    assert.equal(report.activeIssues[0]?.attentionReason, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flags a genuinely new issue after the baseline", async () => {
  const originalFetch = globalThis.fetch;
  const newIssue = issue({ number: 2, id: 2, updated_at: "2026-07-15T00:30:00.000Z" });
  globalThis.fetch = async () => jsonResponse([newIssue]);
  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "example/repo": {
        lastSuccessfulScanStartedAt: "2026-07-15T00:00:00.000Z",
        issues: { "1": storedIssue(issue(), 6) },
      },
    },
  };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.activeCount, 2);
    assert.equal(report.alertCount, 1);
    assert.equal(report.issues[0]?.issue.number, 2);
    assert.equal(report.issues[0]?.attentionReason, "new");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flags threshold crossings and added risk evidence", async () => {
  const originalFetch = globalThis.fetch;
  const previous = issue({ title: "Slow build", updated_at: "2026-07-15T00:00:00.000Z" });
  const escalated = issue({
    title: "Slow build can cause data loss",
    updated_at: "2026-07-15T00:30:00.000Z",
  });
  globalThis.fetch = async () => jsonResponse([escalated]);
  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "example/repo": {
        lastSuccessfulScanStartedAt: "2026-07-15T00:00:00.000Z",
        issues: { "1": storedIssue(previous, 1.5) },
      },
    },
  };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.alertCount, 1);
    assert.equal(report.issues[0]?.attentionReason, "threshold-crossed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("flags fresh activity on an already-critical issue", async () => {
  const originalFetch = globalThis.fetch;
  const previous = issue({
    title: "Silent data loss from memory leak",
    updated_at: "2026-07-15T00:00:00.000Z",
  });
  const updated = issue({
    title: previous.title,
    body: "Clarified reproduction steps without new scoring terms.",
    updated_at: "2026-07-15T00:30:00.000Z",
  });
  globalThis.fetch = async () => jsonResponse([updated]);
  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "example/repo": {
        lastSuccessfulScanStartedAt: "2026-07-15T00:00:00.000Z",
        issues: { "1": storedIssue(previous, 9) },
      },
    },
  };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.alertCount, 1);
    assert.equal(report.issues[0]?.attentionReason, "critical-updated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not flag small activity changes inside the same non-critical band", async () => {
  const originalFetch = globalThis.fetch;
  const previous = issue({ updated_at: "2026-07-15T00:00:00.000Z" });
  const updated = issue({
    comments: 1,
    updated_at: "2026-07-15T00:30:00.000Z",
  });
  globalThis.fetch = async () => jsonResponse([updated]);
  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "example/repo": {
        lastSuccessfulScanStartedAt: "2026-07-15T00:00:00.000Z",
        issues: { "1": storedIssue(previous, 6) },
      },
    },
  };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.activeCount, 1);
    assert.equal(report.alertCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not re-alert a critical issue repeated by an overlapping scan window", async () => {
  const originalFetch = globalThis.fetch;
  const critical = issue({
    title: "Silent data loss from memory leak",
    updated_at: "2026-07-15T00:30:00.000Z",
  });
  globalThis.fetch = async () => jsonResponse([critical]);
  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "example/repo": {
        lastSuccessfulScanStartedAt: "2026-07-15T00:00:00.000Z",
        issues: { "1": storedIssue(critical, 9) },
      },
    },
  };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.activeCount, 1);
    assert.equal(report.alertCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removes a fetched closure from the active and attention sets", async () => {
  const originalFetch = globalThis.fetch;
  const open = issue({ updated_at: "2026-07-15T00:00:00.000Z" });
  const closed = issue({
    state: "closed",
    updated_at: "2026-07-15T00:30:00.000Z",
  });
  globalThis.fetch = async () => jsonResponse([closed]);
  const state: ScanState = {
    schemaVersion: 1,
    repos: {
      "example/repo": {
        lastSuccessfulScanStartedAt: "2026-07-15T00:00:00.000Z",
        issues: { "1": storedIssue(open, 6) },
      },
    },
  };

  try {
    const report = await scanWatchlist(config, state, "2026-07-15T01:00:00.000Z");
    assert.equal(report.activeCount, 0);
    assert.equal(report.alertCount, 0);
    assert.equal(report.activeIssues.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
