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

The same scanner can also run behind the included local report server. In that
mode, the browser requests a report from the server; GitHub credentials and
scan state never go to the browser.

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
npm run lint
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

### Live local report

To run a real scan and open the report in a browser:

```bash
npm run serve
```

Public repositories do not require a token. Set `GITHUB_TOKEN` when you want the
higher authenticated rate limit.

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/). The first page load
performs a scan. The result is held in memory for subsequent page loads, while
the existing state file continues to provide ETag and updated-at caching. Use
the report's **Scan now** control to force a fresh scan.

The repository rail distinguishes a baseline, a fresh update, an unchanged ETag
response, an empty scan window, and an unavailable repository. The report opens
on the focused Attention view; All active exposes the complete stored signal set.

The server exposes these local endpoints:

- `GET /` returns the live HTML report.
- `GET /api/report` returns the current cached report as JSON.
- `POST /api/scan` forces a scan and returns the new report as JSON.
- `GET /health` returns a simple server health response.

The server binds to `127.0.0.1:8765` by default. Pass `--host`, `--port`, and
`--state` after `npm run serve --` to change those settings. Do not expose the
server publicly without adding authentication and HTTPS.

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
- live report server routing and scan caching
- bounded scoring evidence and overlapping keyword suppression
- baseline suppression and meaningful attention-transition classification

Pull requests also run the `ci` workflow, which checks:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

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

Keyword and label evidence uses case-insensitive term boundaries. Overlapping
matches prefer the longer phrase, so `memory leak` does not also count the
generic `leak` term. Each configured term contributes at most once per issue.
Repository-specific `extraKeywords` are currently treated as critical keyword
evidence.

The default threshold (`minSeverity: 3`) catches a single critical keyword or
label match. Raise it if you're watching noisy repos.

## Attention model

The active signal set and the attention queue are deliberately different:

- The first successful scan of each repository establishes a baseline. Existing
  issues are indexed but are not reported as newly discovered alerts.
- A later scan requests attention for a genuinely new issue, a threshold
  crossing, a move into a higher severity band, newly added keyword or label
  evidence, or fresh activity on an already-critical issue.
- Reaction and comment changes inside the same non-critical severity band do not
  create attention items.
- The CLI exits with code 1 only when the attention queue is non-empty. The HTML
  report keeps All active available as a secondary, collapsed view.

Attention is scoped to meaningful transitions found in the current scan. It is
not an acknowledgement or ticket-assignment system. Activity still contributes
to the severity score, so an activity increase can trigger attention when it
crosses a threshold or severity band.

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

For a browser report backed by a real scan, use `npm run serve` instead.

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
| 0    | Scan succeeded with no attention transitions |
| 1    | New or materially changed issues need attention |
| 2    | Fatal error, config or network        |

## License

MIT
