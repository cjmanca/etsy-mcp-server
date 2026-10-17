import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createOAuthFixture,
  setSyntheticWindowsFixtureAcl,
  syntheticOAuthEnvironment,
} from "./helpers/oauth.js";
import { parseOAuthConfig } from "../build/oauth/config.js";
import * as permissionPolicies from "../build/oauth/permissions.js";
import { verifyStoragePermissions } from "../build/oauth/permissions.js";

test("POSIX ancestor ownership rejects unrelated owners even at 0755", () => {
  const validateOwner = permissionPolicies.assertTrustedPosixAncestorOwner;
  assert.equal(typeof validateOwner, "function");
  assert.doesNotThrow(() => validateOwner(0, 1000));
  assert.doesNotThrow(() => validateOwner(1000, 1000));
  let failure;
  assert.throws(
    () => validateOwner(1001, 1000),
    (error) => {
      failure = error;
      return error.storageDiagnostic?.code === "untrusted_ancestor_owner";
    },
  );
  assert.deepEqual(failure.storageDiagnostic, {
    platform: "posix",
    entry: "ancestor",
    code: "untrusted_ancestor_owner",
  });
});

test("Windows data access is not granted by a current-object InheritOnly ACE", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  await setSyntheticWindowsFixtureAcl(fixture.dataDir, "data-user-inherit-only-modify");

  await assert.rejects(
    permissionPolicies.verifyWindowsAclEntries([{ path: fixture.dataDir, kind: "data" }]),
    (error) => error.storageDiagnostic?.code === "required_data_modify_missing",
  );
});

test("Windows reports an effective foreign DeleteChild grant on an ancestor", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  await setSyntheticWindowsFixtureAcl(fixture.root, "directory-foreign-effective-delete-child");

  await assert.rejects(
    permissionPolicies.verifyWindowsAclEntries([{ path: fixture.root, kind: "ancestor" }]),
    (error) => error.storageDiagnostic?.code === "untrusted_ancestor_acl",
  );
});

test("Windows permits a current-object Delete grant on the actual volume root", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  const volumeRoot = path.parse(fixture.root).root;

  await assert.doesNotReject(
    permissionPolicies.verifyWindowsAclEntries([{ path: volumeRoot, kind: "ancestor" }]),
  );
});

test("Windows still rejects a foreign Delete grant on a replaceable ancestor", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  await setSyntheticWindowsFixtureAcl(fixture.root, "directory-foreign-effective-delete");

  await assert.rejects(
    permissionPolicies.verifyWindowsAclEntries([{ path: fixture.root, kind: "ancestor" }]),
    (error) => error.storageDiagnostic?.code === "untrusted_ancestor_acl",
  );
});

test("Windows ACL receipt uses the same exact bigint identity as an opened NTFS file", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  const receipt = await permissionPolicies.verifyWindowsAclEntries([
    { path: fixture.keyFile, kind: "key" },
  ]);
  const handle = await fs.open(fixture.keyFile, "r");
  try {
    const openedStat = await handle.stat({ bigint: true });
    assert.deepEqual(receipt.keyFile, {
      device: openedStat.dev,
      fileId: openedStat.ino,
    });
  } finally {
    await handle.close();
  }
});

test("unsafe storage fails before reading key bytes", async (t) => {
  const fixture = await createOAuthFixture(t);
  const insideRootKey = path.join(fixture.dataDir, "wrongly-nested.key");
  await fs.writeFile(insideRootKey, Buffer.alloc(32, 0x5a), {
    flag: "wx",
    mode: 0o600,
  });
  const env = syntheticOAuthEnvironment(fixture, {
    ETSY_OAUTH_KEY_FILE: insideRootKey,
  });
  const parsed = parseOAuthConfig(env, false);
  assert.equal(parsed.enabled, true);
  if (!parsed.enabled) return;

  let keyReads = 0;
  const originalOpen = fs.open;
  const originalReadFile = fs.readFile;
  t.mock.method(fs, "open", async function (file, ...args) {
    if (path.resolve(String(file)) === path.resolve(insideRootKey)) keyReads += 1;
    return originalOpen.call(fs, file, ...args);
  });
  t.mock.method(fs, "readFile", async function (file, ...args) {
    if (path.resolve(String(file)) === path.resolve(insideRootKey)) keyReads += 1;
    return originalReadFile.call(fs, file, ...args);
  });

  await assert.rejects(verifyStoragePermissions(parsed.config));
  assert.equal(keyReads, 0);
});

test("missing key fails closed and is never created", async (t) => {
  const fixture = await createOAuthFixture(t);
  const missingKey = path.join(fixture.secretsDir, "not-provisioned.key");
  const env = syntheticOAuthEnvironment(fixture, {
    ETSY_OAUTH_KEY_FILE: missingKey,
  });
  const parsed = parseOAuthConfig(env, false);
  assert.equal(parsed.enabled, true);
  if (!parsed.enabled) return;

  await assert.rejects(verifyStoragePermissions(parsed.config));
  await assert.rejects(fs.lstat(missingKey), { code: "ENOENT" });
});

test("native permission gate accepts protected storage or fails closed with bounded diagnostics", async (t) => {
  const fixture = await createOAuthFixture(t);
  const parsed = parseOAuthConfig(syntheticOAuthEnvironment(fixture), false);
  assert.equal(parsed.enabled, true);
  if (!parsed.enabled) return;

  if (process.platform === "win32") {
    try {
      await verifyStoragePermissions(parsed.config);
      t.diagnostic("Native PowerShell ACL inspection accepted the protected fixture.");
    } catch (error) {
      assert.equal(error.reason, "storage_permissions");
      assert.equal(error.message.includes(fixture.root), false);
      assert.equal(error.message.includes(fixture.keyFile), false);
      assert.deepEqual(Object.keys(error.storageDiagnostic ?? {}).sort(), ["code", "entry", "platform"]);
      assert.equal(error.storageDiagnostic.platform, "windows");
      t.diagnostic(`Native PowerShell ACL diagnostic: ${JSON.stringify(error.storageDiagnostic)}.`);
    }
    return;
  }
  await assert.doesNotReject(verifyStoragePermissions(parsed.config));
});

test("symbolic links in configured storage paths are rejected", async (t) => {
  const fixture = await createOAuthFixture(t);
  const linkPath = path.join(fixture.root, "data-link");
  try {
    await fs.symlink(fixture.dataDir, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32") {
      t.diagnostic("Native Windows symlink/reparse fixture could not be created.");
      return;
    }
    throw error;
  }
  const env = syntheticOAuthEnvironment(fixture, { ETSY_OAUTH_DATA_DIR: linkPath });
  const parsed = parseOAuthConfig(env, false);
  assert.equal(parsed.enabled, true);
  if (!parsed.enabled) return;

  await assert.rejects(verifyStoragePermissions(parsed.config));
});
