import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  createOAuthServiceHarness,
  createOAuthFixture,
  createNativeWindowsOAuthFixture,
  failTemporaryOperation,
  syntheticConnection,
} from "./helpers/oauth.js";

const serviceModule = await import("../build/oauth/service.js").catch(() => undefined);
const storeModule = await import("../build/oauth/store.js").catch(() => undefined);
const typesModule = await import("../build/oauth/types.js").catch(() => undefined);

const BASE_TIME = 1_800_000_000_000;

function stateFrom(result) {
  return new URL(result.authorization_url).searchParams.get("state");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function expiringConnection(overrides = {}) {
  return syntheticConnection({
    issuedAt: BASE_TIME - 3_540_000,
    expiresAt: BASE_TIME + 60_000,
    refreshToken: "12345.synthetic-refresh-token",
    requestedScopes: ["shops_r", "listings_r"],
    grants: {
      scopes: ["shops_r", "listings_r"],
      source: "authorization_code_response",
      checkedAt: BASE_TIME - 3_540_000,
    },
    ...overrides,
  });
}

function replacementToken(overrides = {}) {
  return {
    accessToken: "12345.rotated-access-token",
    refreshToken: "12345.rotated-refresh-token",
    expiresIn: 1_800,
    grants: {
      scopes: ["shops_r"],
      source: "refresh_response",
      checkedAt: BASE_TIME,
    },
    ...overrides,
  };
}

test("refresh is single flight and waits for durable rotation", async (t) => {
  assert.equal(typeof serviceModule?.createOAuthService, "function");
  const responseGate = deferred();
  const responseStarted = deferred();
  const putStarted = deferred();
  const putGate = deferred();
  let responseTime = BASE_TIME;
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: {
      refresh: async (refreshToken) => {
        assert.equal(refreshToken, "12345.synthetic-refresh-token");
        responseStarted.resolve();
        await responseGate.promise;
        return replacementToken({
          expiresIn: 60,
          grants: {
            scopes: ["shops_r"],
            source: "refresh_response",
            checkedAt: responseTime,
          },
        });
      },
    },
  });
  fixture.store.setPutBehavior(async () => {
    putStarted.resolve();
    await putGate.promise;
  });

  const first = fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  const second = fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  await responseStarted.promise;
  assert.equal(fixture.transport.calls.refreshes.length, 1);
  responseTime = BASE_TIME + 5_000;
  fixture.setNow(responseTime);
  responseGate.resolve();
  await putStarted.promise;

  let settled = false;
  void Promise.all([first, second]).then(() => {
    settled = true;
  }, () => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA").generation, 1);
  assert.equal(fixture.store.calls.puts.length, 1);

  putGate.resolve();
  const [firstRecord, secondRecord] = await Promise.all([first, second]);
  assert.deepEqual(firstRecord, secondRecord);
  assert.equal(firstRecord.accessToken, "12345.rotated-access-token");
  assert.equal(firstRecord.refreshToken, "12345.rotated-refresh-token");
  assert.equal(firstRecord.issuedAt, BASE_TIME + 5_000);
  assert.equal(firstRecord.expiresAt, BASE_TIME + 65_000);
  assert.deepEqual(firstRecord.grants.scopes, ["shops_r"]);
  assert.equal(firstRecord.grants.source, "refresh_response");
  assert.equal(firstRecord.state, "connected_limited");
  assert.equal(firstRecord.generation, 2);
  assert.equal(fixture.store.calls.puts[0].expectedGeneration, 1);
  assert.equal(fixture.transport.calls.refreshes.length, 1);
  assert.equal(fixture.transport.calls.identities.length, 0);
});

test("short-lived refresh coalesces concurrent ensureFresh and withConnection callers", async (t) => {
  const responseStarted = deferred();
  const responseGate = deferred();
  const putStarted = deferred();
  const putGate = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: {
      refresh: async () => {
        responseStarted.resolve();
        await responseGate.promise;
        return replacementToken({ expiresIn: 60 });
      },
    },
  });
  fixture.store.setPutBehavior(async (record) => {
    if (record.generation === 2) {
      putStarted.resolve();
      await putGate.promise;
    }
  });
  t.after(() => {
    responseGate.resolve();
    putGate.resolve();
  });

  let workStarted = false;
  let ensureSettled = false;
  let workSettled = false;
  const ensured = fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  void ensured.then(() => { ensureSettled = true; }, () => { ensureSettled = true; });
  const worked = fixture.service.withConnection("AAAAAAAAAAAAAAAAAAAAAA", async (record) => {
    workStarted = true;
    return record.generation;
  });
  void worked.then(() => { workSettled = true; }, () => { workSettled = true; });

  await responseStarted.promise;
  assert.equal(fixture.transport.calls.refreshes.length, 1);
  responseGate.resolve();
  await putStarted.promise;
  await Promise.resolve();
  assert.equal(fixture.transport.calls.refreshes.length, 1);
  assert.equal(ensureSettled, false);
  assert.equal(workSettled, false);
  assert.equal(workStarted, false);
  assert.equal(fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA").generation, 1);

  putGate.resolve();
  const [record, generation] = await Promise.all([ensured, worked]);
  assert.equal(record.generation, 2);
  assert.equal(generation, 2);
  assert.equal(fixture.transport.calls.refreshes.length, 1);
  assert.equal(fixture.store.calls.puts.length, 1);
});

test("uncertain refresh never replays or reuses stale token", async (t) => {
  assert.equal(typeof typesModule?.OAuthError, "function");
  const scenarios = [
    {
      name: "ambiguous timeout",
      error: () => new Error("timeout after synthetic-rotated-refresh-canary"),
    },
    {
      name: "invalid_grant",
      error: () => new typesModule.OAuthError("oauth_request_failed"),
    },
    {
      name: "HTTP 429",
      error: () => new typesModule.OAuthError("oauth_request_failed"),
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const fixture = await createOAuthServiceHarness(subtest, {
        records: [expiringConnection()],
        transport: { refresh: async () => { throw scenario.error(); } },
      });
      let firstError;
      await assert.rejects(
        fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"),
        (error) => {
          firstError = error;
          return error.name === "OAuthError";
        },
      );
      assert.equal(firstError.message.includes("synthetic-rotated-refresh-canary"), false);
      const disabled = fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA");
      assert.equal(disabled.state, "reconnect_required");
      assert.equal(disabled.generation, 2);
      assert.equal(disabled.reason, "refresh_uncertain");
      await assert.rejects(
        fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"),
        { name: "OAuthError" },
      );
      assert.equal(fixture.transport.calls.refreshes.length, 1);
    });
  }
});

test("failed durable rotation blocks the old generation and fences recovery", async (t) => {
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: { refresh: async () => replacementToken() },
  });
  fixture.store.setPutBehavior(async () => {
    throw new Error("synthetic disk failure with token-canary");
  });

  let error;
  await assert.rejects(
    fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"),
    (failure) => {
      error = failure;
      return failure.name === "OAuthError";
    },
  );
  assert.equal(error.message.includes("token-canary"), false);
  assert.equal(fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA").generation, 1);
  assert.equal(fixture.store.calls.recoveryMarkers, 1);
  await assert.rejects(
    fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"),
    { name: "OAuthError" },
  );
  assert.equal(fixture.transport.calls.refreshes.length, 1);
});

test("rotation that expires during commit remains durable but is not returned", async (t) => {
  const putStarted = deferred();
  const putGate = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: { refresh: async () => replacementToken({ expiresIn: 1 }) },
  });
  fixture.store.setPutBehavior(async (record) => {
    if (record.generation === 2) {
      putStarted.resolve();
      await putGate.promise;
      fixture.setNow(BASE_TIME + 2_000);
    }
  });
  t.after(() => putGate.resolve());

  const first = fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  await putStarted.promise;
  putGate.resolve();
  await assert.rejects(first, { name: "OAuthError", reason: "oauth_token_expired" });

  const committed = fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(committed.generation, 2);
  assert.equal(committed.accessToken, "12345.rotated-access-token");
  assert.equal(committed.refreshToken, "12345.rotated-refresh-token");
  assert.equal(committed.state, "connected_limited");
  assert.equal(fixture.store.calls.recoveryMarkers, 0);
  assert.equal(fixture.transport.calls.refreshes.length, 1);

  fixture.transport.setRefresh(async (refreshToken) => {
    assert.equal(refreshToken, "12345.rotated-refresh-token");
    return replacementToken({ expiresIn: 3_600 });
  });
  const refreshed = await fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(refreshed.generation, 3);
  assert.equal(fixture.transport.calls.refreshes.length, 2);
});

test("queued withConnection rejects a short rotation that expires before its callback", async (t) => {
  const firstStarted = deferred();
  const firstGate = deferred();
  const refreshStarted = deferred();
  const putStarted = deferred();
  const putGate = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection({ expiresAt: BASE_TIME + 120_000 })],
    transport: {
      refresh: async () => {
        refreshStarted.resolve();
        return replacementToken({ expiresIn: 1 });
      },
    },
  });
  fixture.store.setPutBehavior(async (record) => {
    if (record.generation === 2) {
      putStarted.resolve();
      await putGate.promise;
      fixture.setNow(BASE_TIME + 122_000);
    }
  });
  t.after(() => {
    firstGate.resolve();
    putGate.resolve();
  });

  let callbackCalls = 0;
  const first = fixture.service.withConnection("AAAAAAAAAAAAAAAAAAAAAA", async (record) => {
    callbackCalls += 1;
    firstStarted.resolve();
    await firstGate.promise;
    return record.generation;
  });
  await firstStarted.promise;
  const queued = fixture.service.withConnection("AAAAAAAAAAAAAAAAAAAAAA", async (record) => {
    callbackCalls += 1;
    return record.generation;
  });
  await Promise.resolve();
  assert.equal(fixture.transport.calls.refreshes.length, 0);

  fixture.setNow(BASE_TIME + 120_001);
  firstGate.resolve();
  assert.equal(await first, 1);
  await refreshStarted.promise;
  await putStarted.promise;
  assert.equal(callbackCalls, 1);
  putGate.resolve();

  await assert.rejects(queued, { name: "OAuthError", reason: "oauth_token_expired" });
  assert.equal(callbackCalls, 1);
  assert.equal(fixture.transport.calls.refreshes.length, 1);
  const committed = fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(committed.generation, 2);
  assert.equal(committed.expiresAt, BASE_TIME + 121_001);
  assert.equal(committed.accessToken, "12345.rotated-access-token");
  assert.equal(committed.refreshToken, "12345.rotated-refresh-token");
  assert.equal(fixture.store.calls.recoveryMarkers, 0);
});

test("malformed, expanded, or account-switched refresh results disable the old grant", async (t) => {
  const cases = [
    {
      name: "missing refresh token",
      token: replacementToken({ refreshToken: undefined }),
      expectedState: "reconnect_required",
    },
    {
      name: "missing actual scope evidence",
      token: replacementToken({ grants: undefined }),
      expectedState: "scope_verification_required",
    },
    {
      name: "scope expansion",
      token: replacementToken({
        grants: {
          scopes: ["shops_r", "listings_r", "transactions_r"],
          source: "refresh_response",
          checkedAt: BASE_TIME,
        },
      }),
      expectedState: "scope_verification_required",
    },
    {
      name: "account prefix change",
      token: replacementToken({
        accessToken: "54321.other-account-access",
        refreshToken: "54321.other-account-refresh",
      }),
      expectedState: "reconnect_required",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const fixture = await createOAuthServiceHarness(subtest, {
        records: [expiringConnection()],
        transport: { refresh: async () => scenario.token },
      });
      await assert.rejects(
        fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"),
        { name: "OAuthError" },
      );
      assert.equal(
        fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA").state,
        scenario.expectedState,
      );
      await assert.rejects(fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"), {
        name: "OAuthError",
      });
      assert.equal(fixture.transport.calls.refreshes.length, 1);
    });
  }
});

test("withConnection waits for durable refresh before releasing the account record", async (t) => {
  const responseGate = deferred();
  const putStarted = deferred();
  const putGate = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: {
      refresh: async () => {
        await responseGate.promise;
        return replacementToken();
      },
    },
  });
  fixture.store.setPutBehavior(async () => {
    putStarted.resolve();
    await putGate.promise;
  });
  let workStarted = false;
  const result = fixture.service.withConnection(
    "AAAAAAAAAAAAAAAAAAAAAA",
    async (record) => {
      workStarted = true;
      return { accessToken: record.accessToken, generation: record.generation };
    },
  );
  await Promise.resolve();
  responseGate.resolve();
  await putStarted.promise;
  assert.equal(workStarted, false);
  putGate.resolve();
  assert.deepEqual(await result, {
    accessToken: "12345.rotated-access-token",
    generation: 2,
  });
});

test("withConnection serializes lifecycle callbacks for one connection", async (t) => {
  const fixture = await createOAuthServiceHarness(t, {
    records: [syntheticConnection({
      expiresAt: BASE_TIME + 3_600_000,
      refreshToken: "12345.synthetic-refresh-token",
    })],
  });
  const firstStarted = deferred();
  const firstGate = deferred();
  let secondStarted = false;
  const first = fixture.service.withConnection("AAAAAAAAAAAAAAAAAAAAAA", async (record) => {
    firstStarted.resolve();
    await firstGate.promise;
    return record.generation;
  });
  await firstStarted.promise;
  const second = fixture.service.withConnection("AAAAAAAAAAAAAAAAAAAAAA", async (record) => {
    secondStarted = true;
    return record.generation;
  });
  await Promise.resolve();
  assert.equal(secondStarted, false);
  firstGate.resolve();
  assert.equal(await first, 1);
  assert.equal(await second, 1);
  assert.equal(secondStarted, true);
});

test("withConnection rejects same-connection lifecycle reentry instead of deadlocking", async (t) => {
  const fixture = await createOAuthServiceHarness(t, {
    records: [syntheticConnection({
      expiresAt: BASE_TIME + 3_600_000,
      refreshToken: "12345.synthetic-refresh-token",
    })],
  });
  const nested = fixture.service.withConnection(
    "AAAAAAAAAAAAAAAAAAAAAA",
    () => fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"),
  );
  const outcome = await Promise.race([
    nested.then((value) => ({ kind: "fulfilled", value }), (error) => ({ kind: "rejected", error })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "deadlocked" }), 50)),
  ]);

  assert.notEqual(outcome.kind, "deadlocked");
  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error.name, "OAuthError");
  assert.equal(outcome.error.reason, "oauth_flow_invalid");
  await fixture.service.close();
});

test("local development lock denies lifecycle work before store reads", async (t) => {
  const fixture = await createOAuthServiceHarness(t, {
    developmentMode: true,
    records: [expiringConnection()],
  });
  let workCalls = 0;

  await assert.rejects(fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA"), {
    name: "OAuthError",
    reason: "development_mode_locked",
  });
  await assert.rejects(
    fixture.service.withConnection("AAAAAAAAAAAAAAAAAAAAAA", async () => {
      workCalls += 1;
    }),
    { name: "OAuthError", reason: "development_mode_locked" },
  );
  assert.equal(fixture.store.calls.reads.length, 0);
  assert.equal(fixture.transport.calls.refreshes.length, 0);
  assert.equal(workCalls, 0);
});

test("foreign owner and unknown connection IDs have the same unavailable outcome", async (t) => {
  const foreign = syntheticConnection({
    owner: {
      operatorId: "different_operator",
      appFingerprint: syntheticConnection().owner.appFingerprint,
    },
    expiresAt: BASE_TIME + 1,
  });
  const fixture = await createOAuthServiceHarness(t, {
    records: [foreign],
  });
  const errors = [];
  for (const connectionId of ["AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB"]) {
    try {
      await fixture.service.ensureFresh(connectionId);
      assert.fail("foreign or absent record was accepted");
    } catch (error) {
      errors.push(error);
    }
  }
  assert.equal(errors[0].name, "OAuthError");
  assert.equal(errors[1].name, "OAuthError");
  assert.equal(errors[0].reason, errors[1].reason);
  assert.equal(fixture.transport.calls.refreshes.length, 0);
});

test("a pending reconnect cannot overwrite a refresh that committed a newer generation", async (t) => {
  const refreshStarted = deferred();
  const refreshGate = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: {
      refresh: async () => {
        refreshStarted.resolve();
        await refreshGate.promise;
        return replacementToken();
      },
    },
  });
  const refresh = fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  await refreshStarted.promise;
  const reconnect = await fixture.service.begin({
    bundles: [],
    replaceConnectionId: "AAAAAAAAAAAAAAAAAAAAAA",
  });
  const callback = fixture.service.completeCallback({
    state: stateFrom(reconnect),
    code: "synthetic-reconnect-code",
  });
  await Promise.resolve();
  assert.equal(fixture.transport.calls.exchanges.length, 0);

  refreshGate.resolve();
  const refreshed = await refresh;
  assert.equal(await callback, "failed");
  assert.equal(fixture.transport.calls.exchanges.length, 0);
  const saved = fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(saved.generation, refreshed.generation);
  assert.equal(saved.accessToken, "12345.rotated-access-token");
  assert.equal(saved.refreshToken, "12345.rotated-refresh-token");
});

test("shutdown drains an in-flight refresh and commits a returned rotation before close", async (t) => {
  const refreshStarted = deferred();
  const refreshGate = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: {
      refresh: async () => {
        refreshStarted.resolve();
        await refreshGate.promise;
        return replacementToken();
      },
    },
  });
  const refresh = fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  await refreshStarted.promise;
  let closeSettled = false;
  const close = fixture.service.close().then(() => {
    closeSettled = true;
  });
  await Promise.resolve();
  assert.equal(closeSettled, false);
  refreshGate.resolve();

  await assert.rejects(refresh, { name: "OAuthError" });
  await close;
  const saved = fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(saved.generation, 2);
  assert.equal(saved.accessToken, "12345.rotated-access-token");
  assert.equal(saved.refreshToken, "12345.rotated-refresh-token");
  assert.equal(fixture.transport.calls.refreshes.length, 1);
});

test("shutdown with an ambiguous refresh durably disables the possibly rotated record", async (t) => {
  const refreshStarted = deferred();
  const refreshGate = deferred();
  const fixture = await createOAuthServiceHarness(t, {
    records: [expiringConnection()],
    transport: {
      refresh: async () => {
        refreshStarted.resolve();
        await refreshGate.promise;
        throw new Error("timeout after server rotation");
      },
    },
  });
  const refresh = fixture.service.ensureFresh("AAAAAAAAAAAAAAAAAAAAAA");
  await refreshStarted.promise;
  let closeSettled = false;
  const close = fixture.service.close().then(() => {
    closeSettled = true;
  });
  await Promise.resolve();
  assert.equal(closeSettled, false);
  refreshGate.resolve();

  await assert.rejects(refresh, { name: "OAuthError" });
  await close;
  const saved = fixture.store.records.get("AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(saved.generation, 2);
  assert.equal(saved.state, "reconnect_required");
  assert.equal(saved.reason, "refresh_uncertain");
  assert.equal(fixture.transport.calls.refreshes.length, 1);
});

test("failed refresh rotation persistence writes the protected recovery marker", async (t) => {
  assert.equal(typeof storeModule?.openConnectionStore, "function");
  const fixture = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const config = (await import("./helpers/oauth.js")).syntheticOAuthConfig(fixture);
  const store = await storeModule.openConnectionStore(config);
  t.after(async () => store.close().catch(() => {}));
  const original = expiringConnection();
  await store.put(original, null);
  const harness = await createOAuthServiceHarness(t, {
    fixture,
    config,
    store,
    transport: { refresh: async () => replacementToken() },
  });
  failTemporaryOperation(t, "writeFile", "ENOSPC");

  await assert.rejects(
    harness.service.ensureFresh(original.connectionId),
    { name: "OAuthError" },
  );
  await harness.service.close();
  const markerPath = path.join(config.dataDir, "oauth-recovery-required.json");
  const markerBytes = await fs.readFile(markerPath);
  assert.deepEqual(JSON.parse(markerBytes.toString("utf8")), {
    format: 1,
    owner: config.owner,
    reason: "uncertain_connection_rollback",
  });
  assert.equal(markerBytes.includes(Buffer.from(original.connectionId)), false);
  assert.equal(markerBytes.includes(Buffer.from(original.accessToken)), false);
  assert.equal(markerBytes.includes(Buffer.from("rotated-access-token")), false);
  await store.close();

  let keyOpens = 0;
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async (file, ...args) => {
    if (path.resolve(String(file)) === path.resolve(config.keyFile)) keyOpens += 1;
    return originalOpen(file, ...args);
  });
  await assert.rejects(storeModule.openConnectionStore(config), {
    name: "OAuthError",
    reason: "storage_recovery_required",
  });
  assert.equal(keyOpens, 0);
});
