import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import { performance } from "node:perf_hooks";
import {
  createEtsyClient,
  createEtsyRequester,
  EtsyApiError,
} from "../build/etsy-client.js";
import {
  syntheticOAuthConfig,
  syntheticOAuthEnvKey,
} from "./helpers/oauth.js";

const limiterModule = await import("../build/request-limiter.js").catch(() => undefined);
const oauthTransportModule = await import("../build/oauth/transport.js").catch(() => undefined);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createManualClock(initial = 0) {
  let current = initial;
  let sleepCount = 0;
  let sleepAdded = deferred();
  const sleepers = [];

  return {
    now: () => current,
    sleepers,
    get sleepCount() {
      return sleepCount;
    },
    sleep(milliseconds) {
      return new Promise((resolve) => {
        sleepers.push({ milliseconds, resolve });
        sleepCount += 1;
        const added = sleepAdded;
        sleepAdded = deferred();
        added.resolve();
      });
    },
    async waitForSleepCount(count) {
      while (sleepCount < count) await sleepAdded.promise;
    },
    advanceBy(milliseconds) {
      current += milliseconds;
    },
    advanceTo(value) {
      current = value;
    },
    releaseAll() {
      const waiting = sleepers.splice(0);
      for (const sleeper of waiting) sleeper.resolve();
    },
  };
}

function installOAuthAdapter(t, adapter, transform) {
  const originalCreate = axios.create.bind(axios);
  t.mock.method(axios, "create", (...args) => {
    const client = originalCreate(...args);
    client.defaults.adapter = adapter;
    if (transform) {
      const current = client.defaults.transformRequest;
      const transforms = Array.isArray(current) ? [...current] : current ? [current] : [];
      client.defaults.transformRequest = [...transforms, transform];
    }
    return client;
  });
}

function axiosResponse(config, data = {}) {
  return { data, status: 200, statusText: "OK", headers: {}, config };
}

test("one injected limiter spaces actual public and OAuth adapter starts by 200 ms", async (t) => {
  assert.equal(typeof limiterModule?.createRequestLimiter, "function");
  assert.equal(typeof oauthTransportModule?.createOAuthTransport, "function");
  const starts = [];
  const limiter = limiterModule.createRequestLimiter();
  const publicClient = createEtsyClient(syntheticOAuthEnvKey);
  publicClient.defaults.adapter = async (config) => {
    starts.push(performance.now());
    return axiosResponse(config);
  };
  const publicRequester = createEtsyRequester(publicClient, { limiter });
  installOAuthAdapter(t, async (config) => {
    starts.push(performance.now());
    return axiosResponse(config, { user_id: 12345 });
  });
  const oauthTransport = oauthTransportModule.createOAuthTransport(
    syntheticOAuthConfig({ dataDir: process.cwd(), keyFile: process.execPath }),
    syntheticOAuthEnvKey,
    limiter,
  );

  await Promise.all([
    publicRequester.get("/application/shops"),
    oauthTransport.getMe("12345.synthetic-access-token"),
  ]);

  assert.equal(starts.length, 2);
  const gap = Math.abs(starts[1] - starts[0]);
  assert.ok(gap >= 200, `actual adapter starts were only ${gap.toFixed(3)} ms apart`);
});

test("synchronous public adapter reentry queues the real OAuth adapter on the next slot", async (t) => {
  assert.equal(typeof limiterModule?.createRequestLimiter, "function");
  assert.equal(typeof oauthTransportModule?.createOAuthTransport, "function");
  const starts = [];
  const limiter = limiterModule.createRequestLimiter();
  const publicClient = createEtsyClient(syntheticOAuthEnvKey);
  installOAuthAdapter(t, async (config) => {
    starts.push({ kind: "oauth", at: performance.now() });
    return axiosResponse(config, { user_id: 12345 });
  });
  const oauthTransport = oauthTransportModule.createOAuthTransport(
    syntheticOAuthConfig({ dataDir: process.cwd(), keyFile: process.execPath }),
    syntheticOAuthEnvKey,
    limiter,
  );
  let oauthRequest;
  publicClient.defaults.adapter = async (config) => {
    starts.push({ kind: "public", at: performance.now() });
    oauthRequest = oauthTransport.getMe("12345.synthetic-access-token");
    return axiosResponse(config);
  };
  const publicRequester = createEtsyRequester(publicClient, { limiter });

  await publicRequester.get("/application/shops");
  await oauthRequest;

  assert.deepEqual(starts.map((start) => start.kind), ["public", "oauth"]);
  const gap = starts[1].at - starts[0].at;
  assert.ok(gap >= 200, `reentrant public/OAuth adapter starts were only ${gap.toFixed(3)} ms apart`);
});

test("a synchronously throwing public adapter still reserves the reentrant OAuth slot", async (t) => {
  const starts = [];
  const limiter = limiterModule.createRequestLimiter();
  const publicClient = createEtsyClient(syntheticOAuthEnvKey);
  installOAuthAdapter(t, async (config) => {
    starts.push({ kind: "oauth", at: performance.now() });
    return axiosResponse(config, { user_id: 12345 });
  });
  const oauthTransport = oauthTransportModule.createOAuthTransport(
    syntheticOAuthConfig({ dataDir: process.cwd(), keyFile: process.execPath }),
    syntheticOAuthEnvKey,
    limiter,
  );
  let oauthRequest;
  publicClient.defaults.adapter = (config) => {
    starts.push({ kind: "public", at: performance.now() });
    oauthRequest = oauthTransport.getMe("12345.synthetic-access-token");
    throw new Error("synthetic adapter failure");
  };
  const publicRequester = createEtsyRequester(publicClient, { limiter });

  await assert.rejects(publicRequester.get("/application/shops"), { category: "upstream" });
  await oauthRequest;

  assert.deepEqual(starts.map((start) => start.kind), ["public", "oauth"]);
  const gap = starts[1].at - starts[0].at;
  assert.ok(gap >= 200, `sync-throw reentrant adapter starts were only ${gap.toFixed(3)} ms apart`);
});

test("locked public dispatch rechecks a queued method mutation before its adapter", { timeout: 2_000 }, async () => {
  const clock = createManualClock();
  const limiter = limiterModule.createRequestLimiter({ now: clock.now, sleep: clock.sleep });
  await limiter();
  const adapterCalls = [];
  const mutationRan = deferred();
  const client = createEtsyClient(syntheticOAuthEnvKey, { developmentMode: true });
  const defaultTransforms = Array.isArray(client.defaults.transformRequest)
    ? [...client.defaults.transformRequest]
    : [client.defaults.transformRequest];
  client.defaults.transformRequest = [
    ...defaultTransforms,
    function scheduleMethodMutation(data) {
      queueMicrotask(() => {
        this.method = "post";
        mutationRan.resolve();
      });
      return data;
    },
  ];
  client.defaults.adapter = async (config) => {
    adapterCalls.push(config.method);
    return axiosResponse(config);
  };
  const requester = createEtsyRequester(client, { limiter });
  const request = requester.get("/application/read");

  await mutationRan.promise;
  await clock.waitForSleepCount(1);
  clock.advanceBy(200);
  clock.releaseAll();

  await assert.rejects(request, (error) => {
    assert.ok(error instanceof EtsyApiError);
    assert.equal(error.category, "forbidden");
    assert.doesNotMatch(error.message, /synthetic|secret|token/i);
    return true;
  });
  assert.deepEqual(adapterCalls, []);
});

test("OAuth fixed-operation policy is rechecked after each queued transform mutation", { timeout: 5_000 }, async (t) => {
  const clock = createManualClock();
  const limiter = limiterModule.createRequestLimiter({ now: clock.now, sleep: clock.sleep });
  const sensitiveCanary = "synthetic-oauth-secret-canary";
  const mutations = [
    ["method", (config) => { config.method = "post"; }],
    ["origin and path", (config) => { config.url = `https://attacker.invalid/${sensitiveCanary}`; }],
    ["base URL", (config) => { config.baseURL = "https://attacker.invalid"; }],
    ["API key", (config) => { config.headers.set("x-api-key", sensitiveCanary); }],
    ["Host header", (config) => { config.headers.set("host", "attacker.invalid"); }],
    ["HTTP agent", (config) => { config.httpAgent = {}; }],
    ["TLS agent", (config) => { config.httpsAgent = { options: { rejectUnauthorized: false } }; }],
    ["custom transport", (config) => { config.transport = {}; }],
    ["socket path", (config) => { config.socketPath = "/untrusted/socket"; }],
    ["custom DNS lookup", (config) => { config.lookup = () => "127.0.0.1"; }],
    ["auth override", (config) => { config.auth = { username: sensitiveCanary, password: sensitiveCanary }; }],
    ["redirect policy", (config) => { config.maxRedirects = 4; }],
    ["proxy policy", (config) => { config.proxy = { host: "127.0.0.1", port: 8080 }; }],
    ["timeout bound", (config) => { config.timeout = 60_000; }],
    ["response bound", (config) => { config.maxContentLength = 2 * 1024 * 1024; }],
    ["request bound", (config) => { config.maxBodyLength = 2 * 1024 * 1024; }],
  ];
  let pendingMutation;
  let mutationRan = deferred();
  const adapterCalls = [];
  installOAuthAdapter(
    t,
    async (config) => {
      adapterCalls.push(config.url);
      return axiosResponse(config, { user_id: 12345 });
    },
    function scheduleFixedOperationMutation(data) {
      const mutation = pendingMutation;
      if (mutation) {
        queueMicrotask(() => {
          mutation(this);
          pendingMutation = undefined;
          mutationRan.resolve();
        });
      }
      return data;
    },
  );
  const transport = oauthTransportModule.createOAuthTransport(
    syntheticOAuthConfig({ dataDir: process.cwd(), keyFile: process.execPath }),
    syntheticOAuthEnvKey,
    limiter,
  );

  await limiter();
  for (let index = 0; index < mutations.length; index += 1) {
    const [name, mutate] = mutations[index];
    pendingMutation = mutate;
    mutationRan = deferred();
    const previousAdapterCalls = adapterCalls.length;
    const request = transport.getMe("12345.synthetic-access-token");

    await mutationRan.promise;
    await clock.waitForSleepCount(index + 1);
    const sleeper = clock.sleepers.shift();
    assert.ok(sleeper, `${name} case should be queued behind the shared limiter`);
    clock.advanceBy(sleeper.milliseconds);
    sleeper.resolve();

    await assert.rejects(request, (error) => {
      assert.equal(error.name, "OAuthError", `${name} mutation should be rejected by the fixed-operation guard`);
      assert.doesNotMatch(error.message, /synthetic|secret|token|attacker\.invalid/i);
      return true;
    });
    assert.equal(adapterCalls.length, previousAdapterCalls, `${name} mutation reached the underlying adapter`);
  }
});

test("a public request held before its adapter cannot let the OAuth request borrow its slot", async (t) => {
  assert.equal(typeof limiterModule?.createRequestLimiter, "function");
  assert.equal(typeof oauthTransportModule?.createOAuthTransport, "function");
  let elapsed = 10_000.75;
  const limiter = limiterModule.createRequestLimiter({
    now: () => Math.floor(elapsed),
    sleep: (milliseconds) => {
      elapsed += milliseconds;
      return Promise.resolve();
    },
  });
  const starts = [];
  const pipelineEntered = deferred();
  const releasePipeline = deferred();
  const publicClient = createEtsyClient(syntheticOAuthEnvKey);
  publicClient.defaults.adapter = async (config) => {
    starts.push({ kind: "public", at: elapsed });
    return axiosResponse(config);
  };
  publicClient.interceptors.request.use(async (config) => {
    pipelineEntered.resolve();
    await releasePipeline.promise;
    return config;
  });
  const publicRequester = createEtsyRequester(publicClient, { limiter });
  const oauthStarted = deferred();
  installOAuthAdapter(t, async (config) => {
    starts.push({ kind: "oauth", at: elapsed });
    oauthStarted.resolve();
    return axiosResponse(config, { user_id: 12345 });
  });
  const oauthTransport = oauthTransportModule.createOAuthTransport(
    syntheticOAuthConfig({ dataDir: process.cwd(), keyFile: process.execPath }),
    syntheticOAuthEnvKey,
    limiter,
  );

  const publicRequest = publicRequester.get("/application/shops");
  await pipelineEntered.promise;
  // Model work between permit request and adapter entry without relying on a
  // wall-clock sleep; `now` intentionally has Date.now-like 1 ms resolution.
  elapsed += 1.5;
  const oauthRequest = oauthTransport.getMe("12345.synthetic-access-token");
  await oauthStarted.promise;
  releasePipeline.resolve();
  await Promise.all([publicRequest, oauthRequest]);

  assert.equal(starts.length, 2);
  const ordered = starts.toSorted((left, right) => left.at - right.at);
  const gap = ordered[1].at - ordered[0].at;
  assert.ok(
    gap >= 200,
    `public and OAuth adapter starts were only ${gap} virtual ms apart: ${JSON.stringify(ordered)}`,
  );
});

test("a delayed timer wake grants one start, then schedules from that actual grant", { timeout: 2_000 }, async () => {
  assert.equal(typeof limiterModule?.createRequestLimiter, "function");
  const clock = createManualClock();
  const limiter = limiterModule.createRequestLimiter({ now: clock.now, sleep: clock.sleep });
  const starts = [];
  const started = Array.from({ length: 5 }, () => deferred());
  const pending = started.map((event, index) =>
    limiter().then(() => {
      starts.push(clock.now());
      event.resolve();
      return index;
    }),
  );

  await started[0].promise;
  await clock.waitForSleepCount(1);
  clock.advanceTo(5_000);
  clock.releaseAll();
  await started[1].promise;

  assert.equal(
    starts.length,
    2,
    `one late wake must not replay missed slots; observed starts ${JSON.stringify(starts)}`,
  );

  for (let index = 2; index < started.length; index += 1) {
    await clock.waitForSleepCount(index);
    const sleeper = clock.sleepers.shift();
    clock.advanceBy(sleeper.milliseconds);
    sleeper.resolve();
    await started[index].promise;
  }

  await Promise.all(pending);
  assert.deepEqual(starts, [0, 5_000, 5_200, 5_400, 5_600]);
});

test("an early timer wake is rechecked instead of granting a sub-interval start", { timeout: 2_000 }, async () => {
  assert.equal(typeof limiterModule?.createRequestLimiter, "function");
  const clock = createManualClock();
  const limiter = limiterModule.createRequestLimiter({ now: clock.now, sleep: clock.sleep });
  const starts = [];
  await limiter();
  starts.push(clock.now());

  const nextStarted = deferred();
  const next = limiter().then(() => {
    starts.push(clock.now());
    nextStarted.resolve();
  });
  await clock.waitForSleepCount(1);
  clock.releaseAll();

  const outcome = await Promise.race([
    nextStarted.promise.then(() => "started"),
    clock.waitForSleepCount(2).then(() => "rescheduled"),
  ]);
  assert.equal(outcome, "rescheduled", "an early wake must not immediately dispatch the queued request");
  assert.deepEqual(starts, [0]);

  const sleeper = clock.sleepers.shift();
  clock.advanceBy(sleeper.milliseconds);
  sleeper.resolve();
  await next;
  assert.deepEqual(starts, [0, 200]);
});

test("the 26th queued limiter waiter is rejected when 25 are pending", async () => {
  assert.equal(typeof limiterModule?.createRequestLimiter, "function");
  const clock = createManualClock(1_000);
  const limiter = limiterModule.createRequestLimiter({ now: clock.now, sleep: clock.sleep });

  await limiter();
  const pending = Array.from({ length: 25 }, () => limiter());
  assert.equal(clock.sleepers.length, 1, "a single scheduler wake must govern the FIFO queue");
  await assert.rejects(limiter(), { name: "RequestQueueFullError" });

  for (let index = 0; index < pending.length; index += 1) {
    await clock.waitForSleepCount(index + 1);
    const sleeper = clock.sleepers.shift();
    assert.ok(sleeper);
    clock.advanceBy(sleeper.milliseconds);
    sleeper.resolve();
    await pending[index];
  }
  await Promise.all(pending);
});

test("requester maps a full shared queue to the existing safe busy error", async () => {
  assert.equal(typeof limiterModule?.RequestQueueFullError, "function");
  const client = createEtsyClient("synthetic-key:synthetic-secret");
  const requester = createEtsyRequester(client, {
    limiter: async () => {
      throw new limiterModule.RequestQueueFullError();
    },
  });

  await assert.rejects(requester.get("/application/shops"), (error) => {
    assert.ok(error instanceof EtsyApiError);
    assert.equal(error.category, "busy");
    assert.match(error.message, /queue is full/i);
    return true;
  });
});

test("a public GET retry consumes another shared request slot", async () => {
  let slots = 0;
  let attempts = 0;
  const client = createEtsyClient("synthetic-key:synthetic-secret");
  client.defaults.adapter = async (config) => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("Synthetic 503");
      error.isAxiosError = true;
      error.config = config;
      error.response = { status: 503, headers: {}, config };
      throw error;
    }
    return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
  };
  const requester = createEtsyRequester(client, {
    limiter: async () => {
      slots += 1;
    },
  });

  assert.deepEqual(await requester.get("/application/shops"), { ok: true });
  assert.equal(attempts, 2);
  assert.equal(slots, 2);
});
