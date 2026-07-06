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

import RuntimeMetricsCollector from '../../src/agent/core/meter/RuntimeMetricsCollector';
import { RuntimeSnapshot } from '../../src/agent/core/meter/RuntimeSampler';

const EXPECTED_METER_NAMES = [
  'instance_nodejs_process_cpu',
  'instance_nodejs_heap_used',
  'instance_nodejs_heap_total',
  'instance_nodejs_heap_limit',
  'instance_nodejs_rss',
  'instance_nodejs_external_memory',
  'instance_nodejs_array_buffers',
  'instance_nodejs_uptime',
  'instance_nodejs_peak_malloced_memory',
  'instance_nodejs_detached_contexts',
  'instance_nodejs_old_space_used',
  'instance_nodejs_new_space_used',
];

describe('RuntimeMetricsCollector', () => {
  let collector: RuntimeMetricsCollector;

  beforeEach(() => {
    collector = new RuntimeMetricsCollector();
  });

  afterEach(() => {
    collector.destroy();
  });

  it('maps Node.js runtime data into nodejs meter fields', () => {
    const snapshot = collector.sample();
    const meters = collector.toMeterData(snapshot);
    const names = meters.map((meter) => meter.getSinglevalue()?.getName());

    expect(names).toEqual(EXPECTED_METER_NAMES);

    for (const meter of meters) {
      expect(meter.getSinglevalue()?.getValue()).toBeGreaterThanOrEqual(0);
    }

    expect(snapshot.uptime).toBeGreaterThanOrEqual(0);
    expect(snapshot.oldSpaceUsed).toBeGreaterThanOrEqual(0);
    expect(snapshot.newSpaceUsed).toBeGreaterThanOrEqual(0);
  });

  it('maps extended runtime snapshot values into meter single values', () => {
    const snapshot: RuntimeSnapshot = {
      collectedAt: 1_700_000_000_000,
      heapUsed: 100,
      heapTotal: 200,
      heapSizeLimit: 300,
      rss: 400,
      external: 50,
      cpuUserPercent: 1.2,
      cpuSystemPercent: 0.8,
      arrayBuffers: 16,
      uptime: 42.5,
      peakMallocedMemory: 2048,
      detachedContexts: 3,
      oldSpaceUsed: 88,
      newSpaceUsed: 12,
    };

    const meters = collector.toMeterData(snapshot);
    const values: Record<string, number | undefined> = {};
    for (const meter of meters) {
      const name = meter.getSinglevalue()?.getName();
      if (name) {
        values[name] = meter.getSinglevalue()?.getValue();
      }
    }

    expect(values).toEqual({
      instance_nodejs_process_cpu: 2,
      instance_nodejs_heap_used: 100,
      instance_nodejs_heap_total: 200,
      instance_nodejs_heap_limit: 300,
      instance_nodejs_rss: 400,
      instance_nodejs_external_memory: 50,
      instance_nodejs_array_buffers: 16,
      instance_nodejs_uptime: 42.5,
      instance_nodejs_peak_malloced_memory: 2048,
      instance_nodejs_detached_contexts: 3,
      instance_nodejs_old_space_used: 88,
      instance_nodejs_new_space_used: 12,
    });
  });
});
