import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createNativeWindowsOAuthFixture,
  createOAuthFixture,
  createOAuthServiceHarness,
  syntheticConnectionIdFor,
  syntheticOAuthConfig,
  syntheticConnection,
} from "./helpers/oauth.js";
import {
  jsonText,
  mockAdapter,
  successResponse,
  withMcp,
} from "./helpers/mcp.js";

const serviceModule = await import("../build/oauth/service.js").catch(() => undefined);
const storeModule = await import("../build/oauth/store.js").catch(() => undefined);
const serverModule = await import("../build/index.js");

const CONNECTION_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const BASE_TIME = 1_800_000_000_000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((complete, failed) => {
    resolve = complete;
    reject = failed;
  });
  return { promise, resolve, reject };
}

function serverFactory(service, developmentMode = false) {
  const runtime = { developmentMode, service, close: async () => {} };
  return (client) => serverModule.createEtsyMcpServer(client, {
    developmentMode,
    oauth: runtime,
  });
}

test("status omits credentials without refreshing", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const tokenCanary = "synthetic-token-canary-status";
  const record = syntheticConnection({
    accessToken: `12345.${tokenCanary}-access`,
    refreshToken: `12345.${tokenCanary}-refresh`,
    unknownCanary: "synthetic-unknown-field-canary",
    reason: "synthetic-reason-canary",
  });
  const fixture = await createOAuthServiceHarness(t, { records: [record] });

  await withMcp(
    mockAdapter((config) => successResponse(config, {})),
    async ({ client }) => {
      const listed = await client.listTools();
      const statusTool = listed.tools.find((tool) => tool.name === "get_etsy_connection_status");
      assert.ok(statusTool);
      assert.deepEqual(statusTool.annotations, {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      const result = await client.callTool({
        name: "get_etsy_connection_status",
        arguments: { connection_id: CONNECTION_ID },
      });
      assert.equal(result.isError, undefined);
      const output = jsonText(result);
      assert.deepEqual(output, {
        connection_id: CONNECTION_ID,
        state: "connected",
        requested_scopes: ["shops_r"],
        granted_scopes: ["shops_r"],
        enabled_capabilities: ["account_identity"],
        account_id: 12345,
        shop_id: 67890,
        expires_at: BASE_TIME + 3_600_000,
      });
      const serialized = JSON.stringify(output);
      assert.ok(Buffer.byteLength(serialized, "utf8") <= 128 * 1024);
      assert.equal(serialized.includes(tokenCanary), false);
      assert.equal(serialized.includes("synthetic-unknown-field-canary"), false);
      assert.deepEqual(fixture.transport.calls.refreshes, []);
    },
    serverFactory(fixture.service),
  );
});

test("status reports pending and terminal callback outcomes locally", async (t) => {
  const fixture = await createOAuthServiceHarness(t);
  const pending = await fixture.service.begin({ bundles: ["catalog_read"] });
  assert.deepEqual(await fixture.service.status(pending.connection_id), {
    connection_id: pending.connection_id,
    state: "pending",
    requested_scopes: ["shops_r", "listings_r"],
    expires_at: BASE_TIME + 300_000,
  });

  const deniedState = new URL(pending.authorization_url).searchParams.get("state");
  assert.equal(await fixture.service.completeCallback({ state: deniedState, denied: true }), "denied");
  assert.deepEqual(await fixture.service.status(pending.connection_id), {
    connection_id: pending.connection_id,
    state: "denied",
    requested_scopes: ["shops_r", "listings_r"],
    reason: "consent_denied",
    reconnect_guidance: "Start a new Etsy authorization flow if you still want to connect this account.",
  });
  assert.deepEqual(fixture.transport.calls.refreshes, []);

  const expiring = await fixture.service.begin({ bundles: [] });
  fixture.setNow(BASE_TIME + 300_000);
  assert.equal(
    await fixture.service.completeCallback({
      state: new URL(expiring.authorization_url).searchParams.get("state"),
      code: "expired-status-code",
    }),
    "failed",
  );
  assert.equal((await fixture.service.status(expiring.connection_id)).state, "expired");

  const failedFixture = await createOAuthServiceHarness(t, {
    transport: { exchange: async () => { throw new Error("Synthetic callback failure with token-canary."); } },
  });
  const failed = await failedFixture.service.begin({ bundles: [] });
  assert.equal(await failedFixture.service.completeCallback({
    state: new URL(failed.authorization_url).searchParams.get("state"),
    code: "failed-status-code",
  }), "failed");
  const failedStatus = await failedFixture.service.status(failed.connection_id);
  assert.equal(failedStatus.state, "failed");
  assert.equal(JSON.stringify(failedStatus).includes("token-canary"), false);
});

test("terminal pending statuses expire after five minutes and are capped at one hundred", async (t) => {
  const fixture = await createOAuthServiceHarness(t);
  const first = await fixture.service.begin({ bundles: [] });
  const firstState = new URL(first.authorization_url).searchParams.get("state");
  assert.equal(await fixture.service.completeCallback({ state: firstState, denied: true }), "denied");

  const terminalIds = [first.connection_id];
  for (let index = 1; index < 101; index += 1) {
    const begin = await fixture.service.begin({ bundles: [] });
    terminalIds.push(begin.connection_id);
    const state = new URL(begin.authorization_url).searchParams.get("state");
    assert.equal(await fixture.service.completeCallback({ state, denied: true }), "denied");
  }
  await assert.rejects(fixture.service.status(terminalIds[0]), {
    name: "OAuthError",
    reason: "connection_unavailable",
  });
  assert.equal((await fixture.service.status(terminalIds[100])).state, "denied");

  fixture.setNow(BASE_TIME + 300_000);
  await assert.rejects(fixture.service.status(terminalIds[100]), {
    name: "OAuthError",
    reason: "connection_unavailable",
  });
});

test("disconnect cannot be resurrected by late refresh", async (t) => {
  const putStarted = deferred();
  const releasePut = deferred();
  const expiring = syntheticConnection({
    issuedAt: BASE_TIME - 3_540_000,
    expiresAt: BASE_TIME + 60_000,
  });
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiring],
    transport: {
      refresh: async () => ({
        accessToken: "12345.rotated-access-token-canary",
        refreshToken: "12345.rotated-refresh-token-canary",
        expiresIn: 3_600,
        grants: {
          scopes: ["shops_r"],
          source: "refresh_response",
          checkedAt: BASE_TIME,
        },
      }),
    },
  });
  fixture.store.setPutBehavior(async (record) => {
    if (record.generation === 2) {
      putStarted.resolve();
      await releasePut.promise;
    }
  });
  t.after(() => releasePut.resolve());

  const freshness = fixture.service.ensureFresh(CONNECTION_ID);
  await putStarted.promise;
  const disconnect = fixture.service.disconnect(CONNECTION_ID);
  assert.equal(fixture.store.calls.removals.length, 0, "durable removal waits for the in-flight refresh commit");

  await assert.rejects(fixture.service.withConnection(CONNECTION_ID, async () => "must not run"), {
    name: "OAuthError",
    reason: "connection_unavailable",
  });
  releasePut.resolve();

  await assert.rejects(freshness, { name: "OAuthError" });
  const result = await disconnect;
  assert.deepEqual(result, {
    connection_id: CONNECTION_ID,
    state: "disconnected",
    local_credentials_removed: true,
    upstream_revoked: false,
  });
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);
  assert.equal(fixture.transport.calls.refreshes.length, 1);
  assert.deepEqual(fixture.store.calls.removals, [{ connectionId: CONNECTION_ID, expectedGeneration: 2 }]);
  assert.deepEqual(await fixture.service.disconnect(CONNECTION_ID), result);
  await assert.rejects(fixture.service.ensureFresh(CONNECTION_ID), {
    name: "OAuthError",
    reason: "connection_unavailable",
  });

  const pending = await fixture.service.begin({ bundles: ["catalog_read"] });
  const state = new URL(pending.authorization_url).searchParams.get("state");
  const pendingDisconnect = await fixture.service.disconnect(pending.connection_id);
  assert.equal(pendingDisconnect.local_credentials_removed, true);
  assert.equal(await fixture.service.completeCallback({ state, code: "late-callback-code" }), "failed");
  assert.equal(fixture.store.records.has(pending.connection_id), false);
  assert.equal((await fixture.service.status(pending.connection_id)).state, "disconnected");
  assert.equal(fixture.transport.calls.exchanges.length, 0);
});

test("disconnect invalidation prevents refresh after a suspended lifecycle read", async (t) => {
  const readStarted = deferred();
  const releaseRead = deferred();
  const expiring = syntheticConnection({
    issuedAt: BASE_TIME - 3_540_000,
    expiresAt: BASE_TIME + 60_000,
  });
  const fixture = await createOAuthServiceHarness(t, { records: [expiring] });
  const originalRead = fixture.connectionStore.read.bind(fixture.connectionStore);
  let readCount = 0;
  fixture.connectionStore.read = async (connectionId) => {
    readCount += 1;
    if (readCount === 1) {
      readStarted.resolve();
      await releaseRead.promise;
    }
    return originalRead(connectionId);
  };
  t.after(() => releaseRead.resolve());

  const freshness = fixture.service.ensureFresh(CONNECTION_ID).then(
    (record) => ({ record }),
    (error) => ({ error }),
  );
  await readStarted.promise;
  const disconnect = fixture.service.disconnect(CONNECTION_ID);
  assert.deepEqual(fixture.transport.calls.refreshes, []);
  releaseRead.resolve();

  const [freshnessResult, disconnected] = await Promise.all([freshness, disconnect]);
  assert.equal(freshnessResult.error?.reason, "connection_unavailable");
  assert.deepEqual(fixture.transport.calls.refreshes, []);
  assert.equal(disconnected.local_credentials_removed, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);
});

test("ensureFresh withholds a fresh credential record after disconnect invalidation", async (t) => {
  const readStarted = deferred();
  const releaseRead = deferred();
  const fixture = await createOAuthServiceHarness(t, { records: [syntheticConnection()] });
  const originalRead = fixture.connectionStore.read.bind(fixture.connectionStore);
  let readCount = 0;
  fixture.connectionStore.read = async (connectionId) => {
    readCount += 1;
    if (readCount === 1) {
      readStarted.resolve();
      await releaseRead.promise;
    }
    return originalRead(connectionId);
  };
  t.after(() => releaseRead.resolve());

  const freshness = fixture.service.ensureFresh(CONNECTION_ID).then(
    (record) => ({ record }),
    (error) => ({ error }),
  );
  await readStarted.promise;
  const disconnect = fixture.service.disconnect(CONNECTION_ID);
  releaseRead.resolve();

  const [freshnessResult, disconnected] = await Promise.all([freshness, disconnect]);
  assert.equal(freshnessResult.error?.reason, "connection_unavailable");
  assert.equal(freshnessResult.record, undefined);
  assert.equal(disconnected.local_credentials_removed, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);
});

test("withConnection revalidates disconnect after its second read", async (t) => {
  const secondReadStarted = deferred();
  const releaseSecondRead = deferred();
  const fixture = await createOAuthServiceHarness(t, { records: [syntheticConnection()] });
  const originalRead = fixture.connectionStore.read.bind(fixture.connectionStore);
  let readCount = 0;
  fixture.connectionStore.read = async (connectionId) => {
    readCount += 1;
    if (readCount === 2) {
      secondReadStarted.resolve();
      await releaseSecondRead.promise;
    }
    return originalRead(connectionId);
  };
  t.after(() => releaseSecondRead.resolve());
  let workStarted = false;

  const work = fixture.service.withConnection(CONNECTION_ID, async () => {
    workStarted = true;
    return "must not run";
  }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await secondReadStarted.promise;
  const disconnect = fixture.service.disconnect(CONNECTION_ID);
  releaseSecondRead.resolve();

  const [workResult, disconnected] = await Promise.all([work, disconnect]);
  assert.equal(workResult.error?.reason, "connection_unavailable");
  assert.equal(workResult.value, undefined);
  assert.equal(workStarted, false);
  assert.equal(disconnected.local_credentials_removed, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);
});

test("withConnection withholds an in-flight work result after disconnect invalidation", async (t) => {
  const workStarted = deferred();
  const releaseWork = deferred();
  const fixture = await createOAuthServiceHarness(t, { records: [syntheticConnection()] });
  t.after(() => releaseWork.resolve());
  let workCompleted = false;

  const work = fixture.service.withConnection(CONNECTION_ID, async () => {
    workStarted.resolve();
    await releaseWork.promise;
    workCompleted = true;
    return "completed-work-result";
  }).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await workStarted.promise;
  const disconnect = fixture.service.disconnect(CONNECTION_ID);
  releaseWork.resolve();

  const [workResult, disconnected] = await Promise.all([work, disconnect]);
  assert.equal(workResult.error?.reason, "connection_unavailable");
  assert.equal(workResult.value, undefined);
  assert.equal(workCompleted, true, "disconnect does not cancel work that already started");
  assert.equal(disconnected.local_credentials_removed, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);
});

test("status does not report a stored connection after disconnect invalidates its read", async (t) => {
  const statusReadStarted = deferred();
  const releaseStatusRead = deferred();
  const fixture = await createOAuthServiceHarness(t, { records: [syntheticConnection()] });
  const originalRead = fixture.connectionStore.read.bind(fixture.connectionStore);
  let readCount = 0;
  fixture.connectionStore.read = async (connectionId) => {
    readCount += 1;
    if (readCount === 1) {
      const snapshot = await originalRead(connectionId);
      statusReadStarted.resolve();
      await releaseStatusRead.promise;
      return snapshot;
    }
    return originalRead(connectionId);
  };
  t.after(() => releaseStatusRead.resolve());

  const status = fixture.service.status(CONNECTION_ID);
  await statusReadStarted.promise;
  const disconnect = fixture.service.disconnect(CONNECTION_ID);
  const disconnected = await disconnect;
  releaseStatusRead.resolve();

  assert.equal((await status).state, "disconnected");
  assert.equal(disconnected.local_credentials_removed, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);
});

test("status cannot release a stored snapshot after its disconnect status expires", async (t) => {
  const statusReadStarted = deferred();
  const releaseStatusRead = deferred();
  const fixture = await createOAuthServiceHarness(t, { records: [syntheticConnection()] });
  const originalRead = fixture.connectionStore.read.bind(fixture.connectionStore);
  let readCount = 0;
  fixture.connectionStore.read = async (connectionId) => {
    readCount += 1;
    if (readCount === 1) {
      const snapshot = await originalRead(connectionId);
      statusReadStarted.resolve();
      await releaseStatusRead.promise;
      return snapshot;
    }
    return originalRead(connectionId);
  };
  t.after(() => releaseStatusRead.resolve());

  const status = fixture.service.status(CONNECTION_ID).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await statusReadStarted.promise;
  const disconnected = await fixture.service.disconnect(CONNECTION_ID);
  assert.equal(disconnected.local_credentials_removed, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);

  fixture.setNow(BASE_TIME + 5 * 60_000);
  await assert.rejects(fixture.service.status(syntheticConnectionIdFor(1)), {
    name: "OAuthError",
    reason: "connection_unavailable",
  });
  releaseStatusRead.resolve();

  const statusResult = await status;
  assert.equal(statusResult.value, undefined);
  assert.equal(statusResult.error?.reason, "connection_unavailable");
  assert.equal(fixture.transport.calls.refreshes.length, 0);
});

test("status cannot release a stored snapshot after its disconnect status is evicted", async (t) => {
  const statusReadStarted = deferred();
  const releaseStatusRead = deferred();
  const fixture = await createOAuthServiceHarness(t, { records: [syntheticConnection()] });
  const originalRead = fixture.connectionStore.read.bind(fixture.connectionStore);
  let readCount = 0;
  fixture.connectionStore.read = async (connectionId) => {
    readCount += 1;
    if (readCount === 1) {
      const snapshot = await originalRead(connectionId);
      statusReadStarted.resolve();
      await releaseStatusRead.promise;
      return snapshot;
    }
    return originalRead(connectionId);
  };
  t.after(() => releaseStatusRead.resolve());

  const status = fixture.service.status(CONNECTION_ID).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await statusReadStarted.promise;
  const disconnected = await fixture.service.disconnect(CONNECTION_ID);
  assert.equal(disconnected.local_credentials_removed, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);

  for (let index = 0; index < 100; index += 1) {
    const pending = await fixture.service.begin({ bundles: [] });
    const state = new URL(pending.authorization_url).searchParams.get("state");
    assert.equal(await fixture.service.completeCallback({ state, denied: true }), "denied");
  }
  releaseStatusRead.resolve();

  const statusResult = await status;
  assert.equal(statusResult.value, undefined);
  assert.equal(statusResult.error?.reason, "connection_unavailable");
  assert.equal(fixture.transport.calls.refreshes.length, 0);
});

test("shutdown drains an accepted disconnect before releasing lifecycle work", async (t) => {
  const removeStarted = deferred();
  const releaseRemove = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [syntheticConnection()],
  });
  const remove = fixture.connectionStore.remove.bind(fixture.connectionStore);
  fixture.connectionStore.remove = async (...args) => {
    removeStarted.resolve();
    await releaseRemove.promise;
    return remove(...args);
  };
  t.after(() => releaseRemove.resolve());

  const disconnect = fixture.service.disconnect(CONNECTION_ID);
  await removeStarted.promise;
  let closeSettled = false;
  const closing = fixture.service.close().then(() => {
    closeSettled = true;
  });
  await Promise.resolve();
  assert.equal(closeSettled, false);
  releaseRemove.resolve();

  assert.deepEqual(await disconnect, {
    connection_id: CONNECTION_ID,
    state: "disconnected",
    local_credentials_removed: true,
    upstream_revoked: false,
  });
  await closing;
  assert.equal(closeSettled, true);
  assert.equal(fixture.store.records.has(CONNECTION_ID), false);
});

test("failed local removal stays disabled and reports recovery required", async (t) => {
  const fixture = await createOAuthServiceHarness(t, {
    records: [syntheticConnection()],
  });
  fixture.connectionStore.remove = async () => {
    throw new Error("Synthetic storage failure with token-canary.");
  };

  const result = await fixture.service.disconnect(CONNECTION_ID);
  assert.deepEqual(result, {
    connection_id: CONNECTION_ID,
    state: "recovery_required",
    local_credentials_removed: false,
    upstream_revoked: false,
  });
  assert.equal(fixture.store.calls.recoveryMarkers, 1);
  await assert.rejects(fixture.service.withConnection(CONNECTION_ID, async () => "must not run"), {
    name: "OAuthError",
    reason: "connection_unavailable",
  });
  assert.equal((await fixture.service.status(CONNECTION_ID)).state, "recovery_required");
  assert.equal(JSON.stringify(result).includes("token-canary"), false);
});

test("uncertain disconnect persistence writes a restart recovery fence", async (t) => {
  assert.equal(typeof storeModule?.openConnectionStore, "function");
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const config = syntheticOAuthConfig(fixture);
  const protectedStore = await storeModule.openConnectionStore(config);
  t.after(async () => protectedStore.close().catch(() => {}));
  const record = syntheticConnection();
  const uncertainRecord = syntheticConnection({ connectionId: syntheticConnectionIdFor(1) });
  await protectedStore.put(record, null);
  await protectedStore.put(uncertainRecord, null);
  const harness = await createOAuthServiceHarness(t, {
    fixture,
    config,
    store: protectedStore,
    initialTime: BASE_TIME,
  });

  const removed = await harness.service.disconnect(CONNECTION_ID);
  assert.deepEqual(removed, {
    connection_id: CONNECTION_ID,
    state: "disconnected",
    local_credentials_removed: true,
    upstream_revoked: false,
  });
  assert.equal(await protectedStore.read(CONNECTION_ID), undefined);

  const originalRemove = protectedStore.remove.bind(protectedStore);
  protectedStore.remove = async (...args) => {
    await originalRemove(...args);
    throw new Error("Synthetic late removal failure with secret-canary.");
  };
  const result = await harness.service.disconnect(uncertainRecord.connectionId);
  assert.deepEqual(result, {
    connection_id: uncertainRecord.connectionId,
    state: "recovery_required",
    local_credentials_removed: false,
    upstream_revoked: false,
  });
  await harness.service.close();
  const markerPath = path.join(config.dataDir, "oauth-recovery-required.json");
  const marker = await fs.readFile(markerPath);
  assert.deepEqual(JSON.parse(marker.toString("utf8")), {
    format: 1,
    owner: config.owner,
    reason: "uncertain_connection_rollback",
  });
  assert.equal(marker.includes(Buffer.from(CONNECTION_ID)), false);
  assert.equal(marker.includes(Buffer.from(uncertainRecord.connectionId)), false);
  assert.equal(marker.includes(Buffer.from(record.accessToken)), false);
  assert.equal(marker.includes(Buffer.from(record.refreshToken)), false);
  await protectedStore.close();
  await assert.rejects(storeModule.openConnectionStore(config), {
    name: "OAuthError",
    reason: "storage_recovery_required",
  });
});

test("lifecycle tools stay available under the local lock and disconnect requires confirmation", async (t) => {
  const fixture = await createOAuthServiceHarness(t, {
    developmentMode: true,
    records: [syntheticConnection()],
  });

  await withMcp(
    mockAdapter((config) => successResponse(config, {})),
    async ({ client }) => {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 31);
      assert.equal(listed.tools.some((tool) => tool.name === "begin_etsy_connection"), false);
      const disconnectTool = listed.tools.find((tool) => tool.name === "disconnect_etsy_connection");
      assert.ok(disconnectTool);
      assert.deepEqual(disconnectTool.annotations, {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });

      const missingConfirmation = await client.callTool({
        name: "disconnect_etsy_connection",
        arguments: { connection_id: CONNECTION_ID },
      });
      assert.equal(missingConfirmation.isError, true);
      assert.equal((await fixture.service.status(CONNECTION_ID)).state, "connected");

      const begin = await client.callTool({
        name: "begin_etsy_connection",
        arguments: { bundles: [] },
      });
      assert.equal(begin.isError, true);
      assert.match(begin.content[0].text, /local development lock/i);

      const disconnected = await client.callTool({
        name: "disconnect_etsy_connection",
        arguments: { connection_id: CONNECTION_ID, confirm_local_disconnect: true },
      });
      assert.equal(disconnected.isError, undefined);
      assert.deepEqual(jsonText(disconnected), {
        connection_id: CONNECTION_ID,
        state: "disconnected",
        local_credentials_removed: true,
        upstream_revoked: false,
      });
    },
    serverFactory(fixture.service, true),
  );
});

test("status tool projection drops unknown runtime fields", async () => {
  const tokenCanary = "synthetic-runtime-token-canary";
  const service = {
    beginAvailable: false,
    async status() {
      return {
        connection_id: CONNECTION_ID,
        state: "connected",
        requested_scopes: ["shops_r"],
        granted_scopes: ["shops_r"],
        enabled_capabilities: ["account_identity"],
        account_id: 12345,
        shop_id: 67890,
        expires_at: BASE_TIME + 3_600_000,
        access_token: tokenCanary,
        reason: tokenCanary,
        authorization_url: "https://unexpected.invalid/?token=secret",
        reconnect_guidance: "https://unexpected.invalid/reconnect?token=secret",
        unknown_field: "not-public",
      };
    },
    async disconnect() {
      return {
        connection_id: CONNECTION_ID,
        state: "disconnected",
        local_credentials_removed: true,
        upstream_revoked: false,
      };
    },
    async begin() {
      throw new Error("not used");
    },
  };

  await withMcp(
    mockAdapter((config) => successResponse(config, {})),
    async ({ client }) => {
      const result = await client.callTool({
        name: "get_etsy_connection_status",
        arguments: { connection_id: CONNECTION_ID },
      });
      assert.equal(result.isError, undefined);
      const output = jsonText(result);
      assert.deepEqual(output, {
        connection_id: CONNECTION_ID,
        state: "connected",
        requested_scopes: ["shops_r"],
        granted_scopes: ["shops_r"],
        enabled_capabilities: ["account_identity"],
        account_id: 12345,
        shop_id: 67890,
        expires_at: BASE_TIME + 3_600_000,
      });
      assert.equal(JSON.stringify(output).includes(tokenCanary), false);
      assert.equal(JSON.stringify(output).includes("unexpected.invalid"), false);
    },
    serverFactory(service),
  );
});

test("lifecycle tools remain hidden and direct calls fail without OAuth readiness", async () => {
  await withMcp(
    mockAdapter((config) => successResponse(config, {})),
    async ({ client }) => {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 29);
      assert.equal(listed.tools.some((tool) => tool.name === "get_etsy_connection_status"), false);
      assert.equal(listed.tools.some((tool) => tool.name === "disconnect_etsy_connection"), false);
      for (const [name, args] of [
        ["get_etsy_connection_status", { connection_id: CONNECTION_ID }],
        ["disconnect_etsy_connection", {
          connection_id: CONNECTION_ID,
          confirm_local_disconnect: true,
        }],
      ]) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /unknown or unsupported/i);
      }
    },
  );
});

test("second transport and foreign connections are denied", async (t) => {
  const foreignRecord = syntheticConnection({
    owner: {
      operatorId: "different_operator",
      appFingerprint: syntheticConnection().owner.appFingerprint,
    },
  });
  const fixture = await createOAuthServiceHarness(t, { records: [foreignRecord] });
  let server;
  await withMcp(
    mockAdapter((config) => successResponse(config, {})),
    async ({ client }) => {
      const [secondServerTransport, secondClientTransport] = InMemoryTransport.createLinkedPair();
      let secondTransportStarted = false;
      const originalStart = secondServerTransport.start.bind(secondServerTransport);
      secondServerTransport.start = async () => {
        secondTransportStarted = true;
        return originalStart();
      };
      await assert.rejects(server.connect(secondServerTransport), /one transport attachment/i);
      assert.equal(secondTransportStarted, false);
      await Promise.all([
        secondServerTransport.close().catch(() => {}),
        secondClientTransport.close().catch(() => {}),
      ]);

      const tools = await client.listTools();
      assert.ok(tools.tools.some((tool) => tool.name === "get_etsy_connection_status"));
      const status = await client.callTool({
        name: "get_etsy_connection_status",
        arguments: { connection_id: CONNECTION_ID },
      });
      const disconnect = await client.callTool({
        name: "disconnect_etsy_connection",
        arguments: { connection_id: CONNECTION_ID, confirm_local_disconnect: true },
      });
      assert.equal(status.isError, true);
      assert.equal(disconnect.isError, true);
      assert.equal(status.content[0].text, disconnect.content[0].text);
      assert.match(status.content[0].text, /connection is unavailable/i);
    },
    (client) => {
      server = serverModule.createEtsyMcpServer(client, {
        developmentMode: false,
        oauth: { developmentMode: false, service: fixture.service, close: async () => {} },
      });
      return server;
    },
  );
});
