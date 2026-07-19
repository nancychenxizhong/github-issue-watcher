import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createReportRequestHandler, parseServerArgs } from "../src/server.js";
import type { ReportResult } from "../src/types.js";

const report: ReportResult = {
  generatedAt: "2026-07-12T00:00:00.000Z",
  lookbackDays: 1,
  totalScanned: 4,
  activeCount: 0,
  alertCount: 0,
  failureCount: 0,
  repositories: [{ owner: "openai", repo: "codex", scanned: 4, activeSignals: 0, alerts: 0, status: "ok", scanStatus: "updated" }],
  issues: [],
  activeIssues: [],
  failures: [],
};

interface MockResponse {
  readonly response: ServerResponse;
  readonly getStatus: () => number;
  readonly getBody: () => string;
}

function mockResponse(): MockResponse {
  let status = 0;
  let body = "";
  const response = {
    headersSent: false,
    writeHead(nextStatus: number) {
      status = nextStatus;
      this.headersSent = true;
    },
    end(value?: string) {
      body = value ?? "";
    },
    destroy() {
      throw new Error("Unexpected response destroy");
    },
  } as unknown as ServerResponse;
  return { response, getStatus: () => status, getBody: () => body };
}

function request(method: string, url: string): IncomingMessage {
  return { method, url, headers: { host: "localhost" } } as IncomingMessage;
}

test("parseServerArgs accepts config, state, host, and port options", () => {
  assert.deepEqual(
    parseServerArgs([
      "config.json",
      "--state",
      "tmp/state.json",
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
    ]),
    {
      configPath: "config.json",
      statePath: "tmp/state.json",
      host: "0.0.0.0",
      port: 9000,
    }
  );
  assert.throws(() => parseServerArgs(["--port", "0"]), /between 1 and 65535/);
});

test("report server caches the page result and force-scans through the API", async () => {
  let scanCount = 0;
  const handle = createReportRequestHandler({
    scan: async () => {
      scanCount += 1;
      return { ...report, generatedAt: `scan-${scanCount}` };
    },
  });

  const health = mockResponse();
  await handle(request("GET", "/health"), health.response);
  assert.equal(health.getStatus(), 200);
  assert.deepEqual(JSON.parse(health.getBody()), { status: "ok" });

  const page = mockResponse();
  await handle(request("GET", "/"), page.response);
  assert.equal(page.getStatus(), 200);
  assert.match(page.getBody(), /Scan now/);
  assert.equal(scanCount, 1);

  const cached = mockResponse();
  await handle(request("GET", "/api/report"), cached.response);
  assert.equal(JSON.parse(cached.getBody()).generatedAt, "scan-1");
  assert.equal(scanCount, 1);

  const fresh = mockResponse();
  await handle(request("POST", "/api/scan"), fresh.response);
  assert.equal(JSON.parse(fresh.getBody()).generatedAt, "scan-2");
  assert.equal(scanCount, 2);

  const missing = mockResponse();
  await handle(request("GET", "/missing"), missing.response);
  assert.equal(missing.getStatus(), 404);
});
