# Scoring and Alert List Review

## Executive summary

The current scorer is understandable and deterministic, but it is currently
better described as a broad signal detector than a reliable severity model.
Bounded matching and overlap suppression address the clearest mechanical false
positives. The main remaining sources of noise are context-free keyword matches
and treating community activity as severity.

The scanner retains every open issue above `minSeverity`, but the default report
now distinguishes that active set from the much smaller current-scan attention
queue.

## Iteration status

The current implementation pass addresses the highest-confidence issues from
this review:

- keyword and label matches now use term boundaries and suppress overlapping
  evidence
- previous severity is preserved for unchanged and cached repositories
- repository summaries distinguish baseline, updated, unchanged, empty-window,
  and failed scans
- first scans establish a baseline instead of labeling imported history as new
- the HTML report defaults to meaningful transitions and keeps the complete
  active set in a secondary, collapsed view

Activity remains part of the score. Separating risk from activity is still an
open design decision.

## Current behavior

For each watched repository, the scanner:

1. Fetches issues updated in the scan window, using the previous watermark and
   ETag where available.
2. Stores fetched issues in `state/issues-state.json`.
3. Keeps previously stored issues in the repository state.
4. Re-scores the stored issue set.
5. Keeps stored open issues at or above `minSeverity` in the active set.
6. Adds only meaningful current-scan transitions to the attention queue.

`lookbackDays` controls the initial activity window and update watermark. It
does not mean "show only issues from the last N days."

`First seen` means the first time this local state file observed the issue. It
does not mean the GitHub issue was newly created. A `New since baseline`
attention reason is only assigned after that repository has completed its first
successful scan. Attention represents a transition found in this scan; it is
not a complete acknowledgement model.

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

Status: addressed for the default report view.

The scanner starts from the previous issue map and returns the complete stored
set. An old open issue remains visible in All active until it is closed or falls
below the threshold. Initial history establishes a baseline and does not enter
the attention queue. On later scans, attention is limited to new issues,
threshold crossings, upward severity-band moves, added risk evidence, and fresh
activity on already-critical issues.

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

## Recommended next model

Separate three concepts:

- **Risk:** keyword and label evidence, with carefully bounded matching.
- **Activity:** reactions, comments, and recent updates, used for ranking.
- **Lifecycle:** first seen, changed, acknowledged, stale, and resolved.

The current attention view now shows new issues, materially changed issues, and
fresh activity on existing critical issues. A separate All active view preserves
the full historical list. Persisted acknowledgement and ownership remain future
work if the report evolves into a durable task queue.

The next scoring revision should also:

- Give repo-specific keywords explicit weights instead of automatically treating
  every extra keyword as critical.
- Consider updated activity separately from issue creation recency.
