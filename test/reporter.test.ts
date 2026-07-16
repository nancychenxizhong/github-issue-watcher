import assert from "node:assert/strict";
import test from "node:test";
import { formatHtml } from "../src/reporter.js";
import type { GitHubIssue, ReportResult } from "../src/types.js";

const issue: GitHubIssue = {
  id: 1,
  number: 42,
  title: "Silent write amplification grows over time",
  body: "The issue can cause data loss on affected systems.",
  html_url: "https://github.com/openai/codex/issues/42",
  state: "open",
  labels: [
    { name: "critical", color: "b60205" },
    { name: "bug", color: "d73a4a" },
  ],
  reactions: { total_count: 12, "+1": 10, "-1": 0 },
  comments: 8,
  created_at: "2026-07-10T10:00:00.000Z",
  updated_at: "2026-07-11T10:00:00.000Z",
  user: { login: "octocat" },
};

const report: ReportResult = {
  generatedAt: "2026-07-11T12:00:00.000Z",
  lookbackDays: 1,
  totalScanned: 20,
  alertCount: 1,
  failureCount: 1,
  repositories: [
    { owner: "openai", repo: "codex", scanned: 12, alerts: 1, status: "ok", scanStatus: "updated" },
    {
      owner: "anthropics",
      repo: "anthropic-sdk-python",
      scanned: 0,
      alerts: 0,
      status: "failed",
      scanStatus: "failed",
      error: "GitHub API error: 503 Service Unavailable",
    },
  ],
  issues: [
    {
      owner: "openai",
      repo: "codex",
      issue,
      severity: 12.4,
      breakdown: {
        keywordHits: ["write amplification", "silent", "data loss"],
        labelHits: ["critical", "bug"],
        reactionScore: 1,
        commentScore: 1.2,
        recencyBoost: 1,
      },
      firstSeenAt: "2026-07-11T11:00:00.000Z",
      lastSeenAt: "2026-07-11T12:00:00.000Z",
      previousSeverity: 9.8,
    },
  ],
  failures: [
    {
      owner: "anthropics",
      repo: "anthropic-sdk-python",
      error: "GitHub API error: 503 Service Unavailable",
    },
  ],
};

test("formatHtml renders the triage hierarchy and report context", () => {
  const html = formatHtml(report);

  assert.match(html, /1 signal need attention/);
  assert.match(html, /Why this surfaced/);
  assert.match(html, /write amplification/);
  assert.match(html, /All repositories/);
  assert.match(html, /anthropics\/anthropic-sdk-python/);
  assert.match(html, /Scan needs attention/);
  assert.match(html, /data-severity="12\.4"/);
  assert.match(html, /data-severity="8"/);
  assert.match(html, /data-severity="5"/);
  assert.match(html, /data-repo="openai\/codex"/);
  assert.match(html, /data-change="changed"/);
  assert.match(html, /data-change-filter="new"/);
  assert.match(html, /data-change-filter="changed"/);
  assert.match(html, /id="resultCount"/);

  const liveHtml = formatHtml(report, { liveEndpoint: "/api/scan" });
  assert.match(liveHtml, /id="refreshButton"/);
  assert.match(liveHtml, /data-endpoint="\/api\/scan"/);
});

test("formatHtml escapes issue content and report failures", () => {
  const escapedReport: ReportResult = {
    ...report,
    issues: [
      {
        ...report.issues[0],
        issue: { ...issue, title: "Unsafe <script>alert(1)</script>" },
      },
    ],
  };

  const html = formatHtml(escapedReport);

  assert.match(html, /Unsafe &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<h3>Unsafe <script>/);
  assert.match(html, /503 Service Unavailable/);
});
