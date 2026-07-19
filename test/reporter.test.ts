import assert from "node:assert/strict";
import test from "node:test";
import { formatHtml } from "../src/reporter.js";
import type { GitHubIssue, ReportResult, ScoredIssue } from "../src/types.js";

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

const scoredIssue: ScoredIssue = {
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
  attentionReason: "risk-escalated",
};

const report: ReportResult = {
  generatedAt: "2026-07-11T12:00:00.000Z",
  lookbackDays: 1,
  totalScanned: 20,
  activeCount: 1,
  alertCount: 1,
  failureCount: 1,
  repositories: [
    { owner: "openai", repo: "codex", scanned: 12, activeSignals: 1, alerts: 1, status: "ok", scanStatus: "updated" },
    {
      owner: "anthropics",
      repo: "anthropic-sdk-python",
      scanned: 0,
      activeSignals: 0,
      alerts: 0,
      status: "failed",
      scanStatus: "failed",
      error: "GitHub API error: 503 Service Unavailable",
    },
  ],
  issues: [scoredIssue],
  activeIssues: [scoredIssue],
  failures: [
    {
      owner: "anthropics",
      repo: "anthropic-sdk-python",
      error: "GitHub API error: 503 Service Unavailable",
    },
  ],
};

test("formatHtml renders the severity hierarchy and report context", () => {
  const html = formatHtml(report);

  assert.match(html, /1 change need attention/);
  assert.match(html, /Why this surfaced/);
  assert.match(html, /write amplification/);
  assert.match(html, /All repositories/);
  assert.match(html, /anthropics\/anthropic-sdk-python/);
  assert.match(html, /Scan needs attention/);
  assert.match(html, /data-severity="12\.4"/);
  assert.match(html, /data-severity-band="critical"/);
  assert.match(html, /data-severity-filter="critical"/);
  assert.match(html, /data-severity-filter="warning"/);
  assert.match(html, /data-severity-filter="notice"/);
  assert.match(html, /class="scan-failure-notice"/);
  assert.doesNotMatch(html, /\n\s+\.notice \{/);
  assert.match(html, /data-repo="openai\/codex"/);
  assert.match(html, /data-change="changed"/);
  assert.match(html, /data-attention="true"/);
  assert.match(html, /data-view="attention"/);
  assert.match(html, /data-view="active"/);
  assert.match(html, /id="resultCount"/);

  const liveHtml = formatHtml(report, { liveEndpoint: "/api/scan" });
  assert.match(liveHtml, /id="refreshButton"/);
  assert.match(liveHtml, /data-endpoint="\/api\/scan"/);
});

test("formatHtml groups severity sections and orders lifecycle within them", () => {
  const base = report.issues[0];
  assert.ok(base);
  const sectionIssues: ScoredIssue[] = [
    base,
    {
      ...base,
      issue: { ...issue, number: 43, title: "New critical issue" },
      severity: 10,
      previousSeverity: undefined,
      attentionReason: "new",
    },
    {
      ...base,
      issue: { ...issue, number: 44, title: "Steady critical issue" },
      severity: 11,
      previousSeverity: 11,
      attentionReason: undefined,
    },
    {
      ...base,
      issue: { ...issue, number: 45, title: "Warning issue" },
      severity: 6,
      previousSeverity: 6,
      attentionReason: undefined,
    },
    {
      ...base,
      issue: { ...issue, number: 46, title: "Notice issue" },
      severity: 4,
      previousSeverity: 4,
      attentionReason: undefined,
    },
  ];
  const sectionReport: ReportResult = {
    ...report,
    activeCount: sectionIssues.length,
    alertCount: 2,
    issues: sectionIssues.filter((item) => item.attentionReason !== undefined),
    activeIssues: sectionIssues,
  };

  const html = formatHtml(sectionReport);
  const criticalIndex = html.indexOf('data-severity-section="critical"');
  const warningIndex = html.indexOf('data-severity-section="warning"');
  const noticeIndex = html.indexOf('data-severity-section="notice"');

  assert.ok(criticalIndex >= 0 && criticalIndex < warningIndex);
  assert.ok(warningIndex < noticeIndex);
  assert.doesNotMatch(html, /data-severity-section="critical" open/);
  assert.doesNotMatch(html, /data-severity-section="warning" open/);
  assert.doesNotMatch(html, /data-severity-section="notice" open/);
  assert.match(html, /data-section-count>3 issues/);
  assert.match(html, /data-section-count>1 issue/);

  const newIndex = html.indexOf("#43");
  const changedIndex = html.indexOf("#42");
  const steadyIndex = html.indexOf("#44");
  assert.ok(newIndex < changedIndex && changedIndex < steadyIndex);
});

test("formatHtml escapes issue content and report failures", () => {
  const escapedReport: ReportResult = {
    ...report,
    issues: [{ ...scoredIssue, issue: { ...issue, title: "Unsafe <script>alert(1)</script>" } }],
    activeIssues: [{ ...scoredIssue, issue: { ...issue, title: "Unsafe <script>alert(1)</script>" } }],
  };

  const html = formatHtml(escapedReport);

  assert.match(html, /Unsafe &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<h3>Unsafe <script>/);
  assert.match(html, /503 Service Unavailable/);
});
