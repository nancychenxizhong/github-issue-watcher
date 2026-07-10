import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, validateFormat } from "../src/config.js";

async function writeJson(value: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "giw-config-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify(value), "utf-8");
  return path;
}

test("loadConfig parses string and object repo entries", async () => {
  const path = await writeJson({
    repos: [
      " openai/codex ",
      {
        owner: " vercel ",
        repo: " next.js ",
        extraKeywords: [" turbopack ", "build failure"],
      },
    ],
    lookbackDays: 2,
    minSeverity: 4,
    format: "html",
  });

  const config = await loadConfig(path);

  assert.deepEqual(config.repos, [
    { owner: "openai", repo: "codex" },
    { owner: "vercel", repo: "next.js", extraKeywords: ["turbopack", "build failure"] },
  ]);
  assert.equal(config.lookbackDays, 2);
  assert.equal(config.minSeverity, 4);
  assert.equal(config.format, "html");
});

test("loadConfig rejects malformed repo and numeric options", async () => {
  await assert.rejects(
    loadConfig(await writeJson({ repos: ["not-a-slash-repo"] })),
    /expected "owner\/repo"/
  );

  await assert.rejects(
    loadConfig(await writeJson({ repos: ["openai/codex"], lookbackDays: 0 })),
    /lookbackDays must be a positive number/
  );

  await assert.rejects(
    loadConfig(await writeJson({ repos: ["openai/codex"], minSeverity: -1 })),
    /minSeverity must be a non-negative number/
  );
});

test("validateFormat accepts supported report formats", () => {
  assert.equal(validateFormat("terminal"), "terminal");
  assert.equal(validateFormat("markdown"), "markdown");
  assert.equal(validateFormat("json"), "json");
  assert.equal(validateFormat("html"), "html");
  assert.throws(() => validateFormat("pdf"), /Invalid format/);
});
