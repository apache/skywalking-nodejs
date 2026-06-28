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

import os from 'os';
import v8 from 'v8';

export type RuntimeSnapshot = {
  heapUsed: number;
  heapTotal: number;
  heapSizeLimit: number;
  rss: number;
  external: number;
  cpuUserPercent: number;
  cpuSystemPercent: number;
};

export default class RuntimeSampler {
  private readonly logicalCpuCount = Math.max(1, os.cpus().length);
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTimestamp = process.hrtime.bigint();

  sample(): RuntimeSnapshot {
    const memory = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - this.lastCpuTimestamp) / 1000;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTimestamp = now;

    const cpuScale = elapsedMicros > 0 ? 100 / elapsedMicros / this.logicalCpuCount : 0;
    const cpuUserPercent = cpuUsage.user * cpuScale;
    const cpuSystemPercent = cpuUsage.system * cpuScale;

    return {
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      heapSizeLimit: heapStats.heap_size_limit,
      rss: memory.rss,
      external: memory.external,
      cpuUserPercent,
      cpuSystemPercent,
    };
  }

  destroy(): void {
    // no-op: kept for symmetry with start/stop lifecycle
  }
}
