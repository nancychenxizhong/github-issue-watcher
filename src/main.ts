#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConfig, validateFormat } from "./config.js";
import { formatReport } from "./reporter.js";
import { scanAndPersist } from "./scanner.js";
import type { ReportFormat } from "./types.js";

interface CliOptions {
  readonly configPath: string;
  readonly format?: ReportFormat;
  readonly outputPath?: string;
  readonly statePath: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let configPath = "watchlist.json";
  let format: ReportFormat | undefined;
  let outputPath: string | undefined;
  let statePath = "state/issues-state.json";
  let sawConfigPath = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--format") {
      const value = argv[++i];
      if (!value) throw new Error("--format requires a value.");
      format = validateFormat(value);
      continue;
    }

    if (arg === "--output") {
      const value = argv[++i];
      if (!value) throw new Error("--output requires a file path.");
      outputPath = value;
      continue;
    }

    if (arg === "--state") {
      const value = argv[++i];
      if (!value) throw new Error("--state requires a file path.");
      statePath = value;
      continue;
    }

    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    if (sawConfigPath) throw new Error(`Unexpected argument: ${arg}`);
    configPath = arg;
    sawConfigPath = true;
  }

  return { configPath, format, outputPath, statePath };
}

async function run(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const config = await loadConfig(cli.configPath);
  const outputFormat = cli.format ?? config.format;
  const report = await scanAndPersist(config, cli.statePath);

  for (const failure of report.failures) {
    process.stderr.write(
      `[error] Failed to scan ${failure.owner}/${failure.repo}: ${failure.error}\n`
    );
  }

  const output = formatReport(report, outputFormat);
  if (cli.outputPath) {
    const outputPath = resolve(cli.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output + "\n", "utf-8");
    process.stdout.write(`Wrote ${outputFormat} report to ${outputPath}\n`);
  } else {
    process.stdout.write(output + "\n");
  }

  if (report.failureCount > 0) process.exit(2);
  if (report.alertCount > 0) process.exit(1);
}

run().catch((err) => {
  process.stderr.write(`[fatal] ${(err as Error).message}\n`);
  process.exit(2);
});
