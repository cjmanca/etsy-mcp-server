import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect as netConnect, createServer as createTcpServer } from "node:net";
import { once } from "node:events";
import test from "node:test";
import {
  createNativeWindowsOAuthFixture,
  createOAuthFixture,
  syntheticOAuthConfig,
} from "./helpers/oauth.js";

const callbackModule = await import("../build/oauth/callback.js").catch(() => undefined);

function encodedState(value) {
  return Buffer.alloc(32, value).toString("base64url");
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function fixture(t, trustedProxyIps = ["127.0.0.1"]) {
  const storage = process.platform === "win32"
    ? await createNativeWindowsOAuthFixture(t)
    : await createOAuthFixture(t);
  const port = await unusedLocalhostPort();
  return {
    ...storage,
    config: {
      ...syntheticOAuthConfig(storage),
      callbackHost: "127.0.0.1",
      callbackPort: port,
      trustedProxyIps,
    },
  };
}

async function unusedLocalhostPort() {
  const server = createTcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function get(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: requestPath,
      method: options.method ?? "GET",
      headers: options.headers,
      timeout: options.timeout ?? 4_000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("timeout", () => request.destroy(new Error("Synthetic client timeout.")));
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

test("spoofed forwarding headers cannot authorize the actual socket peer", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const state = encodedState(1);
  const oauthFixture = await fixture(t, ["127.0.0.2"]);
  let completions = 0;
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async () => {
    completions += 1;
    return "complete";
  });
  t.after(() => handle.close());

  const result = await get(
    oauthFixture.config.callbackPort,
    `/oauth/etsy/callback?state=${state}&code=secret-code-canary`,
    {
      headers: {
        "X-Forwarded-For": "127.0.0.2",
        "X-Forwarded-Host": "evil.example",
        "Forwarded": "for=127.0.0.2;host=evil.example;proto=https",
        "Host": "evil.example",
      },
    },
  );

  assert.ok(result.status >= 400);
  assert.equal(completions, 0);
  assert.equal(result.body.includes(state), false);
  assert.equal(result.body.includes("secret-code-canary"), false);
  assert.equal(result.body.includes("evil.example"), false);
});

test("trusted callback returns bounded static HTML without reflecting OAuth values", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const oauthFixture = await fixture(t);
  const state = encodedState(2);
  const code = "one-time-code-canary";
  const received = [];
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async (input) => {
    received.push(input);
    return "complete";
  });
  t.after(() => handle.close());

  const result = await get(
    oauthFixture.config.callbackPort,
    `/oauth/etsy/callback?state=${state}&code=${code}`,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(received, [{ state, code }]);
  assert.ok(Buffer.byteLength(result.body, "utf8") < 4 * 1024);
  assert.equal(result.body.includes(state), false);
  assert.equal(result.body.includes(code), false);
  assert.equal(result.body.includes("etsy.com"), false);
  assert.match(result.headers["cache-control"], /no-store/i);
  assert.equal(result.headers["referrer-policy"], "no-referrer");
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.equal(result.headers["content-type"], "text/html; charset=utf-8");
  assert.match(result.headers["content-security-policy"], /default-src 'none'/);
});

test("callback rejects invalid routes, duplicate parameters, body, and oversized query", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const oauthFixture = await fixture(t);
  let completions = 0;
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async () => {
    completions += 1;
    return "complete";
  });
  t.after(() => handle.close());

  const checks = [
    ["/unrelated?state=A&code=code", { status: 404 }],
    ["/oauth/etsy/callback?state=A&code=code", { method: "POST", status: 405 }],
    ["/oauth/etsy/callback?state=A&state=B&code=code", { status: 400 }],
    ["/oauth/etsy/callback?state=A&code=code&extra=x", { status: 400 }],
    ["/oauth/etsy/callback?state=%ZZ&code=code", { status: 400 }],
    ["/oauth/etsy/callback?state=A&code=code&error=access_denied", { status: 400 }],
    [`/oauth/etsy/callback?${"x".repeat(8_193)}`, { status: 400 }],
  ];
  for (const [path, expected] of checks) {
    const result = await get(oauthFixture.config.callbackPort, path, {
      ...(expected.method ? { method: expected.method } : {}),
    });
    assert.equal(result.status, expected.status, path.slice(0, 48));
    assert.equal(result.body.includes("%ZZ"), false);
  }
  const bodyRequest = await get(
    oauthFixture.config.callbackPort,
    `/oauth/etsy/callback?state=${encodedState(3)}&code=body-code`,
    { headers: { "content-length": "1" }, body: "x" },
  );
  assert.equal(bodyRequest.status, 400);
  assert.equal(completions, 0);
});

test("a valid denial passes only state and a denial marker", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const oauthFixture = await fixture(t);
  const state = encodedState(4);
  const received = [];
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async (input) => {
    received.push(input);
    return "denied";
  });
  t.after(() => handle.close());

  const result = await get(
    oauthFixture.config.callbackPort,
    `/oauth/etsy/callback?state=${state}&error=access_denied&error_description=secret-description&error_uri=https%3A%2F%2Fevil.invalid`,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(received, [{ state, denied: true }]);
  assert.equal(result.body.includes(state), false);
  assert.equal(result.body.includes("secret-description"), false);
  assert.equal(result.body.includes("evil.invalid"), false);
});

test("callback permits at most two concurrent exchanges", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const oauthFixture = await fixture(t);
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let started = 0;
  let startedResolve;
  const twoStarted = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async () => {
    started += 1;
    if (started === 2) startedResolve();
    await blocked;
    return "complete";
  });
  t.after(async () => {
    release();
    await handle.close();
  });

  const requests = [1, 2, 3].map((index) =>
    get(
      oauthFixture.config.callbackPort,
      `/oauth/etsy/callback?state=${encodedState(index)}&code=code-${index}`,
    ),
  );
  await twoStarted;
  const overloaded = Promise.any(requests.map((request) => request.then((result) => {
    if (result.status !== 503) throw new Error("Not overloaded.");
    return result;
  })));
  await overloaded;
  release();
  const firstResults = await Promise.all(requests);

  assert.equal(started, 2);
  assert.ok(firstResults.some((result) => result.status === 503));
  assert.equal(firstResults.filter((result) => result.status === 200).length, 2);
});

test("rejected exchange overloads do not release slots before real completion", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const oauthFixture = await fixture(t);
  const firstGate = deferred();
  const secondGate = deferred();
  const afterReleaseGate = deferred();
  const firstTwoStarted = deferred();
  const afterReleaseStarted = deferred();
  const startedCodes = [];
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async ({ code }) => {
    startedCodes.push(code);
    if (startedCodes.length === 2) firstTwoStarted.resolve();
    if (code === "code-1") await firstGate.promise;
    if (code === "code-2") await secondGate.promise;
    if (code === "after-release") {
      afterReleaseStarted.resolve();
      await afterReleaseGate.promise;
    }
    return "complete";
  });
  t.after(async () => {
    firstGate.resolve();
    secondGate.resolve();
    afterReleaseGate.resolve();
    await handle.close();
  });

  const makeCodeRequest = (state, code) => get(
    oauthFixture.config.callbackPort,
    `/oauth/etsy/callback?state=${encodedState(state)}&code=${code}`,
  );
  const first = makeCodeRequest(10, "code-1");
  const second = makeCodeRequest(11, "code-2");
  await firstTwoStarted.promise;

  const firstOverload = await makeCodeRequest(12, "overload-one");
  const secondOverload = await makeCodeRequest(13, "overload-two");
  const bothOverloadsRejected = firstOverload.status === 503 && secondOverload.status === 503;
  const noOverloadHandlerStarted = startedCodes.length === 2;

  firstGate.resolve();
  const firstResponse = await first;
  const afterRelease = makeCodeRequest(14, "after-release");
  await afterReleaseStarted.promise;
  const nowFullA = await makeCodeRequest(15, "overload-three");
  const nowFullB = await makeCodeRequest(16, "overload-four");
  const stillFullAfterRepeatedRejections = nowFullA.status === 503 && nowFullB.status === 503;
  const noRejectedHandlerStarted = startedCodes.length === 3;

  secondGate.resolve();
  afterReleaseGate.resolve();
  const [secondResponse, afterReleaseResponse] = await Promise.all([second, afterRelease]);
  const afterBothCompleted = await makeCodeRequest(17, "after-both-completed");

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(afterReleaseResponse.status, 200);
  assert.equal(bothOverloadsRejected, true);
  assert.equal(noOverloadHandlerStarted, true);
  assert.equal(stillFullAfterRepeatedRejections, true);
  assert.equal(noRejectedHandlerStarted, true);
  assert.equal(afterBothCompleted.status, 200);
});

test("rejected request overloads preserve active-request accounting until a handler completes", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const oauthFixture = await fixture(t);
  const gates = Array.from({ length: 11 }, () => deferred());
  const tenStarted = deferred();
  const eleventhStarted = deferred();
  const firstHandlerStarted = deferred();
  const gateByState = new Map(
    Array.from({ length: 10 }, (_, index) => [encodedState(30 + index), gates[index]]),
  );
  gateByState.set(encodedState(42), gates[10]);
  let started = 0;
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async ({ state }) => {
    started += 1;
    if (state === encodedState(39)) firstHandlerStarted.resolve();
    if (started === 10) tenStarted.resolve();
    if (started === 11) eleventhStarted.resolve();
    const gate = gateByState.get(state);
    assert.ok(gate, "only accepted callback requests have a synthetic gate");
    await gate.promise;
    return "denied";
  });
  t.after(async () => {
    for (const gate of gates) gate.resolve();
    await handle.close();
  });

  const makeDenialRequest = (state) => get(
    oauthFixture.config.callbackPort,
    `/oauth/etsy/callback?state=${encodedState(state)}&error=access_denied`,
  );
  // Start a later state first so the test cannot depend on TCP arrival order.
  const initial = new Array(10);
  initial[9] = makeDenialRequest(39);
  await firstHandlerStarted.promise;
  for (let state = 30; state < 39; state += 1) {
    initial[state - 30] = makeDenialRequest(state);
  }
  await tenStarted.promise;

  const firstOverload = await makeDenialRequest(40);
  const secondOverload = await makeDenialRequest(41);
  const bothOverloadsRejected = firstOverload.status === 503 && secondOverload.status === 503;
  const noOverloadHandlerStarted = started === 10;

  gates[0].resolve();
  const firstResponse = await initial[0];
  const acceptedAfterRelease = makeDenialRequest(42);
  await eleventhStarted.promise;
  const stillFull = await makeDenialRequest(43);

  for (const gate of gates) gate.resolve();
  await Promise.all(initial.slice(1));
  await acceptedAfterRelease;

  assert.equal(firstResponse.status, 200);
  assert.equal(bothOverloadsRejected, true);
  assert.equal(noOverloadHandlerStarted, true);
  assert.equal(stillFull.status, 503);
  assert.equal(started, 11);
});

test("callback ingress times out incomplete request headers", async (t) => {
  assert.equal(typeof callbackModule?.startCallbackServer, "function");
  const oauthFixture = await fixture(t);
  const handle = await callbackModule.startCallbackServer(oauthFixture.config, async () => "failed");
  t.after(() => handle.close());

  const socket = await new Promise((resolve, reject) => {
    const connection = netConnect(
      oauthFixture.config.callbackPort,
      "127.0.0.1",
    );
    connection.once("connect", () => resolve(connection));
    connection.once("error", reject);
  });
  const closed = once(socket, "close");
  socket.write("GET /oauth/etsy/callback HTTP/1.1\r\nHost:");
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Callback socket did not time out.")), 8_000);
    timer.unref?.();
  });
  const startedAt = Date.now();
  await Promise.race([closed, timeout]);
  assert.ok(Date.now() - startedAt <= 8_000);
});
