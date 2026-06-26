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

import { createLogger } from '../../../logging';

const logger = createLogger(__filename);

/** Tracks gRPC stream completion (Java {@code GRPCStreamServiceStatus}). */
export default class GRPCStreamServiceStatus {
  private status = false;

  constructor(status = false) {
    this.status = status;
  }

  isStatus(): boolean {
    return this.status;
  }

  finished(): void {
    this.status = true;
  }

  /** Wait until success status reported (Java wait4Finish). */
  wait4Finish(): void {
    let recheckCycle = 5;
    let hasWaited = 0;
    const maxCycle = 30 * 1000;
    while (!this.status) {
      this.try2Sleep(recheckCycle);
      hasWaited += recheckCycle;
      if (recheckCycle >= maxCycle) {
        logger.warn("Collector stream service doesn't response in %s seconds.", hasWaited / 1000);
      } else {
        recheckCycle = Math.min(recheckCycle * 2, maxCycle);
      }
    }
  }

  private try2Sleep(millis: number): void {
    const end = Date.now() + millis;
    while (Date.now() < end) {
      // busy-wait fallback; Node agent has no Thread.sleep in sync path
    }
  }
}
