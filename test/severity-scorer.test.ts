import assert from "node:assert/strict";
import test from "node:test";
import { scoreIssue } from "../src/severity-scorer.js";
import type { GitHubIssue } from "../src/types.js";

function issue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 1,
    number: 1,
    title: "Synthetic issue",
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

test("matches bounded phrases and suppresses overlapping keyword evidence", () => {
  const scored = scoreIssue(
    "example",
    "repo",
    issue({ title: "Force a memory leak that fails silently" })
  );

  assert.deepEqual(scored.breakdown.keywordHits, ["memory leak", "silently"]);
  assert.equal(scored.breakdown.keywordHits.includes("rce"), false);
  assert.equal(scored.breakdown.keywordHits.includes("leak"), false);
  assert.equal(scored.breakdown.keywordHits.includes("silent"), false);
  assert.equal(scored.severity, 6);
});

test("matches repository keywords as complete terms", () => {
  const partial = scoreIssue("example", "repo", issue({ title: "Turbopackage build" }), ["turbopack"]);
  const exact = scoreIssue("example", "repo", issue({ title: "Turbopack build" }), ["turbopack"]);

  assert.deepEqual(partial.breakdown.keywordHits, []);
  assert.deepEqual(exact.breakdown.keywordHits, ["turbopack"]);
  assert.equal(exact.severity, 3);
});

test("avoids substring matches in labels and overlapping label names", () => {
  const scored = scoreIssue(
    "example",
    "repo",
    issue({
      labels: [
        { name: "debug", color: "000000" },
        { name: "severity: critical", color: "000000" },
      ],
    })
  );

  assert.deepEqual(scored.breakdown.labelHits, ["severity: critical"]);
  assert.equal(scored.severity, 3);
});
