import { fetchRecentIssues } from "./github-client.js";
import { scoreIssue, rankIssues } from "./severity-scorer.js";
import { loadScanState, repoKey, saveScanState } from "./state.js";
import type {
  AttentionReason,
  Config,
  RepoScanState,
  RepoReportSummary,
  ReportResult,
  ScanFailure,
  ScanState,
  ScoredIssue,
  StoredIssue,
  WatchedRepo,
} from "./types.js";

type ScanRepoResult = {
  readonly issues: readonly ScoredIssue[];
  readonly scanStatus: "baseline" | "updated" | "unchanged" | "empty";
};

function severityBand(score: number, minSeverity: number): number {
  if (score < minSeverity) return 0;
  if (score >= 8) return 3;
  if (score >= 5) return 2;
  return 1;
}

function hasAddedEvidence(
  previous: ScoredIssue,
  current: ScoredIssue
): boolean {
  const previousKeywords = new Set(previous.breakdown.keywordHits);
  const previousLabels = new Set(previous.breakdown.labelHits);
  return (
    current.breakdown.keywordHits.some((hit) => !previousKeywords.has(hit)) ||
    current.breakdown.labelHits.some((hit) => !previousLabels.has(hit))
  );
}

function classifyAttention(
  watched: WatchedRepo,
  existing: StoredIssue | undefined,
  current: ScoredIssue,
  minSeverity: number,
  isBaseline: boolean
): AttentionReason | undefined {
  if (isBaseline || current.issue.state !== "open" || current.severity < minSeverity) {
    return undefined;
  }
  if (!existing) return "new";

  const previous = scoreIssue(watched.owner, watched.repo, existing.issue, watched.extraKeywords);
  const previousBand = severityBand(existing.lastSeverity, minSeverity);
  const currentBand = severityBand(current.severity, minSeverity);

  if (previousBand === 0) return "threshold-crossed";
  if (currentBand > previousBand || hasAddedEvidence(previous, current)) {
    return "risk-escalated";
  }

  const wasUpdated =
    new Date(current.issue.updated_at).getTime() > new Date(existing.issue.updated_at).getTime();
  if (current.severity >= 8 && wasUpdated) return "critical-updated";
  return undefined;
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
): Promise<ScanRepoResult> {
  const key = repoKey(watched.owner, watched.repo);
  const previous = repoStateOrDefault(state, key);
  const isBaseline = previous.lastSuccessfulScanStartedAt === undefined;
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
  const previousSeverities = new Map(
    Object.entries(previous.issues).map(([issueNumber, stored]) => [issueNumber, stored.lastSeverity])
  );
  const attentionReasons = new Map<string, AttentionReason>();

  if (!result.notModified) {
    for (const issue of result.issues) {
      const scored = scoreIssue(watched.owner, watched.repo, issue, watched.extraKeywords);
      const issueKey = String(issue.number);
      const existing = previous.issues[issueKey];
      if (existing) {
        previousSeverities.set(issueKey, existing.lastSeverity);
      }
      const attentionReason = classifyAttention(
        watched,
        existing,
        scored,
        config.minSeverity,
        isBaseline
      );
      if (attentionReason) attentionReasons.set(issueKey, attentionReason);
      nextIssues[issueKey] = mergeIssue(previous, scored, scanStartedAt);
    }
  }

  state.repos[key] = {
    lastSuccessfulScanStartedAt: scanStartedAt,
    pageOneEtag: result.pageOneEtag ?? previous.pageOneEtag,
    issues: nextIssues,
  };

  return {
    issues: Object.entries(nextIssues).map(([issueNumber, stored]) => {
      const scored = scoreStoredIssue(
        watched.owner,
        watched.repo,
        stored,
        watched.extraKeywords,
        previousSeverities.get(issueNumber)
      );
      const attentionReason = attentionReasons.get(issueNumber);
      return attentionReason ? { ...scored, attentionReason } : scored;
    }),
    scanStatus: isBaseline
      ? "baseline"
      : result.notModified
        ? "unchanged"
        : result.issues.length === 0
          ? "empty"
          : "updated",
  };
}

export async function scanWatchlist(
  config: Config,
  state: ScanState,
  scanStartedAt = new Date().toISOString()
): Promise<ReportResult> {
  const allScored: ScoredIssue[] = [];
  const failures: ScanFailure[] = [];
  const scannedByRepo = new Map<string, number>();
  const scanStatusByRepo = new Map<string, ScanRepoResult["scanStatus"]>();

  for (const watched of config.repos) {
    const label = `${watched.owner}/${watched.repo}`;

    try {
      const result = await scanRepo(watched, config, state, scanStartedAt);
      scannedByRepo.set(label, result.issues.length);
      scanStatusByRepo.set(label, result.scanStatus);
      allScored.push(...result.issues);
    } catch (err) {
      failures.push({
        owner: watched.owner,
        repo: watched.repo,
        error: (err as Error).message,
      });
    }
  }

  const aboveThreshold = allScored.filter(
    (scored) => scored.issue.state === "open" && scored.severity >= config.minSeverity
  );
  const activeIssues = rankIssues(aboveThreshold);
  const ranked = rankIssues(activeIssues.filter((scored) => scored.attentionReason !== undefined));
  const activeByRepo = new Map<string, number>();
  for (const issue of activeIssues) {
    const key = `${issue.owner}/${issue.repo}`;
    activeByRepo.set(key, (activeByRepo.get(key) ?? 0) + 1);
  }
  const alertsByRepo = new Map<string, number>();
  for (const issue of ranked) {
    const key = `${issue.owner}/${issue.repo}`;
    alertsByRepo.set(key, (alertsByRepo.get(key) ?? 0) + 1);
  }

  const failureByRepo = new Map(
    failures.map((failure) => [`${failure.owner}/${failure.repo}`, failure])
  );
  const repositories: RepoReportSummary[] = config.repos.map((watched) => {
    const key = `${watched.owner}/${watched.repo}`;
    const failure = failureByRepo.get(key);
    return {
      owner: watched.owner,
      repo: watched.repo,
      scanned: scannedByRepo.get(key) ?? 0,
      activeSignals: activeByRepo.get(key) ?? 0,
      alerts: alertsByRepo.get(key) ?? 0,
      status: failure ? "failed" : "ok",
      scanStatus: failure ? "failed" : scanStatusByRepo.get(key) ?? "empty",
      ...(failure ? { error: failure.error } : {}),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays: config.lookbackDays,
    totalScanned: allScored.length,
    activeCount: activeIssues.length,
    alertCount: ranked.length,
    failureCount: failures.length,
    repositories,
    issues: ranked,
    activeIssues,
    failures,
  };
}

export async function scanAndPersist(
  config: Config,
  statePath: string
): Promise<ReportResult> {
  const state = await loadScanState(statePath);
  const report = await scanWatchlist(config, state);
  await saveScanState(statePath, state);
  return report;
}
