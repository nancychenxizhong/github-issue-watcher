#!/usr/bin/env node

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { formatHtml } from "./reporter.js";
import { scanAndPersist } from "./scanner.js";
import type { ReportResult } from "./types.js";

export interface ServerOptions {
  readonly configPath: string;
  readonly statePath: string;
  readonly host: string;
  readonly port: number;
}

export function parseServerArgs(argv: readonly string[]): ServerOptions {
  let configPath = "watchlist.json";
  let statePath = "state/issues-state.json";
  let host = "127.0.0.1";
  let port = 8765;
  let sawConfigPath = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--state") {
      const value = argv[++i];
      if (!value) throw new Error("--state requires a file path.");
      statePath = value;
      continue;
    }
    if (arg === "--host") {
      const value = argv[++i];
      if (!value) throw new Error("--host requires a value.");
      host = value;
      continue;
    }
    if (arg === "--port") {
      const value = argv[++i];
      const parsed = Number(value);
      if (!value || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error("--port must be an integer between 1 and 65535.");
      }
      port = parsed;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    if (sawConfigPath) throw new Error(`Unexpected argument: ${arg}`);
    configPath = arg;
    sawConfigPath = true;
  }

  return { configPath, statePath, host, port };
}

export interface ReportServerDependencies {
  readonly scan: () => Promise<ReportResult>;
}

export type ReportRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function writeText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

export function createReportRequestHandler(
  dependencies: ReportServerDependencies
): ReportRequestHandler {
  let cachedReport: ReportResult | undefined;
  let inFlight: Promise<ReportResult> | undefined;

  async function getReport(force: boolean): Promise<ReportResult> {
    if (!force && cachedReport) return cachedReport;
    if (inFlight) return inFlight;

    inFlight = dependencies.scan();
    try {
      cachedReport = await inFlight;
      return cachedReport;
    } finally {
      inFlight = undefined;
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      const report = await getReport(false);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(formatHtml(report, { liveEndpoint: "/api/scan" }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/report") {
      writeJson(response, 200, await getReport(false));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/scan") {
      writeJson(response, 200, await getReport(true));
      return;
    }

    writeText(response, 404, "Not found\n");
  }

  return handle;
}

export function createReportServer(dependencies: ReportServerDependencies): Server {
  const handle = createReportRequestHandler(dependencies);
  return createHttpServer((request, response) => {
    void handle(request, response).catch((err: unknown) => {
      if (response.headersSent) {
        response.destroy(err instanceof Error ? err : undefined);
        return;
      }
      writeJson(response, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  });
}

async function start(): Promise<void> {
  const options = parseServerArgs(process.argv.slice(2));
  const config = await loadConfig(options.configPath);
  const server = createReportServer({
    scan: () => scanAndPersist(config, options.statePath),
  });

  server.listen(options.port, options.host, () => {
    process.stdout.write(`Live report listening at http://${options.host}:${options.port}/\n`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  start().catch((err) => {
    process.stderr.write(`[fatal] ${(err as Error).message}\n`);
    process.exit(2);
  });
}
