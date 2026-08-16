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

/* eslint-env jest */

import {
  awaitWithTimeout,
  coalesceReport,
  flushCoalesced,
  forceReport,
  ReportCoalesceState,
} from '../../src/agent/core/remote/coalesceReport';

describe('coalesceReport', () => {
  it('is single-flight: concurrent callers share the in-flight promise', async () => {
    const state: ReportCoalesceState = {};
    let starts = 0;
    let finish!: () => void;
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const doReport = jest.fn(async () => {
      starts += 1;
      await gate;
    });

    const a = coalesceReport(state, doReport, () => false);
    const b = coalesceReport(state, doReport, () => false);
    await Promise.resolve();
    expect(starts).toBe(1);
    finish();
    await Promise.all([a, b]);
    expect(starts).toBe(1);
  });

  it('never rejects when doReport rejects', async () => {
    const state: ReportCoalesceState = {};
    await expect(
      coalesceReport(
        state,
        async () => {
          throw new Error('boom');
        },
        () => false,
      ),
    ).resolves.toBeUndefined();
  });

  it('forceReport starts a new flight even when one is in progress', async () => {
    const state: ReportCoalesceState = {};
    let starts = 0;
    let finishFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      finishFirst = r;
    });
    const doReport = jest.fn(async () => {
      starts += 1;
      if (starts === 1) {
        await firstGate;
      }
    });

    const first = coalesceReport(state, doReport, () => false);
    await Promise.resolve();
    expect(starts).toBe(1);

    const second = forceReport(state, doReport, () => false);
    await Promise.resolve();
    expect(starts).toBe(2);

    finishFirst();
    await Promise.all([first, second]);
  });

  it('flushCoalesced forces pending before waiting on in-flight', async () => {
    const state: ReportCoalesceState = {};
    let starts = 0;
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const firstGate = new Promise<void>((r) => {
      finishFirst = r;
    });
    const secondGate = new Promise<void>((r) => {
      finishSecond = r;
    });
    const doReport = jest.fn(async () => {
      starts += 1;
      if (starts === 1) {
        await firstGate;
      } else {
        await secondGate;
      }
    });

    void coalesceReport(state, doReport, () => false);
    await Promise.resolve();
    expect(starts).toBe(1);

    const flushPromise = flushCoalesced(
      state,
      doReport,
      () => false,
      () => true,
      80,
    );

    await Promise.resolve();
    await Promise.resolve();
    // Pending is forced while the first flight is still blocked (not after a full wait).
    expect(starts).toBe(2);

    finishSecond();
    await new Promise((r) => setTimeout(r, 30));
    finishFirst();
    await flushPromise;
    expect(starts).toBe(2);
  });

  it('flushCoalesced still awaits forceReport when in-flight would exhaust the budget', async () => {
    const state: ReportCoalesceState = {};
    let forceDone = false;
    const never = new Promise<void>(() => undefined);
    state.reporting = never;

    const doReport = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 40));
      forceDone = true;
    });

    await flushCoalesced(
      state,
      doReport,
      () => false,
      () => true,
      100,
    );
    // Under wait-then-force, budget is spent on `never` and flush returns before force finishes.
    expect(forceDone).toBe(true);
    expect(doReport).toHaveBeenCalledTimes(1);
  });

  it('awaitWithTimeout resolves when the timer wins', async () => {
    const never = new Promise<void>(() => undefined);
    const started = Date.now();
    await awaitWithTimeout(never, 50);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
