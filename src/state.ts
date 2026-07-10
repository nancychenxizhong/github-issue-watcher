import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RepoScanState, ScanState } from "./types.js";

const CURRENT_SCHEMA_VERSION = 1;

function emptyState(): ScanState {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, repos: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRepoState(value: unknown, repoKey: string): RepoScanState {
  if (!isRecord(value)) {
    throw new Error(`Invalid scan state for ${repoKey}: expected object.`);
  }

  if (
    value.lastSuccessfulScanStartedAt !== undefined &&
    typeof value.lastSuccessfulScanStartedAt !== "string"
  ) {
    throw new Error(`Invalid scan state for ${repoKey}: lastSuccessfulScanStartedAt must be a string.`);
  }

  if (value.pageOneEtag !== undefined && typeof value.pageOneEtag !== "string") {
    throw new Error(`Invalid scan state for ${repoKey}: pageOneEtag must be a string.`);
  }

  if (!isRecord(value.issues)) {
    throw new Error(`Invalid scan state for ${repoKey}: issues must be an object.`);
  }

  return value as unknown as RepoScanState;
}

export async function loadScanState(statePath: string): Promise<ScanState> {
  const resolved = resolve(statePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    if (!isRecord(parsed)) {
      throw new Error("expected object.");
    }
    if (parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(`unsupported schemaVersion ${String(parsed.schemaVersion)}.`);
    }
    if (!isRecord(parsed.repos)) {
      throw new Error("repos must be an object.");
    }

    const repos: Record<string, RepoScanState> = {};
    for (const [repoKey, repoState] of Object.entries(parsed.repos)) {
      repos[repoKey] = validateRepoState(repoState, repoKey);
    }

    return { schemaVersion: CURRENT_SCHEMA_VERSION, repos };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyState();
    }
    throw new Error(`Failed to load scan state at ${resolved}: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

export async function saveScanState(statePath: string, state: ScanState): Promise<void> {
  const resolved = resolve(statePath);
  await mkdir(dirname(resolved), { recursive: true });

  const tmpPath = `${resolved}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await rename(tmpPath, resolved);
}

export function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
