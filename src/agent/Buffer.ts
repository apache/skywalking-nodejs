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

import { createLogger } from '../logging';
import config from '../config/AgentConfig';

const logger = createLogger(__filename);

export default class Buffer<T> {
  private readonly maxSize: number;
  private readonly buffer: T[];

  constructor() {
    this.maxSize = config.maxBufferSize;
    this.buffer = [];
  }

  get length(): number {
    return this.buffer.length;
  }

  put(element: T): boolean {
    if (this.length > this.maxSize) {
      logger.warn('Drop the data because of the buffer is oversize');
      return false;
    }
    this.buffer.push(element);

    return true;
  }

  take(): T {
    return this.buffer.splice(0, 1)[0];
  }
}
