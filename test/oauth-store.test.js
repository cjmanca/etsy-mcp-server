import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { openConnectionStore } from "../build/oauth/store.js";
import {
  captureTemporaryWrites,
  createOAuthFixture,
  createNativeWindowsOAuthFixture,
  decryptOuterSnapshot,
  decodeBase64Url,
  encryptOuterPayload,
  failTemporaryOperation,
  syntheticConnection,
  syntheticConnectionIdFor,
  syntheticOAuthConfig,
  syntheticStoreAlgorithm,
  syntheticStoreFormat,
  stubWindowsAclForStoreTests,
  writeSyntheticKey,
} from "./helpers/oauth.js";

const STORE_FILE = "connections.enc";
const MAX_ENCRYPTED_BYTES = 4 * 1024 * 1024;
const MAX_DECRYPTED_BYTES = 2 * 1024 * 1024;

function prepareStoreTest(t) {
  stubWindowsAclForStoreTests(t);
}

function safeFailure(error, fixture) {
  assert.equal(error.name, "OAuthError");
  assert.equal(error.message.includes(fixture.root), false);
  assert.equal(error.message.includes(fixture.keyFile), false);
  assert.equal(error.message.includes("synthetic-access-token"), false);
  return true;
}

async function makeSnapshot(t, fixture, record = syntheticConnection()) {
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  try {
    await store.put(record, null);
  } finally {
    await store.close();
  }
}

async function readStoreEnvelope(fixture) {
  return JSON.parse(await fs.readFile(path.join(fixture.dataDir, STORE_FILE), "utf8"));
}

async function assertOpenFailsUnchanged(t, fixture, config = syntheticOAuthConfig(fixture)) {
  const file = path.join(fixture.dataDir, STORE_FILE);
  const before = await fs.readFile(file);
  await assert.rejects(openConnectionStore(config), (error) => safeFailure(error, fixture));
  assert.deepEqual(await fs.readFile(file), before);
}

test("authenticated store round trips without plaintext writes", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const writes = captureTemporaryWrites(t);
  const record = syntheticConnection();
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  try {
    await store.put(record, null);
    assert.deepEqual(await store.read(record.connectionId), record);
  } finally {
    await store.close();
  }

  assert.ok(writes.length > 0);
  for (const bytes of writes) {
    assert.equal(bytes.includes(Buffer.from(record.accessToken)), false);
    assert.equal(bytes.includes(Buffer.from(record.refreshToken)), false);
  }
  const raw = await fs.readFile(path.join(fixture.dataDir, STORE_FILE));
  assert.equal(raw.includes(Buffer.from(record.accessToken)), false);
  assert.equal(raw.includes(Buffer.from(record.refreshToken)), false);

  const reopened = await openConnectionStore(syntheticOAuthConfig(fixture));
  try {
    assert.deepEqual(await reopened.read(record.connectionId), record);
  } finally {
    await reopened.close();
  }
});

test("native Windows protected store acceptance uses real ACLs and atomic replacement", {
  skip: process.platform !== "win32",
}, async (t) => {
  let stage = "fixture-setup";
  let store;
  try {
    const fixture = await createNativeWindowsOAuthFixture(t);
    const config = syntheticOAuthConfig(fixture);
    const keyRelativeToData = path.relative(config.dataDir, config.keyFile);
    assert.equal(
      keyRelativeToData === ".." || keyRelativeToData.startsWith(`..${path.sep}`),
      true,
      "the synthetic key must remain outside the data directory",
    );
    const record = syntheticConnection();
    const snapshotPath = path.join(config.dataDir, STORE_FILE);

    stage = "native-acl-key-validation-and-first-write";
    store = await openConnectionStore(config);
    await store.put(record, null);
    const firstSnapshot = await fs.readFile(snapshotPath);
    assert.equal(firstSnapshot.includes(Buffer.from(record.accessToken)), false);
    assert.equal(firstSnapshot.includes(Buffer.from(record.refreshToken)), false);
    await store.close();
    store = undefined;

    stage = "reopen-and-read";
    store = await openConnectionStore(config);
    assert.equal(isDeepStrictEqual(await store.read(record.connectionId), record), true);

    stage = "atomic-replacement";
    const replacement = { ...record, generation: 2, label: "Native synthetic replacement" };
    await store.put(replacement, 1);
    const replacedSnapshot = await fs.readFile(snapshotPath);
    assert.equal(replacedSnapshot.equals(firstSnapshot), false);
    assert.equal(replacedSnapshot.includes(Buffer.from(replacement.accessToken)), false);
    assert.equal(replacedSnapshot.includes(Buffer.from(replacement.refreshToken)), false);
    assert.equal((await fs.readdir(config.dataDir)).some((entry) => entry.endsWith(".tmp")), false);
    await store.close();
    store = undefined;

    stage = "reopen-replaced-snapshot";
    store = await openConnectionStore(config);
    assert.equal(isDeepStrictEqual(await store.read(replacement.connectionId), replacement), true);
    await store.close();
    store = undefined;

    t.diagnostic(
      "Native NTFS acceptance passed: real ACL checks, synthetic key read, encrypted write, reopen/read, atomic replacement, reopen/read. No paths or credential contents logged.",
    );
  } catch (error) {
    await store?.close().catch(() => {});
    const diagnostic = error?.storageDiagnostic;
    t.diagnostic(JSON.stringify({
      result: "native_acceptance_failed",
      stage,
      diagnostic: diagnostic && {
        platform: diagnostic.platform,
        entry: diagnostic.entry,
        code: diagnostic.code,
      },
    }));
    throw new Error("Native Windows protected-store acceptance failed.");
  }
});

test("store rejects a key-path object swap after permission inspection before reading bytes", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const config = syntheticOAuthConfig(fixture);
  const replacement = path.join(fixture.secretsDir, "replacement.key");
  const originalKey = path.join(fixture.secretsDir, "original.key");
  await writeSyntheticKey(replacement, Buffer.alloc(32, 0x63));

  let swapped = false;
  let keyByteReads = 0;
  let openedStore;
  let failure;
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async function (file, ...args) {
    const isKey = path.resolve(String(file)).toLowerCase() === path.resolve(fixture.keyFile).toLowerCase();
    if (isKey && !swapped) {
      await fs.rename(fixture.keyFile, originalKey);
      await fs.rename(replacement, fixture.keyFile);
      swapped = true;
    }
    const handle = await originalOpen(file, ...args);
    if (!isKey) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "readFile") {
          return async (...readArgs) => {
            keyByteReads += 1;
            return target.readFile(...readArgs);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });

  try {
    openedStore = await openConnectionStore(config);
  } catch (error) {
    failure = error;
  } finally {
    await openedStore?.close();
  }

  assert.equal(swapped, true);
  assert.ok(failure, "the replacement object must be rejected before opening the store");
  assert.equal(failure.storageDiagnostic?.code, "object_identity_mismatch");
  assert.equal(keyByteReads, 0);
});

test("store rejects a snapshot object swap after permission inspection before reading bytes", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const config = syntheticOAuthConfig(fixture);
  const initialStore = await openConnectionStore(config);
  try {
    await initialStore.put(syntheticConnection(), null);
  } finally {
    await initialStore.close();
  }

  const snapshot = path.join(fixture.dataDir, STORE_FILE);
  const replacement = path.join(fixture.secretsDir, "replacement.enc");
  const originalSnapshot = path.join(fixture.secretsDir, "original.enc");
  await fs.copyFile(snapshot, replacement);
  await fs.chmod(replacement, 0o600).catch(() => {});

  let swapped = false;
  let storeByteReads = 0;
  let openedStore;
  let failure;
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async function (file, ...args) {
    const isSnapshot = path.resolve(String(file)).toLowerCase() === path.resolve(snapshot).toLowerCase();
    if (isSnapshot && !swapped) {
      await fs.rename(snapshot, originalSnapshot);
      await fs.rename(replacement, snapshot);
      swapped = true;
    }
    const handle = await originalOpen(file, ...args);
    if (!isSnapshot) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "readFile") {
          return async (...readArgs) => {
            storeByteReads += 1;
            return target.readFile(...readArgs);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });

  try {
    openedStore = await openConnectionStore(config);
  } catch (error) {
    failure = error;
  } finally {
    await openedStore?.close();
  }

  assert.equal(swapped, true);
  assert.ok(failure, "the replacement snapshot object must be rejected before decryption");
  assert.equal(failure.storageDiagnostic?.code, "object_identity_mismatch");
  assert.equal(storeByteReads, 0);
});

test("store rechecks path components after key open and rejects a swapped reparse parent before reading", {
  skip: process.platform !== "win32",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const config = syntheticOAuthConfig(fixture);
  const movedSecretsDir = path.join(fixture.root, "secrets-original");
  const probeTarget = path.join(fixture.root, "junction-target");
  const probeLink = path.join(fixture.root, "junction-probe");
  await fs.mkdir(probeTarget);
  let junctionAvailable = true;
  try {
    await fs.symlink(probeTarget, probeLink, "junction");
  } catch {
    junctionAvailable = false;
  }
  await fs.unlink(probeLink).catch(() => {});
  await fs.rmdir(probeTarget).catch(() => {});
  if (!junctionAvailable) {
    t.diagnostic("Native Windows junction creation is unavailable for the reparse-swap regression.");
    t.skip("native reparse-point fixture unavailable");
    return;
  }

  let swapped = false;
  let keyByteReads = 0;
  let openedStore;
  let failure;
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async function (file, ...args) {
    const isKey = path.resolve(String(file)).toLowerCase() === path.resolve(fixture.keyFile).toLowerCase();
    if (isKey && !swapped) {
      await fs.rename(fixture.secretsDir, movedSecretsDir);
      await fs.symlink(movedSecretsDir, fixture.secretsDir, "junction");
      swapped = true;
    }
    const handle = await originalOpen(file, ...args);
    if (!isKey) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "readFile") {
          return async (...readArgs) => {
            keyByteReads += 1;
            return target.readFile(...readArgs);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });

  try {
    openedStore = await openConnectionStore(config);
  } catch (error) {
    failure = error;
  } finally {
    await openedStore?.close();
    if (swapped) {
      await fs.unlink(fixture.secretsDir).catch(() => {});
      await fs.rename(movedSecretsDir, fixture.secretsDir);
    }
  }

  assert.equal(swapped, true);
  assert.ok(failure, "a reparse parent introduced after permission inspection must fail closed");
  assert.equal(failure.storageDiagnostic?.code, "reparse_point");
  assert.equal(keyByteReads, 0);
});

test("snapshot and record envelopes use fresh nonces and nested authenticated metadata", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  const first = syntheticConnection();
  const second = syntheticConnection({
    connectionId: syntheticConnectionIdFor(2),
    label: "Second synthetic fixture",
  });
  try {
    await store.put(first, null);
    const firstEnvelope = await readStoreEnvelope(fixture);
    const firstSnapshot = JSON.parse(decryptOuterSnapshot(firstEnvelope));
    const firstRecord = firstSnapshot.records[0];

    await store.put(second, null);
    const secondEnvelope = await readStoreEnvelope(fixture);
    const secondSnapshot = JSON.parse(decryptOuterSnapshot(secondEnvelope));
    const secondRecord = secondSnapshot.records.find((item) => item.connectionId === second.connectionId);

    assert.deepEqual(Object.keys(secondEnvelope).sort(), [
      "algorithm",
      "ciphertext",
      "format",
      "generation",
      "nonce",
      "operatorId",
      "storeId",
      "tag",
    ]);
    assert.equal(secondEnvelope.format, syntheticStoreFormat);
    assert.equal(secondEnvelope.algorithm, syntheticStoreAlgorithm);
    assert.equal("accountId" in secondEnvelope, false);
    assert.equal("connectionId" in secondEnvelope, false);
    assert.equal(secondSnapshot.owner.operatorId, "synthetic_operator");
    assert.ok(secondSnapshot.owner.appFingerprint);
    assert.equal(secondSnapshot.records.length, 2);

    const firstNonce = decodeBase64Url(firstEnvelope.nonce);
    const secondNonce = decodeBase64Url(secondEnvelope.nonce);
    const innerNonces = secondSnapshot.records.map((item) => decodeBase64Url(item.nonce));
    assert.equal(firstNonce.length, 12);
    assert.equal(secondNonce.length, 12);
    assert.notDeepEqual(firstNonce, secondNonce);
    assert.equal(innerNonces.every((nonce) => nonce.length === 12), true);
    assert.equal(
      new Set([secondNonce.toString("hex"), ...innerNonces.map((nonce) => nonce.toString("hex"))]).size,
      1 + innerNonces.length,
    );
    assert.equal(decodeBase64Url(secondEnvelope.tag).length, 16);
    assert.equal(decodeBase64Url(firstRecord.tag).length, 16);
    assert.equal(decodeBase64Url(secondRecord.tag).length, 16);
    assert.equal(JSON.stringify(secondSnapshot).includes(first.accessToken), false);
  } finally {
    await store.close();
  }
});

test("record metadata tampering is rejected without modifying the ciphertext file", async (t) => {
  const fixture = await createOAuthFixture(t);
  await makeSnapshot(t, fixture);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const envelope = await readStoreEnvelope(fixture);
  const snapshot = JSON.parse(decryptOuterSnapshot(envelope));
  snapshot.records[0].accountId += 1;
  const reauthenticatedOuter = encryptOuterPayload(
    {
      storeId: envelope.storeId,
      operatorId: envelope.operatorId,
      generation: envelope.generation,
    },
    JSON.stringify(snapshot),
  );
  await fs.writeFile(file, JSON.stringify(reauthenticatedOuter), { mode: 0o600 });

  const tamperedBytes = await fs.readFile(file);
  await assert.rejects(
    openConnectionStore(syntheticOAuthConfig(fixture)),
    (error) => safeFailure(error, fixture),
  );
  assert.deepEqual(await fs.readFile(file), tamperedBytes);
});

test("outer AAD tampering, wrong keys, and corrupt ciphertext fail without reset", async (t) => {
  const fixture = await createOAuthFixture(t);
  await makeSnapshot(t, fixture);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const original = await fs.readFile(file, "utf8");
  const envelope = JSON.parse(original);

  envelope.generation += 1;
  await fs.writeFile(file, JSON.stringify(envelope), { mode: 0o600 });
  await assertOpenFailsUnchanged(t, fixture);

  await fs.writeFile(file, original, { mode: 0o600 });
  const wrongKeyFile = path.join(fixture.secretsDir, "wrong.key");
  await writeSyntheticKey(wrongKeyFile, Buffer.alloc(32, 0x24));
  const wrongConfig = syntheticOAuthConfig(fixture, { ETSY_OAUTH_KEY_FILE: wrongKeyFile });
  await assertOpenFailsUnchanged(t, fixture, wrongConfig);

  const corrupt = JSON.parse(original);
  corrupt.ciphertext = `${corrupt.ciphertext[0] === "A" ? "B" : "A"}${corrupt.ciphertext.slice(1)}`;
  await fs.writeFile(file, JSON.stringify(corrupt), { mode: 0o600 });
  await assertOpenFailsUnchanged(t, fixture);
});

test("unknown format and app-owner mismatch are recovery failures, not empty stores", async (t) => {
  const fixture = await createOAuthFixture(t);
  await makeSnapshot(t, fixture);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const original = await fs.readFile(file, "utf8");
  const unknown = JSON.parse(original);
  unknown.format = 99;
  await fs.writeFile(file, JSON.stringify(unknown), { mode: 0o600 });
  await assertOpenFailsUnchanged(t, fixture);

  await fs.writeFile(file, original, { mode: 0o600 });
  const otherApp = syntheticOAuthConfig(fixture, {
    ETSY_API_KEY: "different-keystring:synthetic-shared-secret",
  });
  await assertOpenFailsUnchanged(t, fixture, otherApp);
});

test("encrypted and decrypted snapshot size limits are enforced before reset", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const oversized = Buffer.alloc(MAX_ENCRYPTED_BYTES + 1, 0x5a);
  await fs.writeFile(file, oversized, { mode: 0o600 });
  await assert.rejects(
    openConnectionStore(syntheticOAuthConfig(fixture)),
    (error) => safeFailure(error, fixture),
  );
  assert.deepEqual(await fs.readFile(file), oversized);

  const config = syntheticOAuthConfig(fixture);
  const largePlaintext = Buffer.alloc(MAX_DECRYPTED_BYTES + 1, 0x20);
  const largeEnvelope = encryptOuterPayload(
    {
      storeId: "123e4567-e89b-42d3-a456-426614174000",
      operatorId: config.owner.operatorId,
      generation: 1,
    },
    largePlaintext,
  );
  const largeBytes = Buffer.from(JSON.stringify(largeEnvelope));
  assert.ok(largeBytes.length < MAX_ENCRYPTED_BYTES);
  await fs.writeFile(file, largeBytes, { mode: 0o600 });
  await assert.rejects(
    openConnectionStore(config),
    (error) => safeFailure(error, fixture),
  );
  assert.deepEqual(await fs.readFile(file), largeBytes);
});

test("token bounds, validated IDs, and the 100-record limit are enforced", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  try {
    const exactToken = `12345.${"x".repeat(16_384 - 6)}`;
    const first = syntheticConnection({ accessToken: exactToken });
    await store.put(first, null);
    await assert.rejects(
      store.put({ ...syntheticConnection(), accessToken: `${exactToken}x` }, null),
      (error) => error.reason === "record_invalid",
    );
    await assert.rejects(
      store.read("../not-a-connection-path"),
      (error) => error.reason === "record_invalid",
    );

    for (let index = 1; index < 100; index += 1) {
      await store.put(
        syntheticConnection({ connectionId: syntheticConnectionIdFor(index + 1) }),
        null,
      );
    }
    await assert.rejects(
      store.put(syntheticConnection({ connectionId: syntheticConnectionIdFor(101) }), null),
      (error) => error.reason === "record_invalid",
    );
  } finally {
    await store.close();
  }
});

test("generation compare-and-swap rejects lost writes and deletes", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  const first = syntheticConnection();
  try {
    await store.put(first, null);
    await assert.rejects(
      store.put({ ...first, generation: 2 }, 0),
      (error) => error.reason === "generation_conflict",
    );
    await assert.rejects(
      store.remove(first.connectionId, 4),
      (error) => error.reason === "generation_conflict",
    );
    assert.deepEqual(await store.read(first.connectionId), first);

    const updated = { ...first, generation: 2, label: "Updated fixture" };
    await store.put(updated, 1);
    await assert.rejects(
      store.put({ ...updated, generation: 3 }, 1),
      (error) => error.reason === "generation_conflict",
    );
    await store.remove(first.connectionId, 2);
    assert.equal(await store.read(first.connectionId), undefined);
    await assert.rejects(
      store.put({ ...first, generation: 1 }, null),
      (error) => error.reason === "generation_conflict",
    );
  } finally {
    await store.close();
  }
});

test("owner lock collision fails closed and never guesses stale ownership", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const config = syntheticOAuthConfig(fixture);
  const first = await openConnectionStore(config);
  let lockDirectory;
  try {
    const entries = await fs.readdir(fixture.dataDir, { withFileTypes: true });
    const lock = entries.find((entry) => entry.isDirectory() && entry.name.includes("lock"));
    assert.ok(lock);
    lockDirectory = path.join(fixture.dataDir, lock.name);
    const lockBefore = await fs.readFile(path.join(lockDirectory, "owner.json"));
    await assert.rejects(openConnectionStore(config), (error) => error.reason === "storage_conflict");
    assert.deepEqual(await fs.readFile(path.join(lockDirectory, "owner.json")), lockBefore);
  } finally {
    await first.close();
  }

  await fs.mkdir(lockDirectory, { mode: 0o700 });
  const staleMetadata = Buffer.from(
    JSON.stringify({ format: 1, pid: 2_000_000_000, bootId: "synthetic-stale-lock", createdAt: 1 }),
  );
  await fs.writeFile(path.join(lockDirectory, "owner.json"), staleMetadata, { mode: 0o600 });
  await assert.rejects(openConnectionStore(config), (error) => error.reason === "storage_conflict");
  assert.deepEqual(await fs.readFile(path.join(lockDirectory, "owner.json")), staleMetadata);
});

test("failed recovery-marker persistence retains the protected ownership lock", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const config = syntheticOAuthConfig(fixture);
  const store = await openConnectionStore(config);
  const markerPath = path.join(fixture.dataDir, "oauth-recovery-required.json");
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async (file, ...args) => {
    if (path.resolve(String(file)) === path.resolve(markerPath)) {
      throw Object.assign(new Error("Synthetic marker disk-full failure."), { code: "ENOSPC" });
    }
    return originalOpen(file, ...args);
  });

  try {
    assert.equal(typeof store.markRecoveryRequired, "function");
    await assert.rejects(
      store.markRecoveryRequired(),
      { name: "OAuthError", reason: "storage_recovery_required" },
    );
  } finally {
    await store.close();
  }

  await assert.rejects(
    openConnectionStore(config),
    { name: "OAuthError", reason: "storage_conflict" },
    "ordinary reopen must remain blocked by the retained owner lock",
  );
});

test("owner-mismatched recovery marker blocks startup before key reads", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const config = syntheticOAuthConfig(fixture);
  const markerPath = path.join(fixture.dataDir, "oauth-recovery-required.json");
  await fs.writeFile(markerPath, JSON.stringify({
    format: 1,
    owner: {
      operatorId: "different_operator",
      appFingerprint: config.owner.appFingerprint,
    },
    reason: "uncertain_connection_rollback",
  }), { flag: "wx", mode: 0o600 });
  let keyOpens = 0;
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async (file, ...args) => {
    if (path.resolve(String(file)) === path.resolve(config.keyFile)) keyOpens += 1;
    return originalOpen(file, ...args);
  });

  await assert.rejects(
    openConnectionStore(config),
    { name: "OAuthError", reason: "storage_recovery_required" },
  );
  assert.equal(keyOpens, 0);
  assert.equal((await fs.readFile(markerPath)).includes(Buffer.from("different_operator")), true);
});

test("orphan temporary is never promoted or treated as an empty store", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const orphanPath = path.join(fixture.dataDir, ".connections.enc.synthetic-orphan.tmp");
  const orphan = Buffer.from("synthetic encrypted temporary only");
  await fs.writeFile(orphanPath, orphan, { flag: "wx", mode: 0o600 });

  await assert.rejects(
    openConnectionStore(syntheticOAuthConfig(fixture)),
    (error) => safeFailure(error, fixture),
  );
  assert.deepEqual(await fs.readFile(orphanPath), orphan);
  await assert.rejects(fs.lstat(path.join(fixture.dataDir, STORE_FILE)), { code: "ENOENT" });
});

test("failed replacement preserves the committed snapshot", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  const first = syntheticConnection();
  await store.put(first, null);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const committedBytes = await fs.readFile(file);
  const originalRename = fs.rename.bind(fs);
  let attempts = 0;
  t.mock.method(fs, "rename", async (source, target) => {
    if (path.resolve(String(target)) === path.resolve(file)) {
      attempts += 1;
      throw Object.assign(new Error("Synthetic local sharing violation."), { code: "EBUSY" });
    }
    return originalRename(source, target);
  });
  try {
    await assert.rejects(
      store.put({ ...first, generation: 2, label: "Uncommitted update" }, 1),
      (error) => error.reason === "store_write_failed",
    );
    assert.ok(attempts >= 1 && attempts <= 4);
    assert.deepEqual(await fs.readFile(file), committedBytes);
    assert.deepEqual(await store.read(first.connectionId), first);
    assert.equal((await fs.readdir(fixture.dataDir)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await store.close();
  }
});

test("temporary file creation failure leaves the committed ciphertext intact", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  const first = syntheticConnection();
  await store.put(first, null);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const committedBytes = await fs.readFile(file);
  failTemporaryOperation(t, "open", "ENOSPC");
  try {
    await assert.rejects(
      store.put({ ...first, generation: 2, label: "Unwritten update" }, 1),
      (error) => error.reason === "store_write_failed",
    );
    assert.deepEqual(await fs.readFile(file), committedBytes);
    assert.deepEqual(await store.read(first.connectionId), first);
  } finally {
    await store.close();
  }
});

test("temporary ciphertext write failure leaves the committed snapshot intact", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  const first = syntheticConnection();
  await store.put(first, null);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const committedBytes = await fs.readFile(file);
  failTemporaryOperation(t, "writeFile", "ENOSPC");
  try {
    await assert.rejects(
      store.put({ ...first, generation: 2, label: "Unwritten ciphertext" }, 1),
      (error) => error.reason === "store_write_failed",
    );
    assert.deepEqual(await fs.readFile(file), committedBytes);
    assert.deepEqual(await store.read(first.connectionId), first);
    assert.equal((await fs.readdir(fixture.dataDir)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await store.close();
  }
});

test("temporary fsync failure leaves the committed ciphertext intact", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  const first = syntheticConnection();
  await store.put(first, null);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const committedBytes = await fs.readFile(file);
  failTemporaryOperation(t, "sync", "ENOSPC");
  try {
    await assert.rejects(
      store.put({ ...first, generation: 2, label: "Unsynced update" }, 1),
      (error) => error.reason === "store_write_failed",
    );
    assert.deepEqual(await fs.readFile(file), committedBytes);
    assert.deepEqual(await store.read(first.connectionId), first);
  } finally {
    await store.close();
  }
});

test("close waits for a pending durable commit and releases only its own lock", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const config = syntheticOAuthConfig(fixture);
  const store = await openConnectionStore(config);
  const record = syntheticConnection();
  const pending = store.put(record, null);
  const closing = store.close();
  await Promise.all([pending, closing]);

  const reopened = await openConnectionStore(config);
  try {
    assert.deepEqual(await reopened.read(record.connectionId), record);
  } finally {
    await reopened.close();
  }
});

test("snapshot tampering with an unknown decrypted schema remains untouched", async (t) => {
  const fixture = await createOAuthFixture(t);
  await makeSnapshot(t, fixture);
  const file = path.join(fixture.dataDir, STORE_FILE);
  const envelope = await readStoreEnvelope(fixture);
  const snapshot = JSON.parse(decryptOuterSnapshot(envelope));
  snapshot.records.push(snapshot.records[0]);
  const tampered = encryptOuterPayload(
    {
      storeId: envelope.storeId,
      operatorId: envelope.operatorId,
      generation: envelope.generation,
    },
    JSON.stringify(snapshot),
  );
  await fs.writeFile(file, JSON.stringify(tampered), { mode: 0o600 });
  const before = await fs.readFile(file);
  await assert.rejects(
    openConnectionStore(syntheticOAuthConfig(fixture)),
    (error) => safeFailure(error, fixture),
  );
  assert.deepEqual(await fs.readFile(file), before);
});

test("generation, record owner, and token prefix are validated before commit", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  const record = syntheticConnection();
  try {
    await assert.rejects(
      store.put({ ...record, generation: Number.MAX_SAFE_INTEGER + 1 }, null),
      (error) => error.reason === "record_invalid",
    );
    await assert.rejects(
      store.put({ ...record, accessToken: "99999.wrong-user-prefix" }, null),
      (error) => error.reason === "record_invalid",
    );
    await assert.rejects(
      store.put({ ...record, owner: { ...record.owner, operatorId: "other" } }, null),
      (error) => error.reason === "record_invalid",
    );
    assert.equal(await fs.readdir(fixture.dataDir).then((names) => names.includes(STORE_FILE)), false);
  } finally {
    await store.close();
  }
});

test("scope evidence accepts only bounded exact scope strings", async (t) => {
  const fixture = await createOAuthFixture(t);
  prepareStoreTest(t);
  const store = await openConnectionStore(syntheticOAuthConfig(fixture));
  try {
    const record = syntheticConnection({
      requestedScopes: ["shops:read"],
      grants: {
        scopes: ["shops:read"],
        source: "authorization_code_response",
        checkedAt: 1_800_000_000_000,
      },
    });
    await assert.rejects(store.put(record, null), (error) => error.reason === "record_invalid");
  } finally {
    await store.close();
  }
});
