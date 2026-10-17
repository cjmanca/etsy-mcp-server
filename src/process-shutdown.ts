type CatchableShutdownSignal = "SIGINT" | "SIGTERM";

interface ShutdownProcess {
  stdin: {
    once(event: "end" | "close", listener: () => void): unknown;
    off(event: "end" | "close", listener: () => void): unknown;
  };
  on(event: CatchableShutdownSignal, listener: () => void): unknown;
  off(event: CatchableShutdownSignal, listener: () => void): unknown;
  exitCode?: number | string | null;
}

interface ShutdownTransport {
  onclose?: (() => void) | null;
}

export interface ProcessShutdownCoordinator {
  shutdown(): Promise<void>;
  attachTransport(transport: ShutdownTransport): void;
  readonly isShuttingDown: boolean;
}

export function installProcessShutdownHandlers(
  processLike: ShutdownProcess,
  cleanup: () => Promise<void>,
  reportFailure: () => void,
): ProcessShutdownCoordinator {
  let shutdownPromise: Promise<void> | undefined;
  let signalExitCode: number | undefined;
  let cleanupFailureReported = false;

  const detachStdin = () => {
    processLike.stdin.off("end", onStdinTermination);
    processLike.stdin.off("close", onStdinTermination);
  };
  const detachSignals = () => {
    processLike.off("SIGINT", onSigint);
    processLike.off("SIGTERM", onSigterm);
  };
  const reportCleanupFailure = () => {
    if (cleanupFailureReported) return;
    cleanupFailureReported = true;
    if (signalExitCode === undefined &&
      (processLike.exitCode === undefined || processLike.exitCode === null || processLike.exitCode === 0)) {
      processLike.exitCode = 1;
    }
    try {
      reportFailure();
    } catch {
      // Cleanup reporting must not interrupt the shutdown chain.
    }
  };
  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    detachStdin();
    shutdownPromise = Promise.resolve()
      .then(cleanup)
      .catch((error: unknown) => {
        reportCleanupFailure();
        throw error;
      })
      .finally(detachSignals);
    return shutdownPromise;
  };
  const onStdinTermination = () => {
    void shutdown().catch(() => {});
  };
  const onSigint = () => {
    if (signalExitCode === undefined) {
      signalExitCode = 130;
      processLike.exitCode = signalExitCode;
    }
    void shutdown().catch(() => {});
  };
  const onSigterm = () => {
    if (signalExitCode === undefined) {
      signalExitCode = 143;
      processLike.exitCode = signalExitCode;
    }
    void shutdown().catch(() => {});
  };

  processLike.on("SIGINT", onSigint);
  processLike.on("SIGTERM", onSigterm);
  processLike.stdin.once("end", onStdinTermination);
  processLike.stdin.once("close", onStdinTermination);

  return Object.freeze({
    shutdown,
    attachTransport(transport: ShutdownTransport) {
      transport.onclose = () => {
        void shutdown().catch(() => {});
      };
    },
    get isShuttingDown() {
      return shutdownPromise !== undefined;
    },
  });
}
