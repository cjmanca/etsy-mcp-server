import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createConnection as createTcpConnection, createServer as createTcpServer } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import axios from "axios";
import {
  createNativeWindowsOAuthFixture,
  createOAuthFixture,
  createSyntheticOAuthStore,
  createSyntheticOAuthTransport,
  syntheticConnection,
  syntheticConnectionId,
  syntheticOAuthConfig,
  syntheticOAuthEnvironment,
} from "./helpers/oauth.js";
import {
  jsonText,
  mockAdapter,
  successResponse,
  withMcp,
} from "./helpers/mcp.js";

const serviceModule = await import("../build/oauth/service.js").catch(() => undefined);
const typesModule = await import("../build/oauth/types.js").catch(() => undefined);
const runtimeModule = await import("../build/oauth/runtime.js").catch(() => undefined);
const storeModule = await import("../build/oauth/store.js").catch(() => undefined);
const serverModule = await import("../build/index.js");

async function unusedLocalhostPort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function installAxiosAdapter(t, adapter) {
  const originalCreate = axios.create.bind(axios);
  t.mock.method(axios, "create", (...args) => {
    const client = originalCreate(...args);
    client.defaults.adapter = adapter;
    return client;
  });
}

function callbackGet(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path: pathname, method: "GET", timeout: 4_000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("timeout", () => request.destroy(new Error("Synthetic callback client timeout.")));
    request.on("error", reject);
    request.end();
  });
}

async function createService(t, options = {}) {
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const baseConfig = syntheticOAuthConfig(fixture);
  const config = options.developmentMode
    ? { ...baseConfig, developmentMode: true }
    : baseConfig;
  const store = createSyntheticOAuthStore(options.records ?? []);
  const transport = createSyntheticOAuthTransport(options.transport);
  let now = 1_800_000_000_000;
  let randomCounter = 0;
  const service = serviceModule.createOAuthService(
    config,
    store.store,
    transport.transport,
    {
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, ++randomCounter),
      clientId: "synthetic-keystring",
    },
  );
  return {
    fixture,
    config,
    store,
    transport,
    service,
    now: () => now,
    setNow(value) {
      now = value;
    },
  };
}

async function createProtectedService(t, options = {}) {
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const config = syntheticOAuthConfig(fixture);
  const protectedStore = await storeModule.openConnectionStore(config);
  t.after(async () => protectedStore.close().catch(() => {}));
  if (options.initialRecord) await protectedStore.put(options.initialRecord, null);

  const store = {
    read: (...args) => protectedStore.read(...args),
    put: (...args) => options.put
      ? options.put(protectedStore, ...args)
      : protectedStore.put(...args),
    remove: (...args) => options.remove
      ? options.remove(protectedStore, ...args)
      : protectedStore.remove(...args),
    markRecoveryRequired: (...args) => protectedStore.markRecoveryRequired(...args),
  };
  let randomCounter = 0;
  const transport = createSyntheticOAuthTransport(options.transport);
  const service = serviceModule.createOAuthService(config, store, transport.transport, {
    now: () => 1_800_000_000_000,
    randomBytes: (size) => Buffer.alloc(size, ++randomCounter),
    clientId: "synthetic-keystring",
  });
  return { fixture, config, protectedStore, store, transport, service };
}

function stateFrom(result) {
  return new URL(result.authorization_url).searchParams.get("state");
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("begin emits exact configured Etsy PKCE URL and least-privilege scopes", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const { service } = await createService(t);

  const result = await service.begin({
    bundles: ["catalog_read", "financial_read", "shop_read"],
    label: "private test label",
  });
  const url = new URL(result.authorization_url);
  const state = url.searchParams.get("state");

  assert.equal(result.state, "pending");
  assert.equal(result.expires_at, 1_800_000_300_000);
  assert.equal(result.connection_id.length, 22);
  assert.equal(state.length, 43);
  assert.notEqual(state, result.connection_id);
  assert.deepEqual(result.requested_scopes, ["shops_r", "listings_r", "transactions_r"]);
  assert.equal(url.origin, "https://www.etsy.com");
  assert.equal(url.pathname, "/oauth/connect");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: "code",
    client_id: "synthetic-keystring",
    redirect_uri: "https://oauth.invalid/oauth/etsy/callback",
    scope: "shops_r listings_r transactions_r",
    state,
    code_challenge: url.searchParams.get("code_challenge"),
    code_challenge_method: "S256",
  });
  assert.match(url.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.authorization_url.includes("synthetic-shared-secret"), false);
  assert.equal(Object.hasOwn(result, "code"), false);
  assert.equal(Object.hasOwn(result, "verifier"), false);
  assert.equal(Object.hasOwn(result, "state_value"), false);
  assert.match(result.human_action, /open.*browser|browser.*approve/i);
});

test("PKCE verifier remains private and callback replay or foreign state never exchanges", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const { service, transport } = await createService(t);
  const begin = await service.begin({ bundles: [] });
  const state = stateFrom(begin);

  assert.equal(await service.completeCallback({ state: `${state}A`, code: "wrong-state-code" }), "failed");
  assert.equal(transport.calls.exchanges.length, 0);
  assert.equal(await service.completeCallback({ state, code: "one-time-code" }), "complete");
  assert.equal(await service.completeCallback({ state, code: "replay-code" }), "failed");
  assert.equal(transport.calls.exchanges.length, 1);
  assert.equal(transport.calls.exchanges[0].code, "one-time-code");
  assert.equal(transport.calls.exchanges[0].verifier.length, 43);
  assert.equal(
    createHash("sha256").update(transport.calls.exchanges[0].verifier).digest("base64url"),
    new URL(begin.authorization_url).searchParams.get("code_challenge"),
  );
});

test("denied and expired callbacks consume no code exchange", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const { service, transport, now, setNow } = await createService(t);
  const denied = await service.begin({ bundles: [] });
  const deniedState = stateFrom(denied);
  assert.equal(await service.completeCallback({ state: deniedState, denied: true }), "denied");
  assert.equal(await service.completeCallback({ state: deniedState, code: "after-denial" }), "failed");

  const expired = await service.begin({ bundles: [] });
  setNow(now() + 300_000);
  assert.equal(await service.completeCallback({ state: stateFrom(expired), code: "expired-code" }), "failed");
  assert.equal(transport.calls.exchanges.length, 0);
  assert.equal(transport.calls.identities.length, 0);
  assert.equal(serviceModule.pendingAttemptCountForTesting, undefined);
});

test("connection is complete only after protected commit", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const { service, store, transport } = await createService(t);
  let releaseCommit;
  let commitStartedResolve;
  const commitStarted = new Promise((resolve) => {
    commitStartedResolve = resolve;
  });
  const commitGate = new Promise((resolve) => {
    releaseCommit = resolve;
  });
  store.setPutBehavior(async () => {
    commitStartedResolve();
    await commitGate;
  });
  const begin = await service.begin({ bundles: ["catalog_read"] });
  const completion = service.completeCallback({ state: stateFrom(begin), code: "durable-code" });

  await commitStarted;
  let settled = false;
  void completion.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(store.records.has(begin.connection_id), false);
  assert.equal(transport.calls.exchanges.length, 1);
  assert.equal(transport.calls.identities[0], "12345.synthetic-access-token");

  releaseCommit();
  assert.equal(await completion, "complete");
  const saved = store.records.get(begin.connection_id);
  assert.equal(saved.connectionId, begin.connection_id);
  assert.equal(saved.accountId, 12345);
  assert.equal(saved.shopId, 67890);
  assert.equal(saved.accessToken, "12345.synthetic-access-token");
  assert.equal(saved.refreshToken, "12345.synthetic-refresh-token");
  assert.deepEqual(saved.requestedScopes, ["shops_r", "listings_r"]);
  assert.deepEqual(saved.grants.scopes, ["shops_r"]);
  assert.equal(saved.state, "connected_limited");
  assert.equal(saved.grants.source, "authorization_code_response");
});

test("failed protected commit never reports a connected account", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const { service, store } = await createService(t);
  store.setPutBehavior(async () => {
    throw new Error("Synthetic disk error with access-token-canary");
  });
  const begin = await service.begin({ bundles: [] });

  assert.equal(await service.completeCallback({ state: stateFrom(begin), code: "disk-failure-code" }), "failed");
  assert.equal(store.records.has(begin.connection_id), false);
  assert.equal(store.calls.puts.length, 1);
});

test("identity prefix or required shops_r failure prevents persistence", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const missingIdentityScope = await createService(t, {
    transport: {
      exchange: async () => ({
        accessToken: "12345.synthetic-access-token",
        refreshToken: "12345.synthetic-refresh-token",
        expiresIn: 3600,
        grants: {
          scopes: ["listings_r"],
          source: "authorization_code_response",
          checkedAt: 1_800_000_000_000,
        },
      }),
    },
  });
  const missingScopeBegin = await missingIdentityScope.service.begin({ bundles: ["catalog_read"] });
  assert.equal(
    await missingIdentityScope.service.completeCallback({ state: stateFrom(missingScopeBegin), code: "missing-scope" }),
    "failed",
  );
  assert.equal(missingIdentityScope.transport.calls.identities.length, 0);
  assert.equal(missingIdentityScope.store.calls.puts.length, 0);

  const mismatchedIdentity = await createService(t, {
    transport: { getMe: async () => ({ accountId: 99999, shopId: 67890 }) },
  });
  const mismatchBegin = await mismatchedIdentity.service.begin({ bundles: [] });
  assert.equal(
    await mismatchedIdentity.service.completeCallback({ state: stateFrom(mismatchBegin), code: "wrong-account" }),
    "failed",
  );
  assert.equal(mismatchedIdentity.store.calls.puts.length, 0);
});

test("failed reconnect leaves the previous protected record unchanged", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const oldRecord = syntheticConnection();
  const { service, store } = await createService(t, {
    records: [oldRecord],
    transport: { getMe: async () => ({ accountId: 54321, shopId: 67890 }) },
  });
  const begin = await service.begin({ bundles: ["catalog_read"], replaceConnectionId: syntheticConnectionId });

  assert.equal(begin.connection_id, syntheticConnectionId);
  assert.equal(
    await service.completeCallback({ state: stateFrom(begin), code: "switch-account-code" }),
    "failed",
  );
  assert.deepEqual(store.records.get(syntheticConnectionId), oldRecord);
  assert.equal(store.calls.puts.length, 0);
});

test("begin rejects unsupported write bundles and is unavailable under the local lock", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const { service } = await createService(t);
  await assert.rejects(service.begin({ bundles: ["listing_write"] }), { name: "OAuthError" });

  const locked = await createService(t, { developmentMode: true });
  assert.equal(locked.service.beginAvailable, false);
  await assert.rejects(locked.service.begin({ bundles: [] }), {
    name: "OAuthError",
    reason: "development_mode_locked",
  });
  assert.equal(locked.store.calls.reads.length, 0);
  assert.equal(locked.store.calls.puts.length, 0);
});

test("pending attempts are bounded and expire on service restart", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const first = await createService(t);
  for (let index = 0; index < 10; index += 1) {
    await first.service.begin({ bundles: [] });
  }
  await assert.rejects(first.service.begin({ bundles: [] }), { name: "OAuthError" });
  await first.service.close();

  const restarted = await createService(t);
  assert.equal(
    await restarted.service.completeCallback({
      state: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      code: "old-process-code",
    }),
    "failed",
  );
  assert.equal(restarted.transport.calls.exchanges.length, 0);
});

test("simultaneous begin calls reserve the ten pending slots before store reads", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const fixture = await createService(t);
  const readGate = deferred();
  const originalRead = fixture.store.store.read.bind(fixture.store.store);
  let readCalls = 0;
  fixture.store.store.read = async (connectionId) => {
    readCalls += 1;
    await readGate.promise;
    return originalRead(connectionId);
  };

  const attempts = Array.from({ length: 30 }, () => fixture.service.begin({ bundles: [] }));
  await Promise.resolve();
  const readsBeforeRelease = readCalls;
  readGate.resolve();
  const results = await Promise.allSettled(attempts);

  assert.equal(readsBeforeRelease, 10);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 10);
  assert.equal(results.filter((result) => result.status === "rejected").length, 20);
});

test("failed begin releases its reserved pending-attempt capacity", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const fixture = await createService(t);
  const originalRead = fixture.store.store.read.bind(fixture.store.store);
  let failNextRead = true;
  fixture.store.store.read = async (connectionId) => {
    if (failNextRead) {
      failNextRead = false;
      throw new Error("Synthetic store read failure.");
    }
    return originalRead(connectionId);
  };

  await assert.rejects(fixture.service.begin({ bundles: [] }), {
    name: "OAuthError",
    reason: "oauth_flow_unavailable",
  });
  const recovered = await fixture.service.begin({ bundles: [] });

  assert.equal(recovered.state, "pending");
  assert.equal(fixture.service.beginAvailable, true);
});

test("concurrent reconnect begins reserve the target before reading its generation", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const fixture = await createService(t, { records: [syntheticConnection()] });
  const readGate = deferred();
  const originalRead = fixture.store.store.read.bind(fixture.store.store);
  let targetReads = 0;
  fixture.store.store.read = async (connectionId) => {
    if (connectionId === syntheticConnectionId) {
      targetReads += 1;
      await readGate.promise;
    }
    return originalRead(connectionId);
  };

  const attempts = [1, 2].map(() => fixture.service.begin({
    bundles: [],
    replaceConnectionId: syntheticConnectionId,
  }));
  await Promise.resolve();
  const readsBeforeRelease = targetReads;
  readGate.resolve();
  const results = await Promise.allSettled(attempts);

  assert.equal(readsBeforeRelease, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("shutdown invalidates and drains begin work blocked on store read", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const fixture = await createService(t);
  const readStarted = deferred();
  const readGate = deferred();
  const originalRead = fixture.store.store.read.bind(fixture.store.store);
  fixture.store.store.read = async (connectionId) => {
    readStarted.resolve();
    await readGate.promise;
    return originalRead(connectionId);
  };

  const begin = fixture.service.begin({ bundles: [] });
  await readStarted.promise;
  let closeSettled = false;
  const close = fixture.service.close().then(() => {
    closeSettled = true;
  });
  await Promise.resolve();
  const closeWaitedForRead = !closeSettled;
  readGate.resolve();

  await close;
  await assert.rejects(begin, { name: "OAuthError", reason: "oauth_flow_unavailable" });
  assert.equal(closeWaitedForRead, true);
  assert.equal(fixture.store.calls.puts.length, 0);
});

test("shutdown during token exchange drains callback without identity lookup or persistence", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const exchangeStarted = deferred();
  const exchangeGate = deferred();
  const fixture = await createService(t, {
    transport: {
      exchange: async () => {
        exchangeStarted.resolve();
        await exchangeGate.promise;
        return {
          accessToken: "12345.synthetic-access-token",
          refreshToken: "12345.synthetic-refresh-token",
          expiresIn: 3600,
          grants: {
            scopes: ["shops_r"],
            source: "authorization_code_response",
            checkedAt: 1_800_000_000_000,
          },
        };
      },
    },
  });
  const begin = await fixture.service.begin({ bundles: [] });
  const completion = fixture.service.completeCallback({ state: stateFrom(begin), code: "shutdown-code" });
  await exchangeStarted.promise;

  let closeSettled = false;
  const close = fixture.service.close().then(() => {
    closeSettled = true;
  });
  await Promise.resolve();
  const closeWaitedForExchange = !closeSettled;
  exchangeGate.resolve();

  assert.equal(await completion, "failed");
  await close;
  assert.equal(closeWaitedForExchange, true);
  assert.equal(fixture.transport.calls.identities.length, 0);
  assert.equal(fixture.store.calls.puts.length, 0);
});

test("shutdown during protected put rolls back a late OAuth commit", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const fixture = await createService(t);
  const putStarted = deferred();
  const putGate = deferred();
  fixture.store.setPutBehavior(async () => {
    putStarted.resolve();
    await putGate.promise;
  });
  const begin = await fixture.service.begin({ bundles: [] });
  const completion = fixture.service.completeCallback({ state: stateFrom(begin), code: "late-commit-code" });
  await putStarted.promise;

  let closeSettled = false;
  const close = fixture.service.close().then(() => {
    closeSettled = true;
  });
  await Promise.resolve();
  const closeWaitedForPut = !closeSettled;
  putGate.resolve();

  assert.equal(await completion, "failed");
  await close;
  assert.equal(closeWaitedForPut, true);
  assert.equal(fixture.store.records.has(begin.connection_id), false);
  assert.deepEqual(fixture.store.calls.removals, [{
    connectionId: begin.connection_id,
    expectedGeneration: 1,
  }]);
});

test("failed removal rollback persists an owner-bound fence across close and reopen", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const putStarted = deferred();
  const putGate = deferred();
  let firstPut = true;
  const fixture = await createProtectedService(t, {
    put: async (protectedStore, record, expectedGeneration) => {
      await protectedStore.put(record, expectedGeneration);
      if (firstPut) {
        firstPut = false;
        putStarted.resolve();
        await putGate.promise;
      }
    },
    remove: async () => {
      throw new Error("Synthetic rollback removal failure.");
    },
  });
  const begin = await fixture.service.begin({ bundles: [] });
  const completion = fixture.service.completeCallback({ state: stateFrom(begin), code: "synthetic-code" });
  await putStarted.promise;
  const closing = fixture.service.close();
  putGate.resolve();

  assert.equal(await completion, "failed");
  await assert.rejects(closing, { name: "OAuthError", reason: "oauth_flow_unavailable" });
  await fixture.protectedStore.close();

  const markerPath = path.join(fixture.config.dataDir, "oauth-recovery-required.json");
  const marker = await fs.readFile(markerPath);
  assert.deepEqual(JSON.parse(marker.toString("utf8")), {
    format: 1,
    owner: fixture.config.owner,
    reason: "uncertain_connection_rollback",
  });
  assert.equal(marker.includes(Buffer.from("synthetic-access-token")), false);
  assert.equal(marker.includes(Buffer.from("synthetic-refresh-token")), false);
  assert.equal(marker.includes(Buffer.from(begin.connection_id)), false);
  let keyOpens = 0;
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async (file, ...args) => {
    if (path.resolve(String(file)) === path.resolve(fixture.config.keyFile)) keyOpens += 1;
    return originalOpen(file, ...args);
  });
  await assert.rejects(
    storeModule.openConnectionStore(fixture.config),
    { name: "OAuthError", reason: "storage_recovery_required" },
  );
  assert.equal(keyOpens, 0, "recovery fence must be checked before opening key bytes");
});

test("failed reconnect restoration persists an owner-bound fence across close and reopen", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const original = syntheticConnection({ label: "Prior good connection" });
  const putStarted = deferred();
  const putGate = deferred();
  let firstPut = true;
  const fixture = await createProtectedService(t, {
    initialRecord: original,
    put: async (protectedStore, record, expectedGeneration) => {
      if (!firstPut) throw new Error("Synthetic reconnect restoration failure.");
      firstPut = false;
      await protectedStore.put(record, expectedGeneration);
      putStarted.resolve();
      await putGate.promise;
    },
  });
  const begin = await fixture.service.begin({
    bundles: [],
    label: "Uncommitted reconnect",
    replaceConnectionId: original.connectionId,
  });
  const completion = fixture.service.completeCallback({ state: stateFrom(begin), code: "synthetic-reconnect-code" });
  await putStarted.promise;
  const closing = fixture.service.close();
  putGate.resolve();

  assert.equal(await completion, "failed");
  await assert.rejects(closing, { name: "OAuthError", reason: "oauth_flow_unavailable" });
  await fixture.protectedStore.close();

  const markerPath = path.join(fixture.config.dataDir, "oauth-recovery-required.json");
  const marker = await fs.readFile(markerPath);
  assert.equal(marker.includes(Buffer.from(original.accessToken)), false);
  assert.equal(marker.includes(Buffer.from(original.refreshToken)), false);
  assert.equal(marker.includes(Buffer.from(original.connectionId)), false);
  await assert.rejects(
    storeModule.openConnectionStore(fixture.config),
    { name: "OAuthError", reason: "storage_recovery_required" },
  );
});

test("successful reconnect rollback restores the prior record with generation CAS", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const original = syntheticConnection({ label: "Prior good connection" });
  const putStarted = deferred();
  const putGate = deferred();
  const putCalls = [];
  let firstPut = true;
  const fixture = await createProtectedService(t, {
    initialRecord: original,
    put: async (protectedStore, record, expectedGeneration) => {
      putCalls.push({ generation: record.generation, expectedGeneration });
      await protectedStore.put(record, expectedGeneration);
      if (firstPut) {
        firstPut = false;
        putStarted.resolve();
        await putGate.promise;
      }
    },
  });
  const begin = await fixture.service.begin({
    bundles: [],
    label: "Temporary reconnect",
    replaceConnectionId: original.connectionId,
  });
  const completion = fixture.service.completeCallback({ state: stateFrom(begin), code: "synthetic-reconnect-code" });
  await putStarted.promise;
  const closing = fixture.service.close();
  putGate.resolve();

  assert.equal(await completion, "failed");
  await closing;
  assert.deepEqual(putCalls, [
    { generation: 2, expectedGeneration: 1 },
    { generation: 3, expectedGeneration: 2 },
  ]);
  const restored = await fixture.protectedStore.read(original.connectionId);
  assert.equal(restored.generation, 3);
  assert.equal(restored.accessToken, original.accessToken);
  assert.equal(restored.refreshToken, original.refreshToken);
  assert.equal(restored.label, original.label);
  await fixture.protectedStore.close();

  const reopened = await storeModule.openConnectionStore(fixture.config);
  try {
    assert.deepEqual(await reopened.read(original.connectionId), restored);
  } finally {
    await reopened.close();
  }
});

test("service caps concurrent token exchanges at two", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = 0;
  let twoStartedResolve;
  const twoStarted = new Promise((resolve) => {
    twoStartedResolve = resolve;
  });
  const fixture = await createService(t, {
    transport: {
      exchange: async () => {
        started += 1;
        if (started === 2) twoStartedResolve();
        await gate;
        return {
          accessToken: "12345.synthetic-access-token",
          refreshToken: "12345.synthetic-refresh-token",
          expiresIn: 3600,
          grants: {
            scopes: ["shops_r"],
            source: "authorization_code_response",
            checkedAt: 1_800_000_000_000,
          },
        };
      },
    },
  });
  const begins = await Promise.all(Array.from({ length: 3 }, () => fixture.service.begin({ bundles: [] })));
  const completions = begins.map((begin, index) => fixture.service.completeCallback({
    state: stateFrom(begin),
    code: `concurrent-${index}`,
  }));
  await twoStarted;
  release();
  const outcomes = await Promise.all(completions);

  assert.equal(started, 2);
  assert.equal(outcomes.filter((outcome) => outcome === "complete").length, 2);
  assert.equal(outcomes.filter((outcome) => outcome === "failed").length, 1);
});

test("OAuth errors remain fixed and never disclose helper causes", async (t) => {
  assert.equal(typeof typesModule?.OAuthError, "function");
  const error = new typesModule.OAuthError("oauth_request_failed");
  assert.equal(error.message.includes("token"), false);
  assert.equal(error.message.includes("path"), false);
});

test("begin tool appears only with a ready runtime and returns the bounded consent projection", async (t) => {
  assert.equal(typeof serverModule.createEtsyMcpServer, "function");
  const { service } = await createService(t);
  const runtime = { developmentMode: false, service, close: async () => {} };
  const calls = [];

  await withMcp(
    mockAdapter((config) => successResponse(config, {}), calls),
    async ({ client }) => {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 32);
      const tool = listed.tools.find((item) => item.name === "begin_etsy_connection");
      assert.ok(tool);
      assert.deepEqual(tool.annotations, {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
      const statusTool = listed.tools.find((item) => item.name === "get_etsy_connection_status");
      assert.ok(statusTool);
      assert.deepEqual(statusTool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const disconnectTool = listed.tools.find((item) => item.name === "disconnect_etsy_connection");
      assert.ok(disconnectTool);
      assert.deepEqual(disconnectTool.annotations, {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
      const result = await client.callTool({
        name: "begin_etsy_connection",
        arguments: { bundles: ["catalog_read"] },
      });
      const output = jsonText(result);
      assert.equal(output.state, "pending");
      assert.deepEqual(output.requested_scopes, ["shops_r", "listings_r"]);
      assert.equal(Object.hasOwn(output, "code"), false);
      assert.equal(Object.hasOwn(output, "verifier"), false);
      assert.equal(Object.hasOwn(output, "state_value"), false);
      assert.equal(new URL(output.authorization_url).origin, "https://www.etsy.com");
      assert.equal(calls.length, 0);
    },
    (etsyClient) => serverModule.createEtsyMcpServer(etsyClient, {
      developmentMode: false,
      oauth: runtime,
    }),
  );
});

test("locked begin is hidden and direct dispatch is denied before its handler", async () => {
  let beginCalls = 0;
  const service = {
    beginAvailable: false,
    async begin() {
      beginCalls += 1;
      throw new Error("must not execute");
    },
    async completeCallback() {
      return "failed";
    },
    async status() {
      return { connection_id: "AAAAAAAAAAAAAAAAAAAAAA", state: "connected" };
    },
    async disconnect() {
      return {
        connection_id: "AAAAAAAAAAAAAAAAAAAAAA",
        state: "disconnected",
        local_credentials_removed: true,
        upstream_revoked: false,
      };
    },
    async close() {},
  };
  const runtime = { developmentMode: true, service, close: async () => {} };
  const calls = [];
  await withMcp(
    mockAdapter((config) => successResponse(config, {}), calls),
    async ({ client }) => {
      const listed = await client.listTools();
      assert.equal(listed.tools.some((item) => item.name === "begin_etsy_connection"), false);
      assert.equal(listed.tools.length, 31);
      assert.equal(listed.tools.some((item) => item.name === "get_etsy_connection_status"), true);
      assert.equal(listed.tools.some((item) => item.name === "disconnect_etsy_connection"), true);
      const result = await client.callTool({
        name: "begin_etsy_connection",
        arguments: { bundles: [] },
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /local development lock/i);
      assert.equal(beginCalls, 0);
      assert.equal(calls.length, 0);
    },
    (etsyClient) => serverModule.createEtsyMcpServer(etsyClient, {
      developmentMode: true,
      oauth: runtime,
    }),
  );
});

test("factory rejects OAuth runtime development-mode mismatch and sanitizes raw helper errors", async () => {
  let beginCalls = 0;
  await withMcp(
    mockAdapter((config) => successResponse(config, {}), []),
    async ({ client }) => {
      const result = await client.callTool({
        name: "begin_etsy_connection",
        arguments: { bundles: [] },
      });
      assert.equal(result.isError, true);
      assert.equal(beginCalls, 1);
      assert.equal(result.content[0].text.includes("synthetic-token-canary"), false);
      assert.equal(result.content[0].text.includes("helper-path-canary"), false);
    },
    (etsyClient) => {
      const service = {
        beginAvailable: true,
        async begin() {
          beginCalls += 1;
          throw new Error("synthetic-token-canary helper-path-canary");
        },
        async completeCallback() {
          return "failed";
        },
        async close() {},
      };
      const runtime = { developmentMode: false, service, close: async () => {} };
      assert.throws(
        () => serverModule.createEtsyMcpServer(etsyClient, {
          developmentMode: true,
          oauth: runtime,
        }),
        /snapshots must match/i,
      );
      return serverModule.createEtsyMcpServer(etsyClient, {
        developmentMode: false,
        oauth: runtime,
      });
    },
  );
});

test("production runtime completes only after protected encrypted storage is committed", async (t) => {
  assert.equal(typeof runtimeModule?.startOAuthRuntime, "function");
  assert.equal(typeof storeModule?.openConnectionStore, "function");
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const config = {
    ...syntheticOAuthConfig(fixture),
    callbackPort: await unusedLocalhostPort(),
  };
  const calls = [];
  installAxiosAdapter(t, async (request) => {
    calls.push(request);
    if (request.url === "https://api.etsy.com/v3/public/oauth/token") {
      return {
        data: {
          access_token: "12345.synthetic-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "12345.synthetic-refresh-token",
          scope: "shops_r",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: request,
      };
    }
    if (request.url === "https://openapi.etsy.com/v3/application/users/me") {
      return {
        data: { user_id: 12345, shop_id: 67890 },
        status: 200,
        statusText: "OK",
        headers: {},
        config: request,
      };
    }
    throw new Error("Unexpected fixed OAuth route.");
  });
  let runtime;
  let connectionId;
  try {
    runtime = await runtimeModule.startOAuthRuntime(
      config,
      "synthetic-keystring:synthetic-shared-secret",
      async () => {},
    );
    const begin = await runtime.service.begin({ bundles: [] });
    connectionId = begin.connection_id;
    const state = new URL(begin.authorization_url).searchParams.get("state");
    const query = new URLSearchParams({ state, code: "synthetic-one-time-code" });
    const callback = await callbackGet(config.callbackPort, `/oauth/etsy/callback?${query}`);
    assert.equal(callback.status, 200);
    assert.equal(callback.body.includes(state), false);
    assert.equal(callback.body.includes("synthetic-one-time-code"), false);
    assert.deepEqual(calls.map((request) => `${request.method}:${request.url}`), [
      "post:https://api.etsy.com/v3/public/oauth/token",
      "get:https://openapi.etsy.com/v3/application/users/me",
    ]);
  } finally {
    await runtime?.close();
  }

  const reopened = await storeModule.openConnectionStore(config);
  try {
    const saved = await reopened.read(connectionId);
    assert.equal(saved.connectionId, connectionId);
    assert.equal(saved.accountId, 12345);
    assert.equal(saved.shopId, 67890);
    assert.equal(saved.accessToken, "12345.synthetic-access-token");
    assert.equal(saved.refreshToken, "12345.synthetic-refresh-token");
    assert.equal(saved.state, "connected");
    assert.deepEqual(saved.requestedScopes, ["shops_r"]);
    assert.deepEqual(saved.grants.scopes, ["shops_r"]);
    const encryptedSnapshot = await fs.readFile(path.join(config.dataDir, "connections.enc"));
    assert.equal(encryptedSnapshot.includes(Buffer.from("12345.synthetic-access-token")), false);
    assert.equal(encryptedSnapshot.includes(Buffer.from("12345.synthetic-refresh-token")), false);
  } finally {
    await reopened.close();
  }
});

test("runtime shutdown invalidates OAuth before draining an active callback", async (t) => {
  assert.equal(typeof runtimeModule?.startOAuthRuntime, "function");
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const config = {
    ...syntheticOAuthConfig(fixture),
    callbackPort: await unusedLocalhostPort(),
  };
  const exchangeStarted = deferred();
  const exchangeGate = deferred();
  const routes = [];
  installAxiosAdapter(t, async (request) => {
    routes.push(`${request.method}:${request.url}`);
    if (request.url === "https://api.etsy.com/v3/public/oauth/token") {
      exchangeStarted.resolve();
      await exchangeGate.promise;
      return {
        data: {
          access_token: "12345.synthetic-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "12345.synthetic-refresh-token",
          scope: "shops_r",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: request,
      };
    }
    if (request.url === "https://openapi.etsy.com/v3/application/users/me") {
      return {
        data: { user_id: 12345, shop_id: 67890 },
        status: 200,
        statusText: "OK",
        headers: {},
        config: request,
      };
    }
    throw new Error("Unexpected fixed OAuth route.");
  });

  let runtime;
  let begin;
  let callbackResponse;
  try {
    runtime = await runtimeModule.startOAuthRuntime(
      config,
      "synthetic-keystring:synthetic-shared-secret",
      async () => {},
    );
    begin = await runtime.service.begin({ bundles: [] });
    const query = new URLSearchParams({
      state: stateFrom(begin),
      code: "shutdown-one-time-code",
    });
    const callback = callbackGet(config.callbackPort, `/oauth/etsy/callback?${query}`);
    await exchangeStarted.promise;
    const closing = runtime.close();
    await Promise.resolve();
    exchangeGate.resolve();
    [callbackResponse] = await Promise.all([callback, closing]);
  } finally {
    exchangeGate.resolve();
    await runtime?.close().catch(() => {});
  }

  const reopened = await storeModule.openConnectionStore(config);
  try {
    assert.equal(callbackResponse.status, 200);
    assert.deepEqual(routes, ["post:https://api.etsy.com/v3/public/oauth/token"]);
    assert.equal(await reopened.read(begin.connection_id), undefined);
  } finally {
    await reopened.close();
  }
});

test("runtime observes failed service cleanup before an incomplete callback socket drains", async (t) => {
  assert.equal(typeof runtimeModule?.startOAuthRuntime, "function");
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const config = {
    ...syntheticOAuthConfig(fixture),
    callbackPort: await unusedLocalhostPort(),
  };
  const firstCommitStarted = deferred();
  const releaseFirstCommit = deferred();
  const compensationAttempted = deferred();
  const connectionFile = path.join(config.dataDir, "connections.enc");
  const originalRename = fs.rename.bind(fs);
  let connectionRenameCount = 0;
  t.mock.method(fs, "rename", async (source, target) => {
    if (path.resolve(String(target)) === path.resolve(connectionFile)) {
      connectionRenameCount += 1;
      if (connectionRenameCount === 1) {
        firstCommitStarted.resolve();
        await releaseFirstCommit.promise;
      } else if (connectionRenameCount === 2) {
        compensationAttempted.resolve();
        throw Object.assign(new Error("synthetic compensation failure token-canary"), {
          code: "ENOSPC",
        });
      }
    }
    return originalRename(source, target);
  });

  const routes = [];
  installAxiosAdapter(t, async (request) => {
    routes.push(`${request.method}:${request.url}`);
    if (request.url === "https://api.etsy.com/v3/public/oauth/token") {
      return {
        data: {
          access_token: "12345.synthetic-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "12345.synthetic-refresh-token",
          scope: "shops_r",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: request,
      };
    }
    if (request.url === "https://openapi.etsy.com/v3/application/users/me") {
      return {
        data: { user_id: 12345, shop_id: 67890 },
        status: 200,
        statusText: "OK",
        headers: {},
        config: request,
      };
    }
    throw new Error("Unexpected fixed OAuth route.");
  });

  const unhandledRejections = [];
  const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
  process.on("unhandledRejection", onUnhandledRejection);
  let runtime;
  let partialSocket;
  let callbackRequest;
  let closingOutcome;
  let closeSettled = false;
  try {
    runtime = await runtimeModule.startOAuthRuntime(
      config,
      "synthetic-keystring:synthetic-shared-secret",
      async () => {},
    );
    const begin = await runtime.service.begin({ bundles: [] });
    const state = stateFrom(begin);

    partialSocket = createTcpConnection(config.callbackPort, "127.0.0.1");
    partialSocket.on("error", () => {});
    await once(partialSocket, "connect");
    partialSocket.write("GET /oauth/etsy/callback HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Incomplete: ");
    await new Promise((resolve) => setImmediate(resolve));

    const query = new URLSearchParams({ state, code: "rollback-one-time-code" });
    callbackRequest = callbackGet(config.callbackPort, `/oauth/etsy/callback?${query}`);
    await firstCommitStarted.promise;

    const closing = runtime.close();
    closingOutcome = closing.then(
      () => {
        closeSettled = true;
        return { status: "fulfilled" };
      },
      (error) => {
        closeSettled = true;
        return { status: "rejected", error };
      },
    );
    releaseFirstCommit.resolve();

    const callback = await callbackRequest;
    await compensationAttempted.promise;
    assert.equal(callback.status, 200);
    assert.equal(callback.body.includes(state), false);
    assert.deepEqual(routes, [
      "post:https://api.etsy.com/v3/public/oauth/token",
      "get:https://openapi.etsy.com/v3/application/users/me",
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      unhandledRejections.length,
      0,
      "the failed service cleanup must be observed while callback draining is still blocked",
    );
    assert.equal(closeSettled, false, "runtime shutdown must still wait for the incomplete socket");

    await assert.rejects(
      storeModule.openConnectionStore(config),
      { name: "OAuthError", reason: "storage_conflict" },
      "the encrypted store must remain owned until callback and service cleanup have drained",
    );

    partialSocket.destroy();
    const outcome = await closingOutcome;
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error.name, "OAuthError");
    assert.equal(outcome.error.reason, "oauth_flow_unavailable");
    assert.equal(outcome.error.message.includes("synthetic compensation failure"), false);
    assert.equal(outcome.error.message.includes("token-canary"), false);
    assert.equal(outcome.error.message.includes(fixture.root), false);

    const markerPath = path.join(config.dataDir, "oauth-recovery-required.json");
    assert.deepEqual(JSON.parse((await fs.readFile(markerPath)).toString("utf8")), {
      format: 1,
      owner: config.owner,
      reason: "uncertain_connection_rollback",
    });
    let keyOpens = 0;
    const originalOpen = fs.open.bind(fs);
    t.mock.method(fs, "open", async (file, ...args) => {
      if (path.resolve(String(file)) === path.resolve(config.keyFile)) keyOpens += 1;
      return originalOpen(file, ...args);
    });
    await assert.rejects(
      storeModule.openConnectionStore(config),
      { name: "OAuthError", reason: "storage_recovery_required" },
    );
    assert.equal(keyOpens, 0, "the recovery fence must still block credential reads after shutdown");
  } finally {
    releaseFirstCommit.resolve();
    partialSocket?.destroy();
    process.off("unhandledRejection", onUnhandledRejection);
    await callbackRequest?.catch(() => {});
    await runtime?.close().catch(() => {});
  }
});

test("callback bind failure closes the protected store without choosing another port", async (t) => {
  assert.equal(typeof runtimeModule?.startOAuthRuntime, "function");
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const port = await unusedLocalhostPort();
  const occupier = createHttpServer((_request, response) => response.end("occupied"));
  occupier.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    occupier.once("listening", resolve);
    occupier.once("error", reject);
  });
  const config = { ...syntheticOAuthConfig(fixture), callbackPort: port };
  try {
    await assert.rejects(
      runtimeModule.startOAuthRuntime(
        config,
        "synthetic-keystring:synthetic-shared-secret",
        async () => {},
      ),
      { name: "OAuthError", reason: "callback_bind_failed" },
    );
  } finally {
    await new Promise((resolve, reject) => occupier.close((error) => error ? reject(error) : resolve()));
  }
  const store = await storeModule.openConnectionStore(config);
  await store.close();
});

test("stdio EOF shutdown closes OAuth runtime and releases its protected store", async (t) => {
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const config = {
    ...syntheticOAuthConfig(fixture),
    callbackPort: await unusedLocalhostPort(),
  };
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("ETSY_")),
  );
  Object.assign(environment, syntheticOAuthEnvironment(fixture, {
    ETSY_OAUTH_CALLBACK_PORT: String(config.callbackPort),
    ETSY_DEVELOPMENT_MODE: "false",
  }));
  const cliPath = fileURLToPath(new URL("../build/index.js", import.meta.url));
  const child = spawn(process.execPath, [cliPath], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });

  let stderr = "";
  const startup = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Synthetic OAuth CLI did not finish startup."));
    }, 15_000);
    const onData = (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.includes("Etsy MCP Server running on stdio")) {
        cleanup();
        resolve();
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Synthetic OAuth CLI exited before startup (${code ?? signal}).`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
  await startup;

  const exited = once(child, "exit");
  child.stdin.end();
  const exitResult = await Promise.race([
    exited.then(([code, signal]) => ({ code, signal })),
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), 3_000);
      timer.unref?.();
    }),
  ]);
  assert.ok(exitResult, "CLI remained alive after stdin EOF.");
  assert.equal(exitResult.code, 0, stderr);

  const reopened = await storeModule.openConnectionStore(config);
  await reopened.close();
});

test("SIGTERM closes the synthetic OAuth CLI while stdin remains open", {
  skip: process.platform !== "linux",
}, async (t) => {
  const fixture = await createOAuthFixture(t);
  const config = {
    ...syntheticOAuthConfig(fixture),
    callbackPort: await unusedLocalhostPort(),
  };
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("ETSY_")),
  );
  Object.assign(environment, syntheticOAuthEnvironment(fixture, {
    ETSY_OAUTH_CALLBACK_PORT: String(config.callbackPort),
    ETSY_DEVELOPMENT_MODE: "false",
  }));
  const cliPath = fileURLToPath(new URL("../build/index.js", import.meta.url));
  const child = spawn(process.execPath, [cliPath], {
    cwd: process.cwd(),
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  });

  let stderr = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Synthetic OAuth CLI did not finish startup."));
    }, 15_000);
    const onData = (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.includes("Etsy MCP Server running on stdio")) {
        cleanup();
        resolve();
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Synthetic OAuth CLI exited before startup (${code ?? signal}).`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  const exited = once(child, "exit").then(([code, signal]) => ({ code, signal }));
  assert.equal(child.stdin.destroyed, false, "stdin must remain open during signal shutdown");
  child.kill("SIGTERM");
  let timer;
  const exitResult = await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), 5_000);
    }),
  ]);
  clearTimeout(timer);
  assert.ok(exitResult, "CLI remained alive after SIGTERM while stdin was open");
  assert.deepEqual(exitResult, { code: 143, signal: null }, stderr);

  const reopened = await storeModule.openConnectionStore(config);
  await reopened.close();
});
