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

import config from '../../../config/AgentConfig';
import { MeterData, MeterSingleValue } from '../../../proto/language-agent/Meter_pb';
import RuntimeSampler, { RuntimeSnapshot } from './RuntimeSampler';

const DEFAULT_UPTIME_REPORT_PERIOD_MS = 30000;

/** Maps Node.js runtime samples into MeterReportService single-value meters (instance_nodejs_*). */
export default class RuntimeMetricsCollector {
  private readonly sampler = new RuntimeSampler();
  /** collectedAt of the last report that included instance_nodejs_uptime. */
  private lastUptimeReportAt = 0;

  sample(): RuntimeSnapshot {
    return this.sampler.sample();
  }

  toMeterData(snapshot: RuntimeSnapshot): MeterData[] {
    const gauges: Array<[string, number]> = [
      ['instance_nodejs_process_cpu', snapshot.cpuUserPercent + snapshot.cpuSystemPercent],
      ['instance_nodejs_heap_used', snapshot.heapUsed],
      ['instance_nodejs_heap_total', snapshot.heapTotal],
      ['instance_nodejs_heap_limit', snapshot.heapSizeLimit],
      ['instance_nodejs_rss', snapshot.rss],
      ['instance_nodejs_external_memory', snapshot.external],
      ['instance_nodejs_array_buffers', snapshot.arrayBuffers],
      ['instance_nodejs_peak_malloced_memory', snapshot.peakMallocedMemory],
      ['instance_nodejs_malloced_memory', snapshot.mallocedMemory],
      ['instance_nodejs_old_space_used', snapshot.oldSpaceUsed],
      ['instance_nodejs_new_space_used', snapshot.newSpaceUsed],
    ];

    if (this.shouldIncludeUptime(snapshot.collectedAt)) {
      gauges.splice(7, 0, ['instance_nodejs_uptime', snapshot.uptime]);
      this.lastUptimeReportAt = snapshot.collectedAt;
    }

    return gauges.map(([name, value]) =>
      new MeterData().setSinglevalue(new MeterSingleValue().setName(name).setValue(value)),
    );
  }

  private shouldIncludeUptime(collectedAt: number): boolean {
    if (this.lastUptimeReportAt === 0) {
      return true;
    }
    const period = config.runtimeMetricsUptimeReportPeriod || DEFAULT_UPTIME_REPORT_PERIOD_MS;
    return collectedAt - this.lastUptimeReportAt >= period;
  }

  destroy(): void {
    this.sampler.destroy();
  }
}
