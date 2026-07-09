import assert from "node:assert/strict";
import test from "node:test";
import { fetchRecentIssues } from "../src/github-client.js";
import type { GitHubIssue } from "../src/types.js";

type FetchCall = {
  readonly url: string;
  readonly headers: Record<string, string>;
};

function issue(overrides: Partial<GitHubIssue> & { number: number; updated_at: string }): GitHubIssue {
  return {
    id: overrides.number,
    number: overrides.number,
    title: overrides.title ?? `Issue ${overrides.number}`,
    body: overrides.body ?? null,
    html_url: overrides.html_url ?? `https://github.com/acme/widgets/issues/${overrides.number}`,
    state: overrides.state ?? "open",
    labels: overrides.labels ?? [],
    reactions: overrides.reactions ?? { total_count: 0, "+1": 0, "-1": 0 },
    comments: overrides.comments ?? 0,
    created_at: overrides.created_at ?? overrides.updated_at,
    updated_at: overrides.updated_at,
    user: overrides.user ?? { login: "octocat" },
  };
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

test("fetchRecentIssues uses stable updated-desc URL and conditional headers", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
    });
    return new Response(null, {
      status: 304,
      headers: { etag: '"etag-next"' },
    });
  };

  try {
    const result = await fetchRecentIssues({
      owner: "openai",
      repo: "codex",
      token: "token",
      pageOneEtag: '"etag-prev"',
      stopAtUpdatedAt: "2026-07-09T00:00:00.000Z",
    });

    assert.equal(result.notModified, true);
    assert.equal(result.pagesFetched, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /state=all/);
    assert.match(calls[0].url, /sort=updated/);
    assert.match(calls[0].url, /direction=desc/);
    assert.match(calls[0].url, /per_page=100/);
    assert.equal(calls[0].headers.Authorization, "Bearer token");
    assert.equal(calls[0].headers["If-None-Match"], '"etag-prev"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRecentIssues filters pull requests and issues older than the watermark", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    jsonResponse(
      [
        issue({ number: 1, updated_at: "2026-07-09T10:00:00.000Z" }),
        {
          ...issue({ number: 2, updated_at: "2026-07-09T09:00:00.000Z" }),
          pull_request: {},
        },
        issue({ number: 3, updated_at: "2026-07-08T23:59:59.000Z" }),
      ],
      { headers: { etag: '"etag-new"' } }
    );

  try {
    const result = await fetchRecentIssues({
      owner: "acme",
      repo: "widgets",
      stopAtUpdatedAt: "2026-07-09T00:00:00.000Z",
    });

    assert.equal(result.notModified, false);
    assert.equal(result.pageOneEtag, '"etag-new"');
    assert.deepEqual(
      result.issues.map((item) => item.number),
      [1]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRecentIssues follows Link pagination and only sends ETag on page one", async () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const page = new URL(url).searchParams.get("page");
    calls.push({
      url,
      headers: { ...(init?.headers as Record<string, string>) },
    });

    if (page === "1") {
      return jsonResponse([issue({ number: 1, updated_at: "2026-07-09T10:00:00.000Z" })], {
        headers: {
          etag: '"etag-new"',
          link: '<https://api.github.com/repos/acme/widgets/issues?state=all&sort=updated&direction=desc&per_page=100&page=2>; rel="next"',
        },
      });
    }

    return jsonResponse([issue({ number: 2, updated_at: "2026-07-09T09:00:00.000Z" })]);
  };

  try {
    const result = await fetchRecentIssues({
      owner: "acme",
      repo: "widgets",
      pageOneEtag: '"etag-prev"',
      stopAtUpdatedAt: "2026-07-09T00:00:00.000Z",
    });

    assert.equal(result.pagesFetched, 2);
    assert.deepEqual(
      result.issues.map((item) => item.number),
      [1, 2]
    );
    assert.equal(calls[0].headers["If-None-Match"], '"etag-prev"');
    assert.equal(calls[1].headers["If-None-Match"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
