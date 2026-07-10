import type { ReportFormat, ReportResult, ScanFailure, ScoredIssue } from "./types.js";

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
    lines.push(color.green("All clear. No issues above severity threshold."));
    lines.push(color.dim(`(scanned ${report.totalScanned} issues across watched repos)`));
    return lines.join("\n");
  }

  lines.push(
    `${color.yellow(`${report.alertCount} issue(s)`)} above threshold ` +
      `(out of ${report.totalScanned} scanned)`
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
    lines.push("All clear. No issues above severity threshold.");
    lines.push(`*Scanned ${report.totalScanned} issues across watched repos.*`);
    return lines.join("\n");
  }

  lines.push(
    `**${report.alertCount} issue(s)** above threshold (${report.totalScanned} total scanned)`
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

function formatIssueHtml(scored: ScoredIssue): string {
  const { owner, repo, issue, severity, breakdown } = scored;
  const keywords = breakdown.keywordHits.map((hit) => `<span>${escapeHtml(hit)}</span>`).join("");
  const labels = breakdown.labelHits.map((hit) => `<span>${escapeHtml(hit)}</span>`).join("");
  const severityDelta =
    scored.previousSeverity === undefined
      ? ""
      : `<span class="delta">${severity >= scored.previousSeverity ? "+" : ""}${Math.round(
          (severity - scored.previousSeverity) * 100
        ) / 100}</span>`;

  return `
    <article class="issue ${severityClass(severity)}" data-repo="${escapeHtml(`${owner}/${repo}`)}" data-severity="${severity}">
      <header>
        <div>
          <a class="issue-link" href="${escapeHtml(issue.html_url)}">${escapeHtml(`${owner}/${repo}#${issue.number}`)}</a>
          <h2>${escapeHtml(issue.title)}</h2>
        </div>
        <strong class="score">${severity}</strong>
      </header>
      <dl>
        <div><dt>Created</dt><dd>${escapeHtml(formatAge(issue.created_at))}</dd></div>
        <div><dt>Updated</dt><dd>${escapeHtml(formatAge(issue.updated_at))}</dd></div>
        <div><dt>First seen</dt><dd>${scored.firstSeenAt ? escapeHtml(formatAge(scored.firstSeenAt)) : "now"}</dd></div>
        <div><dt>Last seen</dt><dd>${scored.lastSeenAt ? escapeHtml(formatAge(scored.lastSeenAt)) : "now"}</dd></div>
        <div><dt>Thumbs-up</dt><dd>${issue.reactions["+1"]}</dd></div>
        <div><dt>Comments</dt><dd>${issue.comments}${severityDelta}</dd></div>
      </dl>
      ${keywords ? `<p class="chips"><b>Keywords</b>${keywords}</p>` : ""}
      ${labels ? `<p class="chips"><b>Labels</b>${labels}</p>` : ""}
    </article>`;
}

function formatFailureHtml(failure: ScanFailure): string {
  return `
    <li>
      <strong>${escapeHtml(`${failure.owner}/${failure.repo}`)}</strong>
      <span>${escapeHtml(failure.error)}</span>
    </li>`;
}

export function formatHtml(report: ReportResult): string {
  const repos = [...new Set(report.issues.map((issue) => `${issue.owner}/${issue.repo}`))].sort();
  const repoOptions = repos
    .map((repo) => `<option value="${escapeHtml(repo)}">${escapeHtml(repo)}</option>`)
    .join("");
  const issues = report.issues.map(formatIssueHtml).join("\n");
  const failures = report.failures.map(formatFailureHtml).join("\n");
  const embedded = JSON.stringify(report).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>github-issue-watcher report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --panel: #ffffff;
      --text: #171717;
      --muted: #5f6b7a;
      --border: #d7dde5;
      --critical: #b42318;
      --warning: #a15c07;
      --notice: #315c85;
      --accent: #0f766e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
    .topbar { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
    h1 { font-size: clamp(28px, 4vw, 44px); line-height: 1; margin: 0 0 12px; letter-spacing: 0; }
    p { color: var(--muted); }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(112px, 1fr)); gap: 10px; margin: 24px 0; }
    .stat, .controls, .issue, .failures { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
    .stat { padding: 14px; }
    .stat span { display: block; color: var(--muted); font-size: 13px; }
    .stat strong { display: block; margin-top: 6px; font-size: 26px; }
    .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px; margin: 0 0 16px; }
    label { color: var(--muted); font-size: 13px; }
    select, input { min-height: 36px; border: 1px solid var(--border); border-radius: 6px; padding: 0 10px; font: inherit; background: white; }
    input { flex: 1 1 260px; }
    .failures { border-color: #f3b4ad; padding: 16px; margin-bottom: 16px; }
    .failures h2 { color: var(--critical); margin: 0 0 10px; font-size: 18px; }
    .failures ul { margin: 0; padding-left: 20px; }
    .failures span { color: var(--muted); }
    .issue { padding: 18px; margin-bottom: 12px; border-left-width: 5px; }
    .issue.critical { border-left-color: var(--critical); }
    .issue.warning { border-left-color: var(--warning); }
    .issue.notice { border-left-color: var(--notice); }
    .issue header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
    .issue-link { color: var(--accent); font-weight: 700; text-decoration: none; }
    .issue h2 { margin: 6px 0 0; font-size: 20px; line-height: 1.25; letter-spacing: 0; }
    .score { min-width: 54px; min-height: 54px; display: grid; place-items: center; border-radius: 8px; background: #eef2f7; font-size: 22px; }
    dl { display: grid; grid-template-columns: repeat(6, minmax(92px, 1fr)); gap: 10px; margin: 16px 0 0; }
    dl div { border-top: 1px solid var(--border); padding-top: 10px; }
    dt { color: var(--muted); font-size: 12px; }
    dd { margin: 4px 0 0; font-weight: 700; }
    .delta { margin-left: 6px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 14px 0 0; }
    .chips b { color: var(--muted); margin-right: 4px; }
    .chips span { border: 1px solid var(--border); border-radius: 999px; padding: 4px 8px; background: #f8fafc; color: var(--text); }
    .empty { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 28px; text-align: center; }
    @media (max-width: 720px) {
      main { width: min(100% - 20px, 1120px); padding-top: 20px; }
      .topbar, .issue header { display: block; }
      .stats, dl { grid-template-columns: repeat(2, 1fr); }
      .score { margin-top: 12px; width: 54px; }
    }
  </style>
</head>
<body>
  <main>
    <section class="topbar">
      <div>
        <h1>github-issue-watcher</h1>
        <p>Generated ${escapeHtml(report.generatedAt)} from ${report.lookbackDays} day(s) of GitHub issue activity.</p>
      </div>
    </section>

    <section class="stats" aria-label="Report summary">
      <div class="stat"><span>Alerts</span><strong>${report.alertCount}</strong></div>
      <div class="stat"><span>Scanned</span><strong>${report.totalScanned}</strong></div>
      <div class="stat"><span>Failures</span><strong>${report.failureCount}</strong></div>
      <div class="stat"><span>Lookback</span><strong>${report.lookbackDays}d</strong></div>
    </section>

    ${failures ? `<section class="failures"><h2>Scan failures</h2><ul>${failures}</ul></section>` : ""}

    <section class="controls" aria-label="Filters">
      <label for="repoFilter">Repo</label>
      <select id="repoFilter">
        <option value="">All repos</option>
        ${repoOptions}
      </select>
      <label for="severityFilter">Severity</label>
      <select id="severityFilter">
        <option value="0">All severities</option>
        <option value="8">Critical 8+</option>
        <option value="5">Warning 5+</option>
      </select>
      <input id="searchFilter" type="search" placeholder="Filter by title, repo, keyword, or label">
    </section>

    <section id="issues">
      ${issues || `<div class="empty"><h2>All clear</h2><p>No issues crossed the configured severity threshold.</p></div>`}
    </section>
  </main>
  <script id="report-data" type="application/json">${embedded}</script>
  <script>
    const repoFilter = document.querySelector("#repoFilter");
    const severityFilter = document.querySelector("#severityFilter");
    const searchFilter = document.querySelector("#searchFilter");
    const cards = Array.from(document.querySelectorAll(".issue"));

    function applyFilters() {
      const repo = repoFilter.value;
      const minSeverity = Number(severityFilter.value);
      const query = searchFilter.value.trim().toLowerCase();

      for (const card of cards) {
        const matchesRepo = !repo || card.dataset.repo === repo;
        const matchesSeverity = Number(card.dataset.severity) >= minSeverity;
        const matchesQuery = !query || card.textContent.toLowerCase().includes(query);
        card.hidden = !(matchesRepo && matchesSeverity && matchesQuery);
      }
    }

    repoFilter.addEventListener("change", applyFilters);
    severityFilter.addEventListener("change", applyFilters);
    searchFilter.addEventListener("input", applyFilters);
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
