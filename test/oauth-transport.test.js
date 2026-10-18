import assert from "node:assert/strict";
import test from "node:test";
import axios, { AxiosError } from "axios";
import {
  createNativeWindowsOAuthFixture,
  createOAuthFixture,
  syntheticOAuthConfig,
  syntheticOAuthEnvKey,
} from "./helpers/oauth.js";

const transportModule = await import("../build/oauth/transport.js").catch(() => undefined);
const scopesModule = await import("../build/oauth/scopes.js").catch(() => undefined);
const typesModule = await import("../build/oauth/types.js").catch(() => undefined);

async function fixture(t) {
  return process.platform === "win32"
    ? createNativeWindowsOAuthFixture(t)
    : createOAuthFixture(t);
}

function installAdapter(t, adapter) {
  const originalCreate = axios.create.bind(axios);
  t.mock.method(axios, "create", (...args) => {
    const client = originalCreate(...args);
    client.defaults.adapter = adapter;
    return client;
  });
}

function response(config, data) {
  return { data, status: 200, statusText: "OK", headers: {}, config };
}

function header(config, name) {
  return config.headers?.get?.(name) ?? config.headers?.[name.toLowerCase()];
}

function completeTokenResponse(overrides = {}) {
  return {
    access_token: "12345.synthetic-access-token",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: "12345.synthetic-refresh-token",
    scope: "shops_r listings_r",
    ...overrides,
  };
}

test("code exchange uses the fixed Etsy token contract and preserves actual grants", async (t) => {
  assert.equal(typeof transportModule?.createOAuthTransport, "function");
  assert.equal(typeof scopesModule?.parseGrantedScopes, "function");
  const calls = [];
  installAdapter(t, async (config) => {
    calls.push(config);
    return response(config, completeTokenResponse());
  });
  const oauthFixture = await fixture(t);
  let limiterCalls = 0;
  const transport = transportModule.createOAuthTransport(
    syntheticOAuthConfig(oauthFixture),
    syntheticOAuthEnvKey,
    async () => {
      limiterCalls += 1;
    },
  );

  const token = await transport.exchange({
    code: "synthetic-code",
    verifier: "a".repeat(43),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "post");
  assert.equal(calls[0].url, "https://api.etsy.com/v3/public/oauth/token");
  assert.equal(calls[0].baseURL, undefined);
  assert.equal(header(calls[0], "x-api-key"), syntheticOAuthEnvKey);
  assert.equal(header(calls[0], "content-type"), "application/x-www-form-urlencoded");
  assert.equal(header(calls[0], "authorization"), undefined);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].data)), {
    grant_type: "authorization_code",
    client_id: "synthetic-keystring",
    redirect_uri: "https://oauth.invalid/oauth/etsy/callback",
    code: "synthetic-code",
    code_verifier: "a".repeat(43),
  });
  assert.equal(calls[0].timeout, 10_000);
  assert.equal(calls[0].maxRedirects, 0);
  assert.equal(calls[0].maxContentLength, 1024 * 1024);
  assert.equal(calls[0].maxBodyLength, 1024 * 1024);
  assert.equal(calls[0].proxy, false);
  assert.equal(calls[0].httpsAgent, undefined);
  assert.equal(limiterCalls, 1);
  assert.deepEqual(token, {
    accessToken: "12345.synthetic-access-token",
    refreshToken: "12345.synthetic-refresh-token",
    expiresIn: 3600,
    grants: {
      scopes: ["shops_r", "listings_r"],
      source: "authorization_code_response",
      checkedAt: token.grants.checkedAt,
    },
  });
});

test("refresh uses the documented refresh_token form field without retrying", async (t) => {
  assert.equal(typeof transportModule?.createOAuthTransport, "function");
  const calls = [];
  installAdapter(t, async (config) => {
    calls.push(config);
    const error = new AxiosError(
      "Synthetic transport failure with token canary",
      AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      { status: 503, statusText: "Unavailable", headers: {}, config, data: {} },
    );
    throw error;
  });
  const oauthFixture = await fixture(t);
  let limiterCalls = 0;
  const transport = transportModule.createOAuthTransport(
    syntheticOAuthConfig(oauthFixture),
    syntheticOAuthEnvKey,
    async () => {
      limiterCalls += 1;
    },
  );

  await assert.rejects(transport.refresh("12345.synthetic-refresh-token"), (error) => {
    assert.equal(error.name, "OAuthError");
    assert.equal(error.message.includes("token canary"), false);
    assert.equal(error.message.includes("synthetic-refresh-token"), false);
    return true;
  });

  assert.equal(calls.length, 1);
  assert.equal(limiterCalls, 1);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].data)), {
    grant_type: "refresh_token",
    client_id: "synthetic-keystring",
    refresh_token: "12345.synthetic-refresh-token",
  });
});

test("getMe uses the fixed route, full bearer token and selected identity", async (t) => {
  assert.equal(typeof transportModule?.createOAuthTransport, "function");
  const calls = [];
  installAdapter(t, async (config) => {
    calls.push(config);
    return response(config, { user_id: 12345, shop_id: 67890 });
  });
  const oauthFixture = await fixture(t);
  const transport = transportModule.createOAuthTransport(
    syntheticOAuthConfig(oauthFixture),
    syntheticOAuthEnvKey,
    async () => {},
  );

  assert.deepEqual(await transport.getMe("12345.full-prefixed-access-token"), {
    accountId: 12345,
    shopId: 67890,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "get");
  assert.equal(calls[0].url, "https://openapi.etsy.com/v3/application/users/me");
  assert.equal(header(calls[0], "x-api-key"), syntheticOAuthEnvKey);
  assert.equal(header(calls[0], "authorization"), "Bearer 12345.full-prefixed-access-token");
  assert.equal(calls[0].data, undefined);
});

test("token response scope is actual evidence and missing or invalid scope fails closed", async (t) => {
  assert.equal(typeof transportModule?.createOAuthTransport, "function");
  const oauthFixture = await fixture(t);
  let payload = completeTokenResponse({ scope: "shops_r" });
  installAdapter(t, async (config) => response(config, payload));
  const transport = transportModule.createOAuthTransport(
    syntheticOAuthConfig(oauthFixture),
    syntheticOAuthEnvKey,
    async () => {},
  );

  const granted = await transport.exchange({ code: "code", verifier: "v".repeat(43) });
  assert.deepEqual(granted.grants.scopes, ["shops_r"]);
  assert.equal(granted.grants.source, "authorization_code_response");

  payload = completeTokenResponse({ scope: undefined });
  await assert.rejects(
    transport.exchange({ code: "code", verifier: "v".repeat(43) }),
    { name: "OAuthError" },
  );
  payload = completeTokenResponse({ scope: "shops_r unknown_future_scope" });
  await assert.rejects(
    transport.refresh("12345.synthetic-refresh-token"),
    { name: "OAuthError" },
  );
});

test("lock rejects exchange and refresh before credential dispatch or rate limiting", async (t) => {
  assert.equal(typeof transportModule?.createOAuthTransport, "function");
  const oauthFixture = await fixture(t);
  const config = { ...syntheticOAuthConfig(oauthFixture), developmentMode: true };
  let adapterCalls = 0;
  let limiterCalls = 0;
  installAdapter(t, async (request) => {
    adapterCalls += 1;
    return response(request, completeTokenResponse());
  });
  const transport = transportModule.createOAuthTransport(
    config,
    "not-a-valid-credential-pair",
    async () => {
      limiterCalls += 1;
    },
  );

  await assert.rejects(transport.exchange({ code: "", verifier: "" }), {
    name: "OAuthError",
    reason: "development_mode_locked",
  });
  await assert.rejects(transport.refresh(""), {
    name: "OAuthError",
    reason: "development_mode_locked",
  });
  assert.equal(adapterCalls, 0);
  assert.equal(limiterCalls, 0);
});

test("OAuth POST errors are not retried after an ambiguous response", async (t) => {
  assert.equal(typeof transportModule?.createOAuthTransport, "function");
  const calls = [];
  installAdapter(t, async (config) => {
    calls.push(config);
    throw new AxiosError("ambiguous", AxiosError.ETIMEDOUT, config);
  });
  const oauthFixture = await fixture(t);
  let slots = 0;
  const transport = transportModule.createOAuthTransport(
    syntheticOAuthConfig(oauthFixture),
    syntheticOAuthEnvKey,
    async () => {
      slots += 1;
    },
  );

  await assert.rejects(
    transport.exchange({ code: "one-time-code", verifier: "v".repeat(43) }),
    { name: "OAuthError" },
  );
  assert.equal(calls.length, 1);
  assert.equal(slots, 1);
});

test("granted-scope parser accepts only bounded known names and valid evidence metadata", () => {
  assert.equal(typeof scopesModule?.parseGrantedScopes, "function");
  const evidence = scopesModule.parseGrantedScopes(
    "shops_r transactions_r",
    "refresh_response",
    1_800_000_000_000,
  );
  assert.deepEqual(evidence, {
    scopes: ["shops_r", "transactions_r"],
    source: "refresh_response",
    checkedAt: 1_800_000_000_000,
  });
  for (const invalid of [
    undefined,
    "",
    "shops_r  transactions_r",
    "shops_r shops_r",
    "shops_r unknown_future_scope",
    "shops_r\ntransactions_r",
    "x".repeat(2_049),
  ]) {
    assert.throws(
      () => scopesModule.parseGrantedScopes(invalid, "authorization_code_response", 1_800_000_000_000),
      { name: "OAuthError" },
    );
  }
  assert.equal(
    scopesModule.parseGrantedScopes("shops_r", "diagnostic", 1_800_000_000_000).source,
    "diagnostic",
  );
  assert.throws(
    () => scopesModule.parseGrantedScopes("shops_r", "untrusted", 1_800_000_000_000),
    { name: "OAuthError" },
  );
  assert.throws(
    () => scopesModule.parseGrantedScopes("shops_r", "authorization_code_response", 0),
    { name: "OAuthError" },
  );
  assert.equal(typeof typesModule?.OAuthError, "function");
});

test("granted-scope arrays require exact bounded unique scope names", () => {
  assert.equal(typeof scopesModule?.parseGrantedScopeList, "function");
  const evidence = scopesModule.parseGrantedScopeList(
    ["shops_r", "transactions_r"],
    "authorization_code_response",
    1_800_000_000_000,
  );
  assert.deepEqual(evidence.scopes, ["shops_r", "transactions_r"]);

  for (const invalid of [
    ["shops_r shops_w"],
    ["shops_r", "shops_r"],
    Array.from({ length: 33 }, () => "shops_r"),
  ]) {
    assert.throws(
      () => scopesModule.parseGrantedScopeList(
        invalid,
        "authorization_code_response",
        1_800_000_000_000,
      ),
      { name: "OAuthError" },
    );
  }
  assert.deepEqual(
    scopesModule.parseGrantedScopes(
      "shops_r transactions_r",
      "authorization_code_response",
      1_800_000_000_000,
    ).scopes,
    ["shops_r", "transactions_r"],
  );
});
