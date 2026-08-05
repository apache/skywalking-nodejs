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
/* global BigInt */

import os from 'os';
import v8 from 'v8';
import RuntimeSampler from '../../src/agent/core/meter/RuntimeSampler';

describe('RuntimeSampler', () => {
  let sampler: RuntimeSampler;

  beforeEach(() => {
    sampler = new RuntimeSampler();
  });

  afterEach(() => {
    sampler.destroy();
  });

  it('records collectedAt at sample time', () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1_700_000_000_000);
    expect(sampler.sample().collectedAt).toBe(1_700_000_000_000);
  });

  it('samples array buffers, uptime, heap stats, and heap spaces', () => {
    const memoryUsageSpy = jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 1,
      heapTotal: 2,
      heapUsed: 3,
      external: 4,
      arrayBuffers: 5,
    });
    const uptimeSpy = jest.spyOn(process, 'uptime').mockReturnValue(99);
    const heapStatsSpy = jest.spyOn(v8, 'getHeapStatistics').mockReturnValue({
      heap_size_limit: 1000,
      peak_malloced_memory: 2000,
      malloced_memory: 4096,
    } as ReturnType<typeof v8.getHeapStatistics>);
    const heapSpaceSpy = jest
      .spyOn(v8, 'getHeapSpaceStatistics')
      .mockReturnValue([
        { space_name: 'old_space', space_used_size: 80 } as v8.HeapSpaceInfo,
        { space_name: 'new_space', space_used_size: 20 } as v8.HeapSpaceInfo,
      ]);

    const snapshot = sampler.sample();

    expect(snapshot.arrayBuffers).toBe(5);
    expect(snapshot.uptime).toBe(99);
    expect(snapshot.peakMallocedMemory).toBe(2000);
    expect(snapshot.mallocedMemory).toBe(4096);
    expect(snapshot.oldSpaceUsed).toBe(80);
    expect(snapshot.newSpaceUsed).toBe(20);

    memoryUsageSpy.mockRestore();
    uptimeSpy.mockRestore();
    heapStatsSpy.mockRestore();
    heapSpaceSpy.mockRestore();
  });

  it('normalizes process CPU by logical core count', () => {
    jest.spyOn(os, 'cpus').mockReturnValue([{}, {}, {}, {}] as os.CpuInfo[]);

    let cpuCall = 0;
    const cpuUsageSpy = jest.spyOn(process, 'cpuUsage').mockImplementation(() => {
      cpuCall += 1;
      if (cpuCall === 1) {
        return { user: 0, system: 0 };
      }
      return { user: 1_000_000, system: 500_000 };
    });

    let hrtimeCall = 0;
    const hrtimeSpy = jest.spyOn(process.hrtime, 'bigint').mockImplementation(() => {
      hrtimeCall += 1;
      if (hrtimeCall === 1) {
        return BigInt(0);
      }
      return BigInt(1_000_000_000);
    });

    const cpuSampler = new RuntimeSampler();
    const snapshot = cpuSampler.sample();

    // 1s wall, 1 core-second user + 0.5 core-second system on a 4-logical-CPU host => 25% + 12.5%
    expect(snapshot.cpuUserPercent).toBeCloseTo(25);
    expect(snapshot.cpuSystemPercent).toBeCloseTo(12.5);
    expect(snapshot.cpuUserPercent + snapshot.cpuSystemPercent).toBeCloseTo(37.5);

    cpuSampler.destroy();
    cpuUsageSpy.mockRestore();
    hrtimeSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('defaults missing heap spaces to zero', () => {
    jest.spyOn(v8, 'getHeapSpaceStatistics').mockReturnValue([]);

    const snapshot = sampler.sample();

    expect(snapshot.oldSpaceUsed).toBe(0);
    expect(snapshot.newSpaceUsed).toBe(0);

    jest.restoreAllMocks();
  });
});
