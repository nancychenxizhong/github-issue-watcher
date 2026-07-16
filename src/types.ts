// --- Configuration ---

export interface WatchedRepo {
  readonly owner: string;
  readonly repo: string;
  /** Override global severity keywords for this repo */
  readonly extraKeywords?: readonly string[];
}

export interface Config {
  readonly repos: readonly WatchedRepo[];
  readonly githubToken?: string;
  /** How many days back to scan (default: 1) */
  readonly lookbackDays: number;
  /** Minimum severity score to include in report (default: 3) */
  readonly minSeverity: number;
  /** Output format */
  readonly format: ReportFormat;
}

export type ReportFormat = "terminal" | "markdown" | "json" | "html";

// --- GitHub API response types (subset we care about) ---

export interface GitHubLabel {
  readonly name: string;
  readonly color: string;
}

export interface GitHubReactions {
  readonly total_count: number;
  readonly "+1": number;
  readonly "-1": number;
}

export interface GitHubUser {
  readonly login: string;
}

export interface GitHubIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly html_url: string;
  readonly state: string;
  readonly labels: readonly GitHubLabel[];
  readonly reactions: GitHubReactions;
  readonly comments: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly user: GitHubUser | null;
}

// --- Scored issue (our domain model) ---

export interface SeverityBreakdown {
  readonly keywordHits: readonly string[];
  readonly labelHits: readonly string[];
  readonly reactionScore: number;
  readonly commentScore: number;
  readonly recencyBoost: number;
}

export interface ScoredIssue {
  readonly owner: string;
  readonly repo: string;
  readonly issue: GitHubIssue;
  readonly severity: number;
  readonly breakdown: SeverityBreakdown;
  readonly firstSeenAt?: string;
  readonly lastSeenAt?: string;
  readonly previousSeverity?: number;
}

// --- Report output ---

export interface ReportResult {
  readonly generatedAt: string;
  readonly lookbackDays: number;
  readonly totalScanned: number;
  readonly alertCount: number;
  readonly failureCount: number;
  readonly repositories: readonly RepoReportSummary[];
  readonly issues: readonly ScoredIssue[];
  readonly failures: readonly ScanFailure[];
}

export interface RepoReportSummary {
  readonly owner: string;
  readonly repo: string;
  readonly scanned: number;
  readonly alerts: number;
  readonly status: "ok" | "failed";
  readonly scanStatus: "updated" | "unchanged" | "empty" | "failed";
  readonly error?: string;
}

export interface ScanFailure {
  readonly owner: string;
  readonly repo: string;
  readonly error: string;
}

// --- Persisted scan state ---

export interface ScanState {
  readonly schemaVersion: 1;
  readonly repos: Record<string, RepoScanState>;
}

export interface RepoScanState {
  readonly lastSuccessfulScanStartedAt?: string;
  readonly pageOneEtag?: string;
  readonly issues: Record<string, StoredIssue>;
}

export interface StoredIssue {
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly lastSeverity: number;
  readonly issue: GitHubIssue;
}
