import type { GitHubIssue } from "./types.js";

const GITHUB_API_BASE = "https://api.github.com";
const PER_PAGE = 100;

interface FetchIssuesParams {
  readonly owner: string;
  readonly repo: string;
  readonly token?: string;
  readonly pageOneEtag?: string;
  readonly stopAtUpdatedAt?: string;
}

type GitHubIssueApiResponse = GitHubIssue & {
  readonly pull_request?: unknown;
};

export interface FetchIssuesResult {
  readonly issues: readonly GitHubIssue[];
  readonly notModified: boolean;
  readonly pageOneEtag?: string;
  readonly pagesFetched: number;
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function buildIssuesUrl(owner: string, repo: string, page: number): string {
  const params = new URLSearchParams({
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: String(PER_PAGE),
    page: String(page),
  });
  return `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?${params}`;
}

function parseNextUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;

  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") {
      return match[1];
    }
  }

  return undefined;
}

function shouldContinuePagination(
  issues: readonly GitHubIssueApiResponse[],
  stopAtUpdatedAt?: string
): boolean {
  if (!stopAtUpdatedAt || issues.length === 0) return true;

  const oldestUpdatedAt = issues[issues.length - 1]?.updated_at;
  if (!oldestUpdatedAt) return false;

  return new Date(oldestUpdatedAt).getTime() >= new Date(stopAtUpdatedAt).getTime();
}

function isWithinScanWindow(issue: GitHubIssueApiResponse, stopAtUpdatedAt?: string): boolean {
  if (!stopAtUpdatedAt) return true;
  return new Date(issue.updated_at).getTime() >= new Date(stopAtUpdatedAt).getTime();
}

function formatRateLimitError(response: Response): string {
  const resetAt = response.headers.get("x-ratelimit-reset");
  const resetDate = resetAt ? new Date(Number(resetAt) * 1000) : null;
  return (
    `GitHub API rate limit exceeded. Resets at ${resetDate?.toISOString() ?? "unknown"}. ` +
    "Consider setting a GITHUB_TOKEN in your config."
  );
}

export async function fetchRecentIssues({
  owner,
  repo,
  token,
  pageOneEtag,
  stopAtUpdatedAt,
}: FetchIssuesParams): Promise<FetchIssuesResult> {
  const headers = buildHeaders(token);
  if (pageOneEtag) {
    headers["If-None-Match"] = pageOneEtag;
  }

  const allIssues: GitHubIssue[] = [];
  let url: string | undefined = buildIssuesUrl(owner, repo, 1);
  let pagesFetched = 0;
  let nextPage = 1;
  let nextPageOneEtag: string | undefined;

  while (url) {
    const response = await fetch(url, { headers });
    pagesFetched++;

    if (nextPage === 1 && response.status === 304) {
      return {
        issues: [],
        notModified: true,
        pageOneEtag,
        pagesFetched,
      };
    }

    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        throw new Error(formatRateLimitError(response));
      }
    }

    if (!response.ok) {
      throw new Error(
        `GitHub API error for ${owner}/${repo}: ${response.status} ${response.statusText}`
      );
    }

    const issues = (await response.json()) as GitHubIssueApiResponse[];
    if (nextPage === 1) {
      nextPageOneEtag = response.headers.get("etag") ?? undefined;
    }

    // GitHub's issues endpoint includes pull requests — filter them out.
    // PRs have a `pull_request` key; plain issues don't.
    const issuesOnly = issues.filter(
      (issue) => !issue.pull_request && isWithinScanWindow(issue, stopAtUpdatedAt)
    );

    allIssues.push(...issuesOnly);

    if (!shouldContinuePagination(issues, stopAtUpdatedAt)) break;

    const nextUrl = parseNextUrl(response.headers.get("link"));
    if (!nextUrl) break;

    url = nextUrl;
    nextPage++;
    delete headers["If-None-Match"];
  }

  return {
    issues: allIssues,
    notModified: false,
    pageOneEtag: nextPageOneEtag,
    pagesFetched,
  };
}
