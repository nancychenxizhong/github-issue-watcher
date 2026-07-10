import type { GitHubIssue, ScoredIssue, SeverityBreakdown } from "./types.js";

// --- Keyword dictionaries ---

/** Keywords that suggest serious, potentially destructive issues */
const CRITICAL_KEYWORDS = [
  "data loss",
  "data corruption",
  "corruption",
  "security vulnerability",
  "remote code execution",
  "rce",
  "privilege escalation",
  "ssd",
  "disk",
  "write amplification",
  "memory leak",
  "oom",
  "out of memory",
  "credential",
  "token leak",
  "silent",
  "silently",
  "undetect",
  "irreversible",
  "permanent",
  "destroy",
  "kills",
  "burning through",
  "endurance",
  "tbw",
] as const;

/** Keywords that suggest moderate severity */
const WARNING_KEYWORDS = [
  "regression",
  "breaking change",
  "breaking",
  "crash",
  "hang",
  "freeze",
  "deadlock",
  "race condition",
  "infinite loop",
  "cpu usage",
  "high cpu",
  "100% cpu",
  "100% disk",
  "performance degradation",
  "slow",
  "timeout",
  "unbounded",
  "grows indefinitely",
  "leak",
  "excessive",
] as const;

/** Labels that signal severity */
const CRITICAL_LABELS = [
  "critical",
  "security",
  "p0",
  "severity: critical",
  "priority: critical",
  "data-loss",
] as const;

const WARNING_LABELS = [
  "bug",
  "regression",
  "breaking-change",
  "p1",
  "severity: high",
  "priority: high",
  "performance",
] as const;

// --- Scoring weights ---

const WEIGHTS = {
  criticalKeyword: 3,
  warningKeyword: 1.5,
  criticalLabel: 3,
  warningLabel: 1,
  /** Per thumbs-up reaction, capped */
  reaction: 0.1,
  reactionCap: 5,
  /** Per comment, capped */
  comment: 0.15,
  commentCap: 4,
  /** Bonus for issues created in the last 48 hours */
  recencyBoost: 1,
  recencyWindowHours: 48,
} as const;

function findKeywordHits(text: string, extraKeywords: readonly string[]): {
  critical: string[];
  warning: string[];
} {
  const lower = text.toLowerCase();
  const allCritical = [...CRITICAL_KEYWORDS, ...extraKeywords];

  const critical = allCritical.filter((kw) => lower.includes(kw.toLowerCase()));
  const warning = WARNING_KEYWORDS.filter((kw) => lower.includes(kw));

  return { critical, warning };
}

function findLabelHits(labels: readonly { name: string }[]): {
  critical: string[];
  warning: string[];
} {
  const labelNames = labels.map((l) => l.name.toLowerCase());
  const critical = CRITICAL_LABELS.filter((cl) => labelNames.some((ln) => ln.includes(cl)));
  const warning = WARNING_LABELS.filter((wl) => labelNames.some((ln) => ln.includes(wl)));
  return { critical, warning };
}

function computeRecencyBoost(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours <= WEIGHTS.recencyWindowHours ? WEIGHTS.recencyBoost : 0;
}

export function scoreIssue(
  owner: string,
  repo: string,
  issue: GitHubIssue,
  extraKeywords: readonly string[] = []
): ScoredIssue {
  const searchableText = `${issue.title} ${issue.body ?? ""}`;

  const keywordHits = findKeywordHits(searchableText, extraKeywords);
  const labelHits = findLabelHits(issue.labels);

  const reactionScore = Math.min(
    issue.reactions["+1"] * WEIGHTS.reaction,
    WEIGHTS.reactionCap
  );

  const commentScore = Math.min(
    issue.comments * WEIGHTS.comment,
    WEIGHTS.commentCap
  );

  const recencyBoost = computeRecencyBoost(issue.created_at);

  // Deduplicate keyword hits (a term might match both critical and warning patterns)
  const allKeywordHits = [...new Set([...keywordHits.critical, ...keywordHits.warning])];
  const allLabelHits = [...new Set([...labelHits.critical, ...labelHits.warning])];

  const severity =
    keywordHits.critical.length * WEIGHTS.criticalKeyword +
    keywordHits.warning.length * WEIGHTS.warningKeyword +
    labelHits.critical.length * WEIGHTS.criticalLabel +
    labelHits.warning.length * WEIGHTS.warningLabel +
    reactionScore +
    commentScore +
    recencyBoost;

  const breakdown: SeverityBreakdown = {
    keywordHits: allKeywordHits,
    labelHits: allLabelHits,
    reactionScore: Math.round(reactionScore * 100) / 100,
    commentScore: Math.round(commentScore * 100) / 100,
    recencyBoost,
  };

  return { owner, repo, issue, severity: Math.round(severity * 100) / 100, breakdown };
}

export function rankIssues(issues: readonly ScoredIssue[]): readonly ScoredIssue[] {
  return [...issues].sort((a, b) => b.severity - a.severity);
}
