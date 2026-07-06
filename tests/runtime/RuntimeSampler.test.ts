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
      number_of_detached_contexts: 7,
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
    expect(snapshot.detachedContexts).toBe(7);
    expect(snapshot.oldSpaceUsed).toBe(80);
    expect(snapshot.newSpaceUsed).toBe(20);

    memoryUsageSpy.mockRestore();
    uptimeSpy.mockRestore();
    heapStatsSpy.mockRestore();
    heapSpaceSpy.mockRestore();
  });

  it('defaults missing heap spaces to zero', () => {
    jest.spyOn(v8, 'getHeapSpaceStatistics').mockReturnValue([]);

    const snapshot = sampler.sample();

    expect(snapshot.oldSpaceUsed).toBe(0);
    expect(snapshot.newSpaceUsed).toBe(0);

    jest.restoreAllMocks();
  });
});
