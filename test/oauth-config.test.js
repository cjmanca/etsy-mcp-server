import assert from "node:assert/strict";
import test from "node:test";
import {
  createOAuthFixture,
  syntheticOAuthEnvironment,
} from "./helpers/oauth.js";
import {
  normalizePeerIp,
  parseOAuthConfig,
} from "../build/oauth/config.js";

test("nonloopback bind requires exact trusted peers", async (t) => {
  const fixture = await createOAuthFixture(t);
  const env = syntheticOAuthEnvironment(fixture, {
    ETSY_OAUTH_CALLBACK_HOST: "192.0.2.44",
  });

  assert.throws(() => parseOAuthConfig(env, false));

  const configured = parseOAuthConfig(
    {
      ...env,
      ETSY_OAUTH_TRUSTED_PROXY_IPS: "198.51.100.8,::ffff:203.0.113.9",
    },
    false,
  );
  assert.equal(configured.enabled, true);
  if (configured.enabled) {
    assert.deepEqual(configured.config.trustedProxyIps, [
      "198.51.100.8",
      "203.0.113.9",
    ]);
  }
});

test("peer normalization canonicalizes mapped IPv4 and equivalent IPv6", () => {
  assert.equal(normalizePeerIp("::ffff:192.0.2.10"), "192.0.2.10");
  assert.equal(normalizePeerIp("2001:0db8:0:0:0:0:0:1"), "2001:db8::1");
});

test("disabled OAuth configuration reads no other settings or files", () => {
  const accessed = [];
  const env = new Proxy(
    { ETSY_OAUTH_ENABLED: "false" },
    {
      get(target, key) {
        accessed.push(key);
        if (key !== "ETSY_OAUTH_ENABLED") {
          throw new Error("disabled configuration read an unrelated setting");
        }
        return target[key];
      },
    },
  );

  assert.deepEqual(parseOAuthConfig(env, false), { enabled: false });
  assert.deepEqual(accessed, ["ETSY_OAUTH_ENABLED"]);
});

test("OAuth enablement accepts only explicit lowercase booleans", async (t) => {
  const fixture = await createOAuthFixture(t);
  const env = syntheticOAuthEnvironment(fixture);

  for (const value of ["", "TRUE", "False", "yes", "1"]) {
    assert.throws(() => parseOAuthConfig({ ...env, ETSY_OAUTH_ENABLED: value }, false));
  }
  assert.deepEqual(parseOAuthConfig({ ...env, ETSY_OAUTH_ENABLED: "false" }, false), {
    enabled: false,
  });
});

test("OAuth callback requires an exact HTTPS callback path and absolute paths", async (t) => {
  const fixture = await createOAuthFixture(t);
  const env = syntheticOAuthEnvironment(fixture);

  for (const redirect of [
    "http://oauth.invalid/oauth/etsy/callback",
    "https://oauth.invalid/other",
    "https://oauth.invalid/oauth/etsy/callback/",
    "https://oauth.invalid/oauth/etsy/callback?next=/",
    "https://user@oauth.invalid/oauth/etsy/callback",
    "https://*.oauth.invalid/oauth/etsy/callback",
  ]) {
    assert.throws(() =>
      parseOAuthConfig({ ...env, ETSY_OAUTH_REDIRECT_URI: redirect }, false),
    );
  }
  assert.throws(() =>
    parseOAuthConfig({ ...env, ETSY_OAUTH_KEY_FILE: "relative-key" }, false),
  );
  assert.throws(() =>
    parseOAuthConfig({ ...env, ETSY_OAUTH_DATA_DIR: "relative-data" }, false),
  );
});

test("OAuth redirect rejects an empty query delimiter", async (t) => {
  const fixture = await createOAuthFixture(t);
  const env = syntheticOAuthEnvironment(fixture);

  assert.throws(() =>
    parseOAuthConfig({
      ...env,
      ETSY_OAUTH_REDIRECT_URI: "https://oauth.invalid/oauth/etsy/callback?",
    }, false),
  );
});

test("OAuth redirect rejects an empty fragment delimiter", async (t) => {
  const fixture = await createOAuthFixture(t);
  const env = syntheticOAuthEnvironment(fixture);

  assert.throws(() =>
    parseOAuthConfig({
      ...env,
      ETSY_OAUTH_REDIRECT_URI: "https://oauth.invalid/oauth/etsy/callback#",
    }, false),
  );
});

test("proxy lists reject aliases, ranges, zones, wildcards, and empty entries", async (t) => {
  const fixture = await createOAuthFixture(t);
  const env = syntheticOAuthEnvironment(fixture, {
    ETSY_OAUTH_CALLBACK_HOST: "10.0.0.5",
  });

  for (const peers of [
    "proxy.example",
    "10.0.0.0/24",
    "10.0.0.1%eth0",
    "0.0.0.0",
    "224.0.0.1",
    "10.0.0.1,",
    ",10.0.0.1",
    "10.0.0.1,10.0.0.1",
    Array.from({ length: 17 }, (_, index) => `10.0.0.${index + 1}`).join(","),
  ]) {
    assert.throws(() =>
      parseOAuthConfig({ ...env, ETSY_OAUTH_TRUSTED_PROXY_IPS: peers }, false),
    );
  }
});

test("bind address must be a numeric usable IP literal", async (t) => {
  const fixture = await createOAuthFixture(t);
  const env = syntheticOAuthEnvironment(fixture);

  for (const host of ["localhost", "0.0.0.0/0", "::", "ff02::1", "192.0.2.1%3"]) {
    assert.throws(() =>
      parseOAuthConfig({ ...env, ETSY_OAUTH_CALLBACK_HOST: host }, false),
    );
  }
});
