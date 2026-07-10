#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig, validateFormat } from "./config.js";
import { fetchRecentIssues } from "./github-client.js";
import { scoreIssue, rankIssues } from "./severity-scorer.js";
import { formatReport } from "./reporter.js";
import { loadScanState, repoKey, saveScanState } from "./state.js";
import type {
  Config,
  RepoScanState,
  ReportFormat,
  ReportResult,
  ScanFailure,
  ScanState,
  ScoredIssue,
  StoredIssue,
  WatchedRepo,
} from "./types.js";

interface CliOptions {
  readonly configPath: string;
  readonly format?: ReportFormat;
  readonly outputPath?: string;
  readonly statePath: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let configPath = "watchlist.json";
  let format: ReportFormat | undefined;
  let outputPath: string | undefined;
  let statePath = "state/issues-state.json";
  let sawConfigPath = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--format") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--format requires a value.");
      }
      format = validateFormat(value);
      continue;
    }

    if (arg === "--output") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--output requires a file path.");
      }
      outputPath = value;
      continue;
    }

    if (arg === "--state") {
      const value = argv[++i];
      if (!value) {
        throw new Error("--state requires a file path.");
      }
      statePath = value;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (sawConfigPath) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    configPath = arg;
    sawConfigPath = true;
  }

  return { configPath, format, outputPath, statePath };
}

function defaultStopAt(config: Config, scanStartedAt: string): string {
  const date = new Date(scanStartedAt);
  date.setDate(date.getDate() - config.lookbackDays);
  return date.toISOString();
}

function scoreStoredIssue(
  owner: string,
  repo: string,
  stored: StoredIssue,
  extraKeywords: readonly string[] = [],
  previousSeverity?: number
): ScoredIssue {
  const scored = scoreIssue(owner, repo, stored.issue, extraKeywords);
  return {
    ...scored,
    firstSeenAt: stored.firstSeenAt,
    lastSeenAt: stored.lastSeenAt,
    previousSeverity,
  };
}

function repoStateOrDefault(state: ScanState, key: string): RepoScanState {
  return state.repos[key] ?? { issues: {} };
}

function mergeIssue(
  repoState: RepoScanState,
  scanned: ScoredIssue,
  scanStartedAt: string
): StoredIssue {
  const existing = repoState.issues[String(scanned.issue.number)];

  return {
    firstSeenAt: existing?.firstSeenAt ?? scanStartedAt,
    lastSeenAt: scanStartedAt,
    lastSeverity: scanned.severity,
    issue: scanned.issue,
  };
}

async function scanRepo(
  watched: WatchedRepo,
  config: Config,
  state: ScanState,
  scanStartedAt: string
): Promise<readonly ScoredIssue[]> {
  const key = repoKey(watched.owner, watched.repo);
  const previous = repoStateOrDefault(state, key);
  const stopAtUpdatedAt =
    previous.lastSuccessfulScanStartedAt ?? defaultStopAt(config, scanStartedAt);

  const result = await fetchRecentIssues({
    owner: watched.owner,
    repo: watched.repo,
    token: config.githubToken,
    pageOneEtag: previous.pageOneEtag,
    stopAtUpdatedAt,
  });

  const nextIssues: Record<string, StoredIssue> = { ...previous.issues };
  const previousSeverities = new Map<string, number>();

  if (!result.notModified) {
    for (const issue of result.issues) {
      const scored = scoreIssue(watched.owner, watched.repo, issue, watched.extraKeywords);
      const issueKey = String(issue.number);
      const existing = previous.issues[issueKey];
      if (existing) {
        previousSeverities.set(issueKey, existing.lastSeverity);
      }
      nextIssues[String(issue.number)] = mergeIssue(previous, scored, scanStartedAt);
    }
  }

  const nextRepoState: RepoScanState = {
    lastSuccessfulScanStartedAt: scanStartedAt,
    pageOneEtag: result.pageOneEtag ?? previous.pageOneEtag,
    issues: nextIssues,
  };
  state.repos[key] = nextRepoState;

  return Object.entries(nextIssues).map(([issueNumber, stored]) =>
    scoreStoredIssue(
      watched.owner,
      watched.repo,
      stored,
      watched.extraKeywords,
      previousSeverities.get(issueNumber)
    )
  );
}

async function run(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const config: Config = await loadConfig(cli.configPath);
  const outputFormat = cli.format ?? config.format;
  const scanState = await loadScanState(cli.statePath);

  const allScored: ScoredIssue[] = [];
  const failures: ScanFailure[] = [];
  let totalScanned = 0;

  for (const watched of config.repos) {
    const label = `${watched.owner}/${watched.repo}`;
    const scanStartedAt = new Date().toISOString();

    try {
      const scored = await scanRepo(watched, config, scanState, scanStartedAt);
      totalScanned += scored.length;
      allScored.push(...scored);
    } catch (err) {
      failures.push({
        owner: watched.owner,
        repo: watched.repo,
        error: (err as Error).message,
      });
      process.stderr.write(`[error] Failed to scan ${label}: ${(err as Error).message}\n`);
    }
  }

  await saveScanState(cli.statePath, scanState);

  const aboveThreshold = allScored.filter(
    (s) => s.issue.state === "open" && s.severity >= config.minSeverity
  );
  const ranked = rankIssues(aboveThreshold);

  const report: ReportResult = {
    generatedAt: new Date().toISOString(),
    lookbackDays: config.lookbackDays,
    totalScanned,
    alertCount: ranked.length,
    failureCount: failures.length,
    issues: ranked,
    failures,
  };

  const output = formatReport(report, outputFormat);
  if (cli.outputPath) {
    const outputPath = resolve(cli.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output + "\n", "utf-8");
    process.stdout.write(`Wrote ${outputFormat} report to ${outputPath}\n`);
  } else {
    process.stdout.write(output + "\n");
  }

  // Scan failures are fatal: a partial run should never look like "all clear".
  if (failures.length > 0) {
    process.exit(2);
  }

  // Exit non-zero if there are alerts, useful for CI/cron notification hooks.
  if (ranked.length > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  process.stderr.write(`[fatal] ${(err as Error).message}\n`);
  process.exit(2);
});
