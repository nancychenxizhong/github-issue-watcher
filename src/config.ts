import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config, ReportFormat, WatchedRepo } from "./types.js";

const DEFAULTS: Omit<Config, "repos"> = {
  lookbackDays: 1,
  minSeverity: 3,
  format: "terminal",
};

interface RawConfig {
  repos?: unknown[];
  githubToken?: string;
  lookbackDays?: unknown;
  minSeverity?: unknown;
  format?: string;
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}: expected a non-empty string.`);
  }
  return value.trim();
}

function parseRepo(entry: unknown, index: number): WatchedRepo {
  if (typeof entry === "string") {
    const parts = entry.trim().split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`repos[${index}]: expected "owner/repo" format, got "${entry}"`);
    }
    return { owner: parts[0].trim(), repo: parts[1].trim() };
  }

  if (typeof entry === "object" && entry !== null) {
    const obj = entry as Record<string, unknown>;
    const owner = parseString(obj.owner, `repos[${index}].owner`);
    const repo = parseString(obj.repo, `repos[${index}].repo`);
    let extraKeywords: readonly string[] | undefined;

    if (obj.extraKeywords !== undefined) {
      if (
        !Array.isArray(obj.extraKeywords) ||
        !obj.extraKeywords.every((k): k is string => typeof k === "string" && k.trim() !== "")
      ) {
        throw new Error(`repos[${index}].extraKeywords must be an array of non-empty strings.`);
      }
      extraKeywords = obj.extraKeywords.map((k) => k.trim());
    }
    return { owner, repo, extraKeywords };
  }

  throw new Error(`repos[${index}]: expected string or object, got ${typeof entry}`);
}

export function validateFormat(value: unknown): ReportFormat {
  if (value === "terminal" || value === "markdown" || value === "json" || value === "html") {
    return value;
  }
  throw new Error(`Invalid format "${value}". Must be "terminal", "markdown", "json", or "html".`);
}

function validateNonNegativeNumber(value: unknown, label: string): number {
  if (value === undefined) {
    throw new Error(`${label}: internal error, missing value.`);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function validatePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

export async function loadConfig(configPath: string): Promise<Config> {
  const resolved = resolve(configPath);
  let raw: RawConfig;

  try {
    const content = await readFile(resolved, "utf-8");
    raw = JSON.parse(content) as RawConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Config file not found: ${resolved}\n` +
          "Copy config.example.json and customize it for your repos.",
        { cause: err }
      );
    }
    throw new Error(`Failed to parse config at ${resolved}: ${(err as Error).message}`, {
      cause: err,
    });
  }

  if (!Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new Error('Config must have a non-empty "repos" array.');
  }

  const repos = raw.repos.map((entry, i) => parseRepo(entry, i));

  // Token: config file > environment variable
  const githubToken = raw.githubToken || process.env.GITHUB_TOKEN || undefined;

  return {
    repos,
    githubToken,
    lookbackDays: validatePositiveNumber(raw.lookbackDays ?? DEFAULTS.lookbackDays, "lookbackDays"),
    minSeverity: validateNonNegativeNumber(raw.minSeverity ?? DEFAULTS.minSeverity, "minSeverity"),
    format: raw.format ? validateFormat(raw.format) : DEFAULTS.format,
  };
}
