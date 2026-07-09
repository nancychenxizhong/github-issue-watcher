# github-issue-watcher

Daily scanner for critical GitHub issues across public repos you depend on.
Catches hardware-killing bugs, security vulnerabilities, and regressions before
they hit the tech press two months later.

Born from the [Codex SSD incident](https://github.com/openai/codex/issues/28224)
where TRACE-level logging silently wrote ~640 TB/year to developers' drives.
The first GitHub issue was filed in April 2026; most developers didn't hear
about it until late June.

## How it works

1. Reads `watchlist.json` in this repo.
2. Fetches recently active issues from those public repos via the GitHub API.
3. Scores each issue by severity signals: destructive keywords, label matching,
   community reaction velocity, and recency.
4. Merges results into a persisted scan state so the next run knows what changed.
5. Outputs a ranked HTML report in the scheduled GitHub Actions run.
6. Exits with code 1 if any issue crosses your severity threshold, so the
   scheduled run becomes a visible alert.

You do not install anything into the repos being watched. A watched repo is just
an `owner/repo` string in `watchlist.json`.

## Quick start: GitHub-hosted watcher

1. Fork or clone this repo.
2. Edit `watchlist.json` and add the public repos you care about.
3. Enable GitHub Actions for the repo.
4. Run the `issue-watcher` workflow manually, or wait for the daily schedule.
5. Open the `issue-watcher-report` artifact from the workflow run.

To add a public repo, edit `watchlist.json`:

```json
{
  "repos": [
    "openai/codex",
    "microsoft/vscode",
    {
      "owner": "vercel",
      "repo": "next.js",
      "extraKeywords": ["turbopack", "build failure"]
    }
  ],
  "lookbackDays": 1,
  "minSeverity": 3,
  "format": "terminal"
}
```

The object form lets you add repo-specific severity keywords without changing
the scanner code.

## Local development

The CLI is still useful for testing scanner changes locally:

```bash
npm install
npm test
npm run typecheck
npm run scan
npm run html
npm run build
node dist/main.js watchlist.json
```

You can also create an ignored `config.json` for private local overrides:

```bash
cp config.example.json config.json
npm run dev
```

The local scan state is written to `state/issues-state.json` by default. Pass
`--state path/to/file.json` to use a different state file.

## Testing

The test suite uses Node's built-in test runner:

```bash
npm test
```

The focused tests cover:

- config parsing and validation
- stable GitHub issue request parameters
- `If-None-Match` / `304 Not Modified` handling
- pull request filtering
- updated-at watermark filtering
- `Link` header pagination
- persisted scan state load/save behavior

## Configuration

The GitHub Actions workflow reads `watchlist.json`. The local CLI accepts a
config path as the first argument and falls back to `watchlist.json` when no path
is provided.

```json
{
  "repos": [
    "openai/codex",
    "vercel/next.js",
    {
      "owner": "prisma",
      "repo": "prisma",
      "extraKeywords": ["migration", "schema drift"]
    }
  ],
  "lookbackDays": 1,
  "minSeverity": 3,
  "format": "terminal"
}
```

`lookbackDays` is used as the initial activity window when a repo has no prior
scan state. After the first successful scan, the watcher uses the repo's last
successful scan start time as its watermark. This keeps older but newly active
issues visible without repeatedly walking the whole issue history.

Supported formats are `terminal`, `markdown`, `json`, and `html`. GitHub Actions
overrides the configured format and writes `report.html` for the downloadable
artifact.

## Request strategy

Each repo scan uses GitHub's repository issues endpoint:

```text
GET /repos/{owner}/{repo}/issues
  ?state=all
  &sort=updated
  &direction=desc
  &per_page=100
```

The request is intentionally sorted by `updated` descending. Pagination stops as
soon as the oldest issue on a page is older than the previous successful scan
watermark.

The watcher stores the page-one `ETag` and sends `If-None-Match` on later runs.
When GitHub returns `304 Not Modified`, the watcher reuses its previous issue
state for that repo and skips pagination.

GitHub documents that authenticated `304 Not Modified` responses do not count
against the primary rate limit, so the included workflow sends requests with the
built-in `GITHUB_TOKEN`. Local unauthenticated runs can still use ETags, but
should not rely on `304` responses preserving the 60-request/hour budget.

GitHub's issues API also returns pull requests, so entries with a `pull_request`
key are filtered out before scoring.

### Authentication

The scheduled GitHub Actions workflow uses its built-in `GITHUB_TOKEN`. For
local runs, unauthenticated GitHub API calls allow 60 requests/hour. With a
token, you get 5,000/hour:

```bash
export GITHUB_TOKEN=ghp_your_token_here
```

The token only needs public repo read access.

## Severity scoring

Issues are scored by a weighted combination of signals:

| Signal              | Weight | Notes                                     |
|---------------------|--------|-------------------------------------------|
| Critical keyword    | 3.0    | "data loss", "corruption", "SSD", etc.    |
| Warning keyword     | 1.5    | "regression", "crash", "memory leak"      |
| Critical label      | 3.0    | "security", "critical", "p0"              |
| Warning label       | 1.0    | "bug", "regression", "performance"        |
| Reactions (+1)      | 0.1/ea | Capped at 5 points                        |
| Comments            | 0.15/ea| Capped at 4 points                        |
| Recency boost       | 1.0    | Issues created in last 48 hours           |

The default threshold (`minSeverity: 3`) catches a single critical keyword or
label match. Raise it if you're watching noisy repos.

## Other scheduling options

The included GitHub Actions workflow is the simplest setup, but the CLI can also
run from cron, launchd, or any other scheduler.

The workflow restores and saves the `state/` directory using GitHub Actions
cache. The HTML report is uploaded as an artifact even when alerts or scan
failures make the job exit non-zero.

### Static HTML report

```bash
npm run html
```

This writes `report.html`, a self-contained page with repo, severity, and search
filters for the generated scan results.

### Linux/macOS cron

```bash
crontab -e
```

```cron
0 8 * * * cd /path/to/github-issue-watcher && /usr/local/bin/node dist/main.js watchlist.json 2>&1 | mail -s "github-issue-watcher daily" you@example.com
```

### Slack webhook integration

Pipe markdown output to a Slack incoming webhook:

```bash
OUTPUT=$(node dist/main.js watchlist.json 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 1 ]; then
  curl -X POST -H 'Content-type: application/json' \
    --data "{\"text\": \"$(echo "$OUTPUT" | head -c 3000)\"}" \
    https://hooks.slack.com/services/YOUR/WEBHOOK/URL
fi
```

## Exit codes

| Code | Meaning                               |
|------|---------------------------------------|
| 0    | All clear, no issues above threshold  |
| 1    | Alerts found, issues above threshold  |
| 2    | Fatal error, config or network        |

## License

MIT
