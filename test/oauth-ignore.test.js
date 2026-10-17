import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const recursiveRuntimeRules = ["**/.etsy-mcp/", "**/.etsy-mcp-secrets/"];

test("runtime and key directories are recursively excluded", () => {
  const syntheticPaths = [
    ".etsy-mcp/connections.enc",
    ".etsy-mcp/.lock",
    ".etsy-mcp/connections.enc.tmp",
    ".etsy-mcp/connections.enc.backup",
    ".etsy-mcp/operator/connections.enc",
    "nested/.etsy-mcp/connections.enc",
    "nested/.etsy-mcp/.lock",
    "nested/.etsy-mcp/connections.enc.tmp",
    "nested/.etsy-mcp/connections.enc.backup",
    "nested/.etsy-mcp/operator/connections.enc",
    ".etsy-mcp-secrets/oauth.key",
    ".etsy-mcp-secrets/operator/key.bin",
    "nested/.etsy-mcp-secrets/oauth.key",
    "nested/.etsy-mcp-secrets/operator/key.bin",
  ];
  const checkIgnore = spawnSync(
    "git",
    ["check-ignore", "--no-index", "-v", "--stdin"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: `${syntheticPaths.join("\n")}\n`,
    },
  );

  assert.equal(checkIgnore.error, undefined, "git check-ignore should run");
  const checkIgnoreExitCode = checkIgnore.status;
  assert.equal(checkIgnoreExitCode, 0);

  const ignoredPaths = new Set(
    checkIgnore.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(line.lastIndexOf("\t") + 1)),
  );
  for (const syntheticPath of syntheticPaths) {
    assert.ok(ignoredPaths.has(syntheticPath), "A synthetic runtime path was not ignored");
  }

  for (const ignoreFile of [".gitignore", ".dockerignore"]) {
    const rules = readFileSync(path.join(repositoryRoot, ignoreFile), "utf8")
      .split(/\r?\n/)
      .map((rule) => rule.trim());
    for (const requiredRule of recursiveRuntimeRules) {
      assert.ok(rules.includes(requiredRule), "A recursive runtime exclusion is missing");
    }
  }

  const trackedFiles = spawnSync("git", ["ls-files", "--cached", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(trackedFiles.error, undefined, "git ls-files should run");
  assert.equal(trackedFiles.status, 0, "git ls-files should succeed");
  const trackedRuntimeFiles = trackedFiles.stdout
    .split("\0")
    .filter(Boolean)
    .filter((trackedPath) =>
      trackedPath
        .split("/")
        .some((segment) => [".etsy-mcp", ".etsy-mcp-secrets"].includes(segment)),
    );
  assert.equal(trackedRuntimeFiles.length, 0, "Workspace runtime paths must not be tracked");
});
