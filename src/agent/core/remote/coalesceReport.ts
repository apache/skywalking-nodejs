/*!
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

/** Single-flight report guard: if a report is in flight, return it; otherwise start one. */
export type ReportCoalesceState = {
  reporting?: Promise<void>;
};

/**
 * Total budget for one flushCoalesced call (force pending + wait prior in-flight).
 * agent.flush() uses the same constant per phase (SpanContext, then services) so the
 * outer wait is never shorter than what the inner path can consume.
 */
export const FLUSH_WAIT_MS = 2000;

/** Minimal client-streaming surface used by Trace / Meter collect. */
export type CollectStream = {
  write(message: unknown): void;
  end(): void;
  cancel(): void;
};

/** Resolve when `promise` settles or `ms` elapses — never rejects. */
export function awaitWithTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    timer.unref?.();
    promise.then(done, done);
  });
}

function beginFlight(
  state: ReportCoalesceState,
  doReport: () => Promise<void>,
  isClosed: () => boolean,
): Promise<void> {
  // Assign before invoking doReport so sync re-entry (e.g. segments-sent → flush) sees the guard.
  let flight!: Promise<void>;
  state.reporting = flight = Promise.resolve()
    .then(() => {
      if (isClosed()) {
        return;
      }
      return doReport();
    })
    .catch(() => undefined)
    .finally(() => {
      if (state.reporting === flight) {
        state.reporting = undefined;
      }
    });
  return flight;
}

/**
 * Never rejects — callers (timers with `void`, flush) must not see unhandled rejections.
 */
export function coalesceReport(
  state: ReportCoalesceState,
  doReport: () => Promise<void>,
  isClosed: () => boolean,
): Promise<void> {
  if (isClosed()) {
    return Promise.resolve();
  }

  if (state.reporting) {
    return state.reporting.catch(() => undefined);
  }

  return beginFlight(state, doReport, isClosed);
}

/**
 * Always start a new report flight (ignores an existing in-flight promise).
 * Used by flush() after a bounded wait times out so remaining buffer/snapshot is attempted.
 */
export function forceReport(
  state: ReportCoalesceState,
  doReport: () => Promise<void>,
  isClosed: () => boolean,
): Promise<void> {
  if (isClosed()) {
    return Promise.resolve();
  }
  return beginFlight(state, doReport, isClosed);
}

/**
 * Shared Trace/Meter flush: one total `budgetMs` for forceReport of pending data, then
 * waiting on any prior in-flight work (deadline shared — never 2× the constant).
 * Pending has priority: an in-flight batch already had one attempt.
 */
export async function flushCoalesced(
  state: ReportCoalesceState,
  doReport: () => Promise<void>,
  isClosed: () => boolean,
  hasPending: () => boolean,
  budgetMs: number = FLUSH_WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const remaining = (): number => Math.max(0, deadline - Date.now());
  const inflight = state.reporting;

  if (!isClosed() && hasPending()) {
    await awaitWithTimeout(forceReport(state, doReport, isClosed), remaining());
  }
  if (inflight) {
    await awaitWithTimeout(inflight, remaining());
  }
}

/**
 * Shared client-streaming collect: open → write → end, with once-only failure + cancel.
 */
export function runCollectStream(options: {
  open: (onStatus: (error: Error | null) => void) => CollectStream;
  writeAll: (stream: CollectStream) => void;
  onFailure: (reason: string, error: unknown) => void;
  openFailureReason: string;
  endFailureReason: string;
}): Promise<void> {
  return new Promise((resolve) => {
    let failed = false;
    const fail = (reason: string, error: unknown): void => {
      if (failed) {
        return;
      }
      failed = true;
      options.onFailure(reason, error);
    };

    let stream: CollectStream | undefined;
    try {
      stream = options.open((error) => {
        if (error) {
          fail(options.openFailureReason, error);
        }
        resolve();
      });
      options.writeAll(stream);
      try {
        stream.end();
      } catch (error) {
        fail(options.endFailureReason, error);
        try {
          stream.cancel();
        } catch {
          /* ignore */
        }
        resolve();
      }
    } catch (error) {
      fail(options.openFailureReason, error);
      try {
        stream?.cancel();
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}
