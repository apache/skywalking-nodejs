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
import Segment from '../trace/context/Segment';
import config from '../config/AgentConfig';
import TraceReportClient from '../agent/protocol/grpc/clients/TraceReportClient';

const logger = createLogger(__filename);

class Buffer {
  maxSize: number;
  buffer: Segment[];

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
    this.buffer = [];
  }

  get length(): number {
    return this.buffer.length;
  }

  put(segment: Segment): this {
    if (this.buffer.length > this.maxSize) {
      logger.warn('Drop the data because of the buffer is oversized');
      return this;
    }
    this.buffer.push(segment);
    TraceReportClient.ref();  // this is currently hard-coded for grpc, if other protocols added need to change

    return this;
  }
}

export default new Buffer(config.maxBufferSize);
