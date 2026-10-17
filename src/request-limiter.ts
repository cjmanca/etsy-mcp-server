import { performance } from "node:perf_hooks";

export type RequestLimiter = (() => Promise<void>) & {
  /** Run the final adapter invocation under the shared start scheduler. */
  runAtDispatch?: <T>(dispatch: () => Promise<T>) => Promise<T>;
};

/** Run validation and the adapter invocation together after limiter admission. */
export function runAtLimitedDispatch<T>(
  limiter: RequestLimiter,
  validate: () => void,
  dispatch: () => Promise<T>,
): Promise<T> {
  const invoke = () => {
    validate();
    return dispatch();
  };

  if (limiter.runAtDispatch) return limiter.runAtDispatch(invoke);
  return limiter().then(invoke);
}

const MIN_REQUEST_INTERVAL_MS = 200;
const MAX_PENDING_REQUESTS = 25;

export class RequestQueueFullError extends Error {
  constructor() {
    super("The Etsy request queue is full. Try again shortly.");
    this.name = "RequestQueueFullError";
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type PendingRequest = {
  dispatch: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export function createRequestLimiter(deps?: {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): RequestLimiter {
  let nextStartAt = 0;
  let waitingForSlot = false;
  const queue: PendingRequest[] = [];
  const now = deps?.now ?? (() => performance.now());
  const sleep = deps?.sleep ?? delay;

  function startNext(): void {
    const request = queue.shift();
    if (!request) {
      waitingForSlot = false;
      return;
    }

    // Own the scheduler before entering user/adapter code: a synchronous
    // adapter may reenter runAtDispatch with a request from another client.
    waitingForSlot = true;
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(request.dispatch());
    } catch (error) {
      result = Promise.reject(error);
    }

    // Anchor the next slot after the adapter has actually been invoked. The
    // adapter call above is synchronous; it starts the HTTP attempt before it
    // returns its response promise.
    nextStartAt = now() + MIN_REQUEST_INTERVAL_MS;
    waitingForSlot = false;
    void result.then(request.resolve, request.reject);
    pump();
  }

  async function waitForSlot(): Promise<void> {
    while (true) {
      const remaining = nextStartAt - now();
      if (remaining <= 0) return;
      await sleep(remaining);
    }
  }

  function pump(): void {
    if (waitingForSlot || queue.length === 0) return;

    if (nextStartAt <= now()) {
      startNext();
      return;
    }

    waitingForSlot = true;
    void waitForSlot().then(
      () => startNext(),
      (error) => {
        const request = queue.shift();
        waitingForSlot = false;
        request?.reject(error);
        pump();
      },
    );
  }

  const runAtDispatch: NonNullable<RequestLimiter["runAtDispatch"]> = <T>(
    dispatch: () => Promise<T>,
  ): Promise<T> => {
    if (queue.length >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new RequestQueueFullError());
    }

    return new Promise<T>((resolve, reject) => {
      queue.push({
        dispatch: () => dispatch(),
        resolve: (value) => resolve(value as T),
        reject: (error) => reject(error),
      });
      pump();
    });
  };

  const limiter = (() => runAtDispatch(async () => undefined)) as RequestLimiter;
  limiter.runAtDispatch = runAtDispatch;
  return limiter;
}
