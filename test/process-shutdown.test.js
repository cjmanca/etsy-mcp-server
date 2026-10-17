import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

const shutdownModule = await import("../build/process-shutdown.js").catch(() => undefined);

function fakeProcess() {
  const processLike = new EventEmitter();
  processLike.stdin = new EventEmitter();
  processLike.exitCode = 0;
  return processLike;
}

test("catchable process signals share one graceful shutdown while startup is pending", async () => {
  assert.equal(typeof shutdownModule?.installProcessShutdownHandlers, "function");

  for (const [signal, expectedCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const processLike = fakeProcess();
    let releaseStartup;
    const startupReady = new Promise((resolve) => {
      releaseStartup = resolve;
    });
    const sequence = [];
    let cleanupCalls = 0;
    let reportedFailures = 0;
    const coordinator = shutdownModule.installProcessShutdownHandlers(
      processLike,
      async () => {
        await startupReady;
        cleanupCalls += 1;
        sequence.push("oauth-service-and-callback");
        sequence.push("stdio-transport");
        sequence.push("protected-store");
      },
      () => {
        reportedFailures += 1;
      },
    );
    const transport = { onclose: undefined };
    coordinator.attachTransport(transport);

    processLike.emit(signal);
    const shutdown = coordinator.shutdown();
    processLike.stdin.emit("end");
    transport.onclose();
    assert.equal(coordinator.isShuttingDown, true);
    assert.equal(processLike.exitCode, expectedCode);
    assert.deepEqual(sequence, [], "shutdown must wait until startup has handed off its resources");

    releaseStartup();
    await shutdown;
    assert.equal(cleanupCalls, 1);
    assert.equal(reportedFailures, 0);
    assert.deepEqual(sequence, [
      "oauth-service-and-callback",
      "stdio-transport",
      "protected-store",
    ]);
    processLike.emit(signal);
    assert.equal(cleanupCalls, 1, "later triggers must not run cleanup twice");
  }
});

test("non-signal shutdown failures are reported and set an unsuccessful exit code", async () => {
  assert.equal(typeof shutdownModule?.installProcessShutdownHandlers, "function");
  const processLike = fakeProcess();
  let reports = 0;
  const coordinator = shutdownModule.installProcessShutdownHandlers(
    processLike,
    async () => {
      throw new Error("Synthetic cleanup failure.");
    },
    () => {
      reports += 1;
    },
  );

  await assert.rejects(coordinator.shutdown(), /Synthetic cleanup failure/);
  assert.equal(processLike.exitCode, 1);
  assert.equal(reports, 1);
});
