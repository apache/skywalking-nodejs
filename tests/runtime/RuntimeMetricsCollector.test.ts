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

    expect(names).toEqual(
      expect.arrayContaining([
        'instance_nodejs_process_cpu',
        'instance_nodejs_heap_used',
        'instance_nodejs_heap_total',
        'instance_nodejs_heap_limit',
        'instance_nodejs_rss',
        'instance_nodejs_external_memory',
      ]),
    );

    expect(names).toHaveLength(6);

    for (const meter of meters) {
      expect(meter.getSinglevalue()?.getValue()).toBeGreaterThanOrEqual(0);
    }
  });
});
