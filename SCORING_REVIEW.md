# Scoring and Alert List Review

## Executive summary

The current scorer is understandable and deterministic, but it is currently
better described as a broad signal detector than a reliable severity model.
The largest sources of noise are substring keyword matching, overlapping
keyword weights, and treating community activity as severity.

The report is also not first-time-only. It shows every open issue that remains
in local state and still scores at or above `minSeverity`.

## Iteration status

The current implementation pass addresses the highest-confidence issues from
this review:

- keyword and label matches now use term boundaries and suppress overlapping
  evidence
- previous severity is preserved for unchanged and cached repositories
- repository summaries distinguish updated, unchanged, empty-window, and failed
  scans
- the HTML report provides New, Changed, and All lifecycle filters

The report still defaults to All active signals, and activity remains part of
the score. Separating risk from activity is still an open design decision.

## Current behavior

For each watched repository, the scanner:

1. Fetches issues updated in the scan window, using the previous watermark and
   ETag where available.
2. Stores fetched issues in `state/issues-state.json`.
3. Keeps previously stored issues in the repository state.
4. Re-scores the stored issue set.
5. Reports stored issues when they are open and meet `minSeverity`.

`lookbackDays` controls the initial activity window and update watermark. It
does not mean "show only issues from the last N days." There is currently no
default filter for new issues, changed issues, or issues not shown before.

`First seen` means the first time this local state file observed the issue. It
does not mean the GitHub issue was newly created. `New signal` means the report
does not have a previous severity value available for comparison; it is not a
complete lifecycle or acknowledgement model.

## Findings

### 1. Keyword matching can create false positives

Status: partially addressed in the current branch.

The previous implementation matched keywords using case-insensitive substring
checks. This meant:

- `rce` can match the word `force`.
- `silent` and `silently` can both score on the same title or body.
- `memory leak` and `leak` can both score the same evidence.
- Negated text such as "not a security vulnerability" still scores.

The current matcher adds term boundaries, prefers longer overlapping phrases,
and counts each configured term once. Negated text still scores, and the UI
describes dictionary matches rather than independent contextual evidence.

### 2. The report is historical and persistent, not first-time-only

Status: lifecycle filters added; default behavior remains historical.

The scanner starts from the previous issue map and returns the complete stored
set. An old open issue remains visible until it is closed or falls below the
threshold. A newly created state file can therefore make a large number of
existing GitHub issues appear to be new at once. The HTML report now lets the
operator narrow this set to New or Changed issues, but All remains the default.

### 3. `New signal` can be over-reported

Status: addressed for cached and unchanged scans.

Previous severities are now initialized from the stored issue map, so a `304
Not Modified` response and older cached issues retain their comparison value.
Issues with no stored predecessor remain correctly marked as New.

### 4. Activity is mixed into severity

Thumbs-up reactions can contribute up to 5 points and comments up to 4 points.
That makes popularity a major part of risk. A harmless but popular feature
request can outrank a low-discussion issue with a genuine operational risk.

Activity is useful for ranking and triage, but it should probably be separate
from the underlying risk score.

### 5. Recency is based on creation, not current activity

The recency bonus applies to issues created within 48 hours. An old issue that
was just updated gets no recency bonus, even though it may have become newly
important. This does not align cleanly with the API query, which is based on
`updated_at`.

### 6. Threshold names and display bands are easy to misread

The default threshold is `3`, while the UI calls scores of `8+` Critical,
`5-7.99` Warning, and `3-4.99` Notice. A single critical keyword or label is
enough to enter the report, but it will still be displayed as Notice. The
keyword's name and the final severity band can therefore appear contradictory.

## Live scan clarification

The current live report returned:

- `failureCount`: `0`
- `openai/codex`: 526 issue records, 348 alerts
- `anthropics/anthropic-sdk-python`: 0 issue records, 0 alerts, status `ok`
- `microsoft/vscode`: 331 issue records, 95 alerts
- `vercel/next.js`: 15 issue records, 9 alerts

Therefore, the Anthropic scan did not fail. GitHub responded successfully, but
the scan produced no issue records for that repository in the current one-day
window after normal filtering. This does not prove the repository has no issues
overall. The report should expose whether a repository was freshly fetched,
returned `304 Not Modified`, or returned zero records so that these cases are
visibly distinct.

## Recommended next model

Separate three concepts:

- **Risk:** keyword and label evidence, with carefully bounded matching.
- **Activity:** reactions, comments, and recent updates, used for ranking.
- **Lifecycle:** first seen, changed, acknowledged, stale, and resolved.

The default attention view should show new issues, materially changed issues,
and unresolved high-risk issues. A separate All Active view can preserve the
full historical list.

The next scoring revision should also:

- Use word boundaries or phrase-aware matching.
- Deduplicate overlapping terms and assign explicit phrase priorities.
- Give repo-specific keywords explicit weights instead of automatically treating
  every extra keyword as critical.
- Store and compare the previous severity on every report path, including 304
  responses.
- Distinguish fetched records, cached records, and unchanged repositories.
- Consider updated activity separately from issue creation recency.
