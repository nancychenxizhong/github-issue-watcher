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

type WeightedTerm = {
  readonly value: string;
  readonly category: "critical" | "warning";
};

type TermMatch = WeightedTerm & {
  readonly start: number;
  readonly end: number;
};

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9]/.test(value);
}

function hasTermBoundary(text: string, start: number, end: number): boolean {
  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]);
}

function selectTermMatches(text: string, terms: readonly WeightedTerm[]): readonly WeightedTerm[] {
  const lower = text.toLowerCase();
  const uniqueTerms = new Map<string, WeightedTerm>();

  for (const term of terms) {
    const value = term.value.trim().toLowerCase();
    if (!value) continue;

    const existing = uniqueTerms.get(value);
    if (!existing || (term.category === "critical" && existing.category === "warning")) {
      uniqueTerms.set(value, { ...term, value });
    }
  }

  const matches: TermMatch[] = [];
  for (const term of uniqueTerms.values()) {
    let start = lower.indexOf(term.value);
    while (start >= 0) {
      const end = start + term.value.length;
      if (hasTermBoundary(lower, start, end)) {
        matches.push({ ...term, start, end });
      }
      start = lower.indexOf(term.value, start + 1);
    }
  }

  matches.sort((a, b) => {
    const lengthDelta = b.value.length - a.value.length;
    if (lengthDelta !== 0) return lengthDelta;
    if (a.category !== b.category) return a.category === "critical" ? -1 : 1;
    return a.start - b.start;
  });

  const selected: TermMatch[] = [];
  const selectedTerms = new Set<string>();
  for (const match of matches) {
    if (selectedTerms.has(match.value)) continue;
    if (selected.some((other) => match.start < other.end && other.start < match.end)) continue;
    selected.push(match);
    selectedTerms.add(match.value);
  }

  return selected;
}

function findKeywordHits(text: string, extraKeywords: readonly string[]): {
  critical: string[];
  warning: string[];
} {
  const terms: WeightedTerm[] = [
    ...CRITICAL_KEYWORDS.map((value) => ({ value, category: "critical" as const })),
    ...extraKeywords.map((value) => ({ value, category: "critical" as const })),
    ...WARNING_KEYWORDS.map((value) => ({ value, category: "warning" as const })),
  ];
  const matches = selectTermMatches(text, terms);
  return {
    critical: matches.filter((term) => term.category === "critical").map((term) => term.value),
    warning: matches.filter((term) => term.category === "warning").map((term) => term.value),
  };
}

function findLabelHits(labels: readonly { name: string }[]): {
  critical: string[];
  warning: string[];
} {
  const terms: WeightedTerm[] = [
    ...CRITICAL_LABELS.map((value) => ({ value, category: "critical" as const })),
    ...WARNING_LABELS.map((value) => ({ value, category: "warning" as const })),
  ];
  const matchesByValue = new Map<string, WeightedTerm>();

  for (const label of labels) {
    for (const match of selectTermMatches(label.name, terms)) {
      const existing = matchesByValue.get(match.value);
      if (!existing || (match.category === "critical" && existing.category === "warning")) {
        matchesByValue.set(match.value, match);
      }
    }
  }

  const matches = [...matchesByValue.values()];
  return {
    critical: matches.filter((term) => term.category === "critical").map((term) => term.value),
    warning: matches.filter((term) => term.category === "warning").map((term) => term.value),
  };
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
