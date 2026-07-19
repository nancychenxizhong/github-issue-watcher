import type {
  ReportFormat,
  ReportResult,
  RepoReportSummary,
  ScanFailure,
  ScoredIssue,
} from "./types.js";

// --- ANSI color helpers (terminal only) ---

const color = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
} as const;

function severityBadge(score: number): string {
  if (score >= 8) return color.red(`[CRITICAL ${score}]`);
  if (score >= 5) return color.yellow(`[WARNING ${score}]`);
  return color.dim(`[${score}]`);
}

function severityBadgeMd(score: number): string {
  if (score >= 8) return `**CRITICAL (${score})**`;
  if (score >= 5) return `**WARNING (${score})**`;
  return `(${score})`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAge(dateStr: string): string {
  const ageMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  if (hours < 1) return "< 1 hour ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Terminal formatter ---

function formatIssueTerminal(scored: ScoredIssue): string {
  const { issue, owner, repo, severity, breakdown } = scored;
  const lines: string[] = [];

  lines.push(
    `${severityBadge(severity)} ${color.bold(`${owner}/${repo}#${issue.number}`)} ${truncate(issue.title, 80)}`
  );

  const meta = [
    `${formatAge(issue.created_at)}`,
    `${issue.reactions["+1"]} thumbs-up`,
    `${issue.comments} comments`,
  ].join("  |  ");
  lines.push(`  ${color.dim(meta)}`);

  if (breakdown.keywordHits.length > 0) {
    lines.push(`  ${color.cyan("keywords:")} ${breakdown.keywordHits.join(", ")}`);
  }
  if (breakdown.labelHits.length > 0) {
    lines.push(`  ${color.cyan("labels:")} ${breakdown.labelHits.join(", ")}`);
  }

  lines.push(`  ${color.dim(issue.html_url)}`);

  if (scored.attentionReason) {
    lines.push(`  ${color.yellow(`attention: ${attentionReasonLabel(scored.attentionReason)}`)}`);
  }

  return lines.join("\n");
}

function formatFailureTerminal(failure: ScanFailure): string {
  return `${color.red("[ERROR]")} ${color.bold(`${failure.owner}/${failure.repo}`)} ${failure.error}`;
}

export function formatTerminal(report: ReportResult): string {
  const lines: string[] = [];
  const header = `github-issue-watcher  |  ${report.generatedAt}  |  ${report.lookbackDays}d lookback`;

  lines.push(color.bold(header));
  lines.push(color.dim("=".repeat(header.length)));
  lines.push("");

  if (report.failureCount > 0) {
    lines.push(color.red(`${report.failureCount} repo(s) failed to scan`));
    for (const failure of report.failures) {
      lines.push(formatFailureTerminal(failure));
    }
    lines.push("");
  }

  if (report.alertCount === 0) {
    lines.push(color.green("No new or materially changed issues need attention."));
    lines.push(
      color.dim(`(${report.activeCount} active signals; ${report.totalScanned} stored issues scanned)`)
    );
    return lines.join("\n");
  }

  lines.push(
    `${color.yellow(`${report.alertCount} issue(s)`)} need attention ` +
      `(${report.activeCount} active signals)`
  );
  lines.push("");

  for (const scored of report.issues) {
    lines.push(formatIssueTerminal(scored));
    lines.push("");
  }

  return lines.join("\n");
}

// --- Markdown formatter ---

function formatIssueMd(scored: ScoredIssue): string {
  const { issue, owner, repo, severity, breakdown } = scored;
  const lines: string[] = [];

  lines.push(
    `### ${severityBadgeMd(severity)} [${owner}/${repo}#${issue.number}](${issue.html_url})`
  );
  lines.push("");
  lines.push(`> ${truncate(issue.title, 120)}`);
  lines.push("");

  const meta = [
    `Created: ${formatAge(issue.created_at)}`,
    `Reactions: ${issue.reactions["+1"]}`,
    `Comments: ${issue.comments}`,
  ].join(" | ");
  lines.push(meta);

  if (breakdown.keywordHits.length > 0) {
    lines.push(`Keyword hits: ${breakdown.keywordHits.map((k) => `\`${k}\``).join(", ")}`);
  }
  if (breakdown.labelHits.length > 0) {
    lines.push(`Label hits: ${breakdown.labelHits.map((l) => `\`${l}\``).join(", ")}`);
  }

  return lines.join("\n");
}

function formatFailureMd(failure: ScanFailure): string {
  return `- **${failure.owner}/${failure.repo}**: ${failure.error}`;
}

export function formatMarkdown(report: ReportResult): string {
  const lines: string[] = [];

  lines.push(`# github-issue-watcher report`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt} | Lookback: ${report.lookbackDays} day(s)`);
  lines.push("");

  if (report.failureCount > 0) {
    lines.push(`## Scan failures`);
    lines.push("");
    lines.push(...report.failures.map(formatFailureMd));
    lines.push("");
  }

  if (report.alertCount === 0) {
    lines.push("No new or materially changed issues need attention.");
    lines.push(`*${report.activeCount} active signals; ${report.totalScanned} stored issues scanned.*`);
    return lines.join("\n");
  }

  lines.push(
    `**${report.alertCount} issue(s)** need attention (${report.activeCount} active signals)`
  );
  lines.push("");
  lines.push("---");

  for (const scored of report.issues) {
    lines.push("");
    lines.push(formatIssueMd(scored));
    lines.push("");
    lines.push("---");
  }

  return lines.join("\n");
}

// --- JSON formatter ---

export function formatJson(report: ReportResult): string {
  return JSON.stringify(report, null, 2);
}

// --- HTML formatter ---

function severityClass(score: number): string {
  if (score >= 8) return "critical";
  if (score >= 5) return "warning";
  return "notice";
}

function severityLabel(score: number): string {
  if (score >= 8) return "Critical";
  if (score >= 5) return "Warning";
  return "Notice";
}

function formatSeverityDelta(scored: ScoredIssue): string {
  if (scored.previousSeverity === undefined) return "";
  const delta = Math.round((scored.severity - scored.previousSeverity) * 100) / 100;
  const sign = delta > 0 ? "+" : "";
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "steady";
  return `<span class="change ${direction}">${sign}${delta} since last scan</span>`;
}

function issueChangeKind(scored: ScoredIssue): "new" | "changed" | "steady" {
  if (scored.previousSeverity === undefined) return "new";
  const delta = Math.round((scored.severity - scored.previousSeverity) * 100) / 100;
  return delta === 0 ? "steady" : "changed";
}

function attentionReasonLabel(reason: NonNullable<ScoredIssue["attentionReason"]>): string {
  switch (reason) {
    case "new":
      return "New since baseline";
    case "threshold-crossed":
      return "Crossed attention threshold";
    case "risk-escalated":
      return "Risk evidence increased";
    case "critical-updated":
      return "Critical issue updated";
  }
}

type SeverityBucket = "critical" | "warning" | "notice";

function severityBucket(score: number): SeverityBucket {
  if (score >= 8) return "critical";
  if (score >= 5) return "warning";
  return "notice";
}

function sortIssuesForDisplay(issues: readonly ScoredIssue[]): readonly ScoredIssue[] {
  const changeOrder = { new: 0, changed: 1, steady: 2 } as const;
  return [...issues].sort((a, b) => {
    const changeDelta = changeOrder[issueChangeKind(a)] - changeOrder[issueChangeKind(b)];
    if (changeDelta !== 0) return changeDelta;
    if (b.severity !== a.severity) return b.severity - a.severity;
    return new Date(b.issue.updated_at).getTime() - new Date(a.issue.updated_at).getTime();
  });
}

function formatIssueHtml(scored: ScoredIssue): string {
  const { owner, repo, issue, severity, breakdown } = scored;
  const level = severityClass(severity);
  const changeKind = issueChangeKind(scored);
  const keywords = breakdown.keywordHits
    .map((hit) => `<span class="signal keyword">${escapeHtml(hit)}</span>`)
    .join("");
  const labels = breakdown.labelHits
    .map((hit) => `<span class="signal label">${escapeHtml(hit)}</span>`)
    .join("");
  const evidence = keywords + labels;
  const scoreDetails = [
    breakdown.keywordHits.length > 0 ? `${breakdown.keywordHits.length} keyword signal${breakdown.keywordHits.length === 1 ? "" : "s"}` : "",
    breakdown.labelHits.length > 0 ? `${breakdown.labelHits.length} label signal${breakdown.labelHits.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return `
    <article class="issue ${level}" data-repo="${escapeHtml(`${owner}/${repo}`)}" data-severity="${severity}" data-severity-band="${level}" data-change="${changeKind}" data-attention="${scored.attentionReason ? "true" : "false"}" data-reason="${scored.attentionReason ?? ""}" data-search="${escapeHtml(
      `${owner}/${repo} ${issue.title} ${breakdown.keywordHits.join(" ")} ${breakdown.labelHits.join(" ")}`
    )}">
      <div class="issue-layout">
        <div class="issue-body">
          <div class="issue-kicker">
            <span class="severity-label">${severityLabel(severity)}</span>
            ${scored.attentionReason ? `<span class="attention-label">${escapeHtml(attentionReasonLabel(scored.attentionReason))}</span>` : ""}
            <a class="issue-link" href="${escapeHtml(issue.html_url)}">${escapeHtml(`${owner}/${repo}`)}</a>
            <span class="issue-number">#${issue.number}</span>
          </div>
          <h3>${escapeHtml(issue.title)}</h3>
          <p class="issue-explanation">
            <span class="explanation-label">Why this surfaced</span>
            <span>${escapeHtml(scoreDetails.join(" + ") || "activity and recency")}</span>
          </p>
          ${evidence ? `<div class="signals" aria-label="Scoring signals">${evidence}</div>` : ""}
          <dl class="issue-meta">
            <div><dt>Updated</dt><dd>${escapeHtml(formatAge(issue.updated_at))}</dd></div>
            <div><dt>First seen</dt><dd>${scored.firstSeenAt ? escapeHtml(formatAge(scored.firstSeenAt)) : "now"}</dd></div>
            <div><dt>Thumbs-up</dt><dd>${issue.reactions["+1"]}</dd></div>
            <div><dt>Comments</dt><dd>${issue.comments}</dd></div>
          </dl>
        </div>
        <div class="score-block">
          <span>Score</span>
          <strong>${severity}</strong>
          <span>${formatSeverityDelta(scored) || (scored.attentionReason === "new" ? "New signal" : "Baseline signal")}</span>
        </div>
      </div>
    </article>`;
}

function formatSeveritySection(
  bucket: SeverityBucket,
  label: string,
  issues: readonly ScoredIssue[]
): string {
  if (issues.length === 0) return "";
  const sorted = sortIssuesForDisplay(issues).map(formatIssueHtml).join("\n");
  return `
    <details class="severity-section ${bucket}" data-severity-section="${bucket}">
      <summary>
        <h3>${label}</h3>
        <span class="section-count" data-section-count>${issues.length} issue${issues.length === 1 ? "" : "s"}</span>
      </summary>
      <div class="severity-issues">${sorted}</div>
    </details>`;
}

function formatFailureHtml(failure: ScanFailure): string {
  return `
    <div class="failure-item">
      <strong>${escapeHtml(`${failure.owner}/${failure.repo}`)}</strong>
      <span>${escapeHtml(failure.error)}</span>
    </div>`;
}

function formatRepoHtml(repo: RepoReportSummary): string {
  const key = `${repo.owner}/${repo.repo}`;
  const status = repo.status === "failed"
    ? "Unavailable"
    : repo.scanStatus === "baseline"
      ? `Baseline: ${repo.activeSignals} active`
    : repo.scanStatus === "unchanged"
      ? `Unchanged: ${repo.activeSignals} active`
      : repo.scanStatus === "empty"
        ? "No issues in window"
        : repo.alerts > 0
          ? `${repo.alerts} need attention`
          : `${repo.activeSignals} active, no changes`;
  return `
    <button class="repo-item ${repo.status === "failed" ? "failed" : ""}" type="button" data-repo="${escapeHtml(key)}" aria-pressed="false">
      <span>
        <span class="repo-name">${escapeHtml(key)}</span>
        <span class="repo-status">${escapeHtml(status)}</span>
      </span>
      <strong>${repo.status === "failed" ? "!" : repo.alerts}</strong>
    </button>`;
}

export interface HtmlReportOptions {
  readonly liveEndpoint?: string;
}

export function formatHtml(report: ReportResult, options: HtmlReportOptions = {}): string {
  const criticalCount = report.activeIssues.filter((issue) => issue.severity >= 8).length;
  const warningCount = report.activeIssues.filter((issue) => issue.severity >= 5 && issue.severity < 8).length;
  const noticeCount = report.activeIssues.filter((issue) => issue.severity < 5).length;
  const activeHeading = report.alertCount === 0
    ? "No changes need attention"
    : `${report.alertCount} change${report.alertCount === 1 ? "" : "s"} need attention`;
  const repoItems = report.repositories.map(formatRepoHtml).join("\n");
  const sections = ([("critical" as const), ("warning" as const), ("notice" as const)]).map((bucket) =>
    formatSeveritySection(
      bucket,
      bucket[0].toUpperCase() + bucket.slice(1),
      report.activeIssues.filter((issue) => severityBucket(issue.severity) === bucket)
    )
  ).join("\n");
  const failures = report.failures.map(formatFailureHtml).join("\n");
  const embedded = JSON.stringify(report).replaceAll("<", "\\u003c");
  const liveControls = options.liveEndpoint
    ? `<button id="refreshButton" class="refresh-button" type="button" data-endpoint="${escapeHtml(options.liveEndpoint)}">Scan now</button>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>github-issue-watcher report</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #f6f4ef;
      --surface: #fffdf9;
      --ink: #202124;
      --muted: #77756f;
      --line: #d9d7d0;
      --clay: #a95547;
      --clay-soft: #f4e6e1;
      --warm: #80694f;
      --warm-soft: #f2eee7;
      --neutral: #68717a;
      --neutral-soft: #eff0ed;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--canvas);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(1240px, calc(100% - 48px)); margin: 0 auto; padding: 0 0 64px; }
    .topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; align-items: end; padding: 48px 0 30px; border-bottom: 1px solid var(--line); }
    .eyebrow, .section-kicker { margin: 0 0 12px; color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
    h1 { max-width: 720px; margin: 0; font-size: 48px; line-height: 1.03; letter-spacing: 0; }
    .topbar p { max-width: 680px; margin: 14px 0 0; color: var(--muted); }
    .run-state { display: flex; align-items: center; gap: 10px; padding: 10px 0 10px 18px; border-left: 1px solid var(--line); color: var(--muted); font-size: 13px; white-space: nowrap; }
    .run-state strong { color: var(--ink); }
    .refresh-button { min-height: 32px; margin-left: 6px; padding: 0 10px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--ink); cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
    .refresh-button:hover { border-color: var(--ink); }
    .refresh-button:disabled { cursor: wait; opacity: 0.65; }
    .state-mark { width: 9px; height: 9px; border-radius: 50%; background: var(--neutral); }
    .run-state.partial .state-mark { background: var(--clay); }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; padding: 22px 0; border-bottom: 1px solid var(--line); }
    .summary-item span { display: block; color: var(--muted); font-size: 12px; }
    .summary-item strong { display: block; margin-top: 4px; font-size: 28px; line-height: 1; }
    .summary-item.active strong { color: var(--clay); }
    .summary-item small { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; }
    .layout { display: grid; grid-template-columns: 216px minmax(0, 1fr); gap: 42px; padding-top: 34px; }
    .repo-nav { align-self: start; position: sticky; top: 20px; }
    .repo-nav h2 { margin: 0 0 16px; font-size: 18px; }
    .repo-list { display: grid; gap: 2px; }
    .repo-item { display: flex; justify-content: space-between; gap: 10px; width: 100%; padding: 11px 10px; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--ink); text-align: left; cursor: pointer; font: inherit; }
    .repo-item:hover, .repo-item[aria-pressed="true"] { background: var(--surface); }
    .repo-item[aria-pressed="true"] { border-left: 3px solid var(--clay); padding-left: 7px; }
    .repo-item strong { color: var(--muted); font-size: 13px; }
    .repo-item.failed strong, .repo-item.failed .repo-status { color: var(--clay); }
    .repo-name, .repo-status { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-name { font-size: 13px; font-weight: 700; }
    .repo-status { margin-top: 3px; color: var(--muted); font-size: 11px; }
    .scan-failure-notice { display: grid; gap: 6px; padding: 14px 16px; margin-bottom: 24px; border: 1px solid #e4c9c1; border-left: 3px solid var(--clay); border-radius: 6px; background: var(--clay-soft); }
    .scan-failure-notice h2 { margin: 0; font-size: 15px; }
    .failure-item { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 13px; }
    .failure-item strong { color: var(--ink); }
    .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 10px; margin-bottom: 30px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); }
    .filter-group { display: flex; gap: 4px; }
    .filter-group + .filter-group { padding-left: 12px; border-left: 1px solid var(--line); }
    .filter-button { min-height: 34px; padding: 0 12px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; font: inherit; font-size: 13px; }
    .filter-button:hover { color: var(--ink); }
    .filter-button[aria-pressed="true"] { border-color: var(--ink); background: var(--ink); color: var(--surface); }
    .search-field { display: flex; flex: 1 1 240px; align-items: center; gap: 8px; min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 5px; }
    .search-field span { color: var(--muted); font-size: 12px; }
    input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; }
    .result-count { margin-left: auto; color: var(--muted); font-size: 12px; white-space: nowrap; }
    .feed-header { display: flex; justify-content: space-between; gap: 20px; align-items: end; margin-bottom: 14px; }
    .feed-header h2 { margin: 0; font-size: 22px; }
    .feed-header p { margin: 0; color: var(--muted); font-size: 13px; }
    .severity-section { margin-bottom: 28px; }
    .severity-section > summary { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 0 0 10px 12px; margin-bottom: 12px; border-bottom: 1px solid var(--line); border-left: 3px solid var(--neutral); color: var(--ink); cursor: pointer; list-style: none; }
    .severity-section > summary::-webkit-details-marker { display: none; }
    .severity-section > summary::after { content: "+"; color: var(--muted); font-size: 18px; line-height: 1; }
    .severity-section[open] > summary::after { content: "-"; }
    .severity-section.critical > summary { border-left-color: var(--clay); }
    .severity-section.warning > summary { border-left-color: var(--warm); }
    .severity-section h3 { margin: 0; font-size: 16px; line-height: 1.2; }
    .severity-section .section-count { color: var(--muted); font-size: 12px; font-weight: 700; }
    .severity-section.critical > summary h3 { color: var(--clay); }
    .severity-section.warning > summary h3 { color: var(--warm); }
    .issue { padding: 19px 20px; margin-bottom: 12px; border: 1px solid var(--line); border-left-width: 4px; border-radius: 7px; background: var(--surface); box-shadow: 0 1px 2px rgb(32 33 36 / 4%); }
    .issue.critical { border-left-color: var(--clay); }
    .issue.warning { border-left-color: var(--warm); }
    .issue.notice { border-left-color: var(--neutral); }
    .issue-layout { display: grid; grid-template-columns: minmax(0, 1fr) 94px; gap: 24px; }
    .issue-kicker { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
    .severity-label { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    .attention-label { padding-left: 7px; border-left: 1px solid var(--line); color: var(--ink); font-size: 11px; font-weight: 700; }
    .critical .severity-label, .critical .score-block strong { color: var(--clay); }
    .warning .severity-label, .warning .score-block strong { color: var(--warm); }
    .notice .severity-label, .notice .score-block strong { color: var(--neutral); }
    .issue-link { color: var(--ink); font-weight: 700; text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
    .issue-number { color: var(--muted); }
    .issue h3 { margin: 7px 0 0; font-size: 17px; line-height: 1.32; letter-spacing: 0; }
    .issue-explanation { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; color: var(--muted); font-size: 13px; }
    .explanation-label { color: var(--ink); font-weight: 700; }
    .signals { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .signal { padding: 4px 7px; border: 1px solid var(--line); border-radius: 4px; background: #faf9f5; color: var(--ink); font-size: 12px; }
    .signal.label { background: var(--neutral-soft); }
    .issue-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 16px 0 0; padding-top: 13px; border-top: 1px solid var(--line); }
    .issue-meta div { min-width: 0; }
    dt { color: var(--muted); font-size: 11px; }
    dd { margin: 4px 0 0; color: var(--ink); font-size: 13px; font-weight: 700; }
    .score-block { align-self: start; min-height: 94px; padding: 12px 0 12px 16px; border-left: 1px solid var(--line); background: var(--neutral-soft); text-align: center; }
    .critical .score-block { background: var(--clay-soft); }
    .warning .score-block { background: var(--warm-soft); }
    .score-block span { display: block; color: var(--muted); font-size: 11px; }
    .score-block strong { display: block; margin: 5px 0 4px; font-size: 27px; line-height: 1; }
    .change { display: block; font-size: 10px; }
    .change.up { color: var(--clay); }
    .change.down { color: var(--neutral); }
    .empty { padding: 34px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); text-align: center; }
    .empty h2 { margin: 0; font-size: 22px; }
    .empty p { margin-bottom: 0; color: var(--muted); }
    [hidden] { display: none !important; }
    @media (max-width: 800px) {
      main { width: min(100% - 24px, 680px); }
      .topbar { display: block; padding-top: 28px; }
      h1 { font-size: 34px; }
      .run-state { width: fit-content; margin-top: 22px; padding-left: 0; border-left: 0; }
      .summary { grid-template-columns: repeat(2, 1fr); gap: 20px 16px; }
      .layout { display: block; padding-top: 24px; }
      .repo-nav { position: static; padding-bottom: 22px; margin-bottom: 24px; border-bottom: 1px solid var(--line); }
      .repo-nav h2 { margin-bottom: 10px; }
      .repo-list { display: flex; overflow-x: auto; gap: 4px; padding-bottom: 4px; }
      .repo-item { flex: 0 0 180px; border: 1px solid var(--line); border-radius: 5px; }
      .repo-item[aria-pressed="true"] { padding-left: 7px; }
      .issue-layout { grid-template-columns: 1fr; gap: 16px; }
      .score-block { display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: baseline; min-height: auto; padding: 10px 12px; border: 0; text-align: left; }
      .score-block strong { margin: 0; }
      .score-block span:last-child { text-align: right; }
      .feed-header { display: block; }
      .feed-header p { margin-top: 8px; }
    }
    @media (max-width: 500px) {
      .toolbar { align-items: stretch; }
      .filter-group { overflow-x: auto; }
      .filter-button { flex: 0 0 auto; }
      .search-field { flex-basis: 100%; }
      .result-count { width: 100%; margin-left: 0; }
      .issue { padding: 18px 16px; }
      .issue-meta { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <main>
    <section class="topbar">
      <div>
        <p class="eyebrow">GitHub issue watcher</p>
        <h1>${escapeHtml(activeHeading)}</h1>
        <p>Compared this scan with the saved baseline across ${report.repositories.length} watched repositories. Generated ${escapeHtml(report.generatedAt)}.</p>
      </div>
      <div class="run-state ${report.failureCount > 0 ? "partial" : ""}">
        <span class="state-mark" aria-hidden="true"></span>
        <span><strong>${report.failureCount > 0 ? "Scan needs attention" : "Scan complete"}</strong><br>${report.lookbackDays} day lookback</span>
        ${liveControls}
      </div>
    </section>

    <section class="summary" aria-label="Report summary">
      <div class="summary-item active"><span>Needs attention</span><strong>${report.alertCount}</strong><small>New or materially changed this scan</small></div>
      <div class="summary-item"><span>Active signals</span><strong>${report.activeCount}</strong><small>${criticalCount} critical, ${warningCount} warning, ${noticeCount} notice</small></div>
      <div class="summary-item"><span>Repositories</span><strong>${report.repositories.length}</strong><small>${report.failureCount} unavailable</small></div>
      <div class="summary-item"><span>Lookback</span><strong>${report.lookbackDays}d</strong><small>Since the last scan window</small></div>
    </section>

    <div class="layout">
      <aside class="repo-nav" aria-label="Watched repositories">
        <p class="section-kicker">Watchlist</p>
        <h2>Repositories</h2>
        <div class="repo-list">
          <button class="repo-item" type="button" data-repo="" aria-pressed="true">
            <span><span class="repo-name">All repositories</span><span class="repo-status">Changes requiring review</span></span>
            <strong>${report.alertCount}</strong>
          </button>
          ${repoItems}
        </div>
      </aside>

      <section class="feed" aria-label="Issue signals">
        ${failures ? `<section class="scan-failure-notice" aria-label="Scan failures"><h2>${report.failureCount} repository scan${report.failureCount === 1 ? "" : "s"} unavailable</h2>${failures}</section>` : ""}

        <section class="toolbar" aria-label="Filters">
          <div class="filter-group" role="group" aria-label="Choose report view">
            <button class="filter-button" type="button" data-view="attention" aria-pressed="true">Attention</button>
            <button class="filter-button" type="button" data-view="active" aria-pressed="false">All active</button>
          </div>
          <div class="filter-group" role="group" aria-label="Filter by severity">
            <button class="filter-button" type="button" data-severity-filter="all" aria-pressed="true">All</button>
            <button class="filter-button" type="button" data-severity-filter="critical" aria-pressed="false">Critical</button>
            <button class="filter-button" type="button" data-severity-filter="warning" aria-pressed="false">Warning</button>
            <button class="filter-button" type="button" data-severity-filter="notice" aria-pressed="false">Notice</button>
          </div>
          <label class="search-field" for="searchFilter"><span>Search</span><input id="searchFilter" type="search" placeholder="Title, repo, keyword, or label"></label>
          <span class="result-count" id="resultCount">Showing ${report.alertCount} change${report.alertCount === 1 ? "" : "s"}</span>
        </section>

        <div class="feed-header">
          <div><p class="section-kicker">Review queue</p><h2 id="feedTitle">Changes since the saved baseline</h2></div>
          <p id="feedContext">New issues, risk escalations, and active critical issues.</p>
        </div>

        <section id="issues">
          ${sections || `<div class="empty"><h2>No active signals</h2><p>No open issues crossed the configured severity threshold.</p></div>`}
          ${sections ? `<div id="filteredEmpty" class="empty" hidden><h2>No changes need review</h2><p>The active set is available under All active.</p></div>` : ""}
        </section>
      </section>
    </div>
  </main>
  <script id="report-data" type="application/json">${embedded}</script>
  <script>
    const repoButtons = Array.from(document.querySelectorAll(".repo-item"));
    const viewButtons = Array.from(document.querySelectorAll(".filter-button[data-view]"));
    const severityButtons = Array.from(document.querySelectorAll(".filter-button[data-severity-filter]"));
    const severitySections = Array.from(document.querySelectorAll(".severity-section"));
    const searchFilter = document.querySelector("#searchFilter");
    const cards = Array.from(document.querySelectorAll(".issue"));
    const resultCount = document.querySelector("#resultCount");
    const filteredEmpty = document.querySelector("#filteredEmpty");
    const feedTitle = document.querySelector("#feedTitle");
    const feedContext = document.querySelector("#feedContext");
    const refreshButton = document.querySelector("#refreshButton");
    let activeRepo = "";
    let activeView = "attention";
    let activeSeverity = "all";

    function applyFilters() {
      const query = searchFilter.value.trim().toLowerCase();
      let visibleCount = 0;
      const visibleBySection = new Map();

      for (const card of cards) {
        const matchesRepo = !activeRepo || card.dataset.repo === activeRepo;
        const matchesSeverity = activeSeverity === "all" || card.dataset.severityBand === activeSeverity;
        const matchesView = activeView === "active" || card.dataset.attention === "true";
        const matchesQuery = !query || card.dataset.search.includes(query);
        const visible = matchesRepo && matchesSeverity && matchesView && matchesQuery;
        card.hidden = !visible;
        if (visible) {
          visibleCount += 1;
          const section = card.closest(".severity-section");
          if (section) visibleBySection.set(section, (visibleBySection.get(section) || 0) + 1);
        }
      }

      for (const section of severitySections) {
        const sectionCount = visibleBySection.get(section) || 0;
        const countLabel = section.querySelector("[data-section-count]");
        if (countLabel) countLabel.textContent = sectionCount + " issue" + (sectionCount === 1 ? "" : "s");
        section.hidden = sectionCount === 0;
        section.open = activeView === "attention" && sectionCount > 0;
      }

      resultCount.textContent = "Showing " + visibleCount + (activeView === "attention" ? " change" : " active signal") + (visibleCount === 1 ? "" : "s");
      feedTitle.textContent = activeView === "attention" ? "Changes since the saved baseline" : "All active signals";
      feedContext.textContent = activeView === "attention"
        ? "New issues, risk escalations, and active critical issues."
        : "The complete stored set, grouped and collapsed by severity.";
      if (filteredEmpty) filteredEmpty.hidden = visibleCount !== 0;
    }

    for (const button of repoButtons) {
      button.addEventListener("click", () => {
        activeRepo = button.dataset.repo;
        for (const candidate of repoButtons) candidate.setAttribute("aria-pressed", String(candidate === button));
        applyFilters();
      });
    }

    for (const button of severityButtons) {
      button.addEventListener("click", () => {
        activeSeverity = button.dataset.severityFilter;
        for (const candidate of severityButtons) candidate.setAttribute("aria-pressed", String(candidate === button));
        applyFilters();
      });
    }

    for (const button of viewButtons) {
      button.addEventListener("click", () => {
        activeView = button.dataset.view;
        for (const candidate of viewButtons) candidate.setAttribute("aria-pressed", String(candidate === button));
        applyFilters();
      });
    }

    searchFilter.addEventListener("input", applyFilters);
    applyFilters();

    if (refreshButton) {
      refreshButton.addEventListener("click", async () => {
        refreshButton.disabled = true;
        refreshButton.textContent = "Scanning...";
        try {
          const response = await fetch(refreshButton.dataset.endpoint, { method: "POST" });
          if (!response.ok) throw new Error("Scan request failed");
          window.location.reload();
        } catch {
          refreshButton.disabled = false;
          refreshButton.textContent = "Try again";
        }
      });
    }
  </script>
</body>
</html>`;
}

// --- Dispatcher ---

export function formatReport(report: ReportResult, format: ReportFormat): string {
  switch (format) {
    case "terminal":
      return formatTerminal(report);
    case "markdown":
      return formatMarkdown(report);
    case "json":
      return formatJson(report);
    case "html":
      return formatHtml(report);
  }
}
