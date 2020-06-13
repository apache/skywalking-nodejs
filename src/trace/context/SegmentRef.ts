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

import { ContextCarrier } from '@/trace/context/Carrier';

export default class SegmentRef {
  refType = 'CrossProcess';
  traceId: string;
  segmentId: string;
  spanId: number;
  service: string;
  serviceInstance: string;
  endpoint: string;
  clientAddress: string;

  constructor(carrier: ContextCarrier) {
    this.traceId = carrier.traceId;
    this.segmentId = carrier.segmentId;
    this.spanId = carrier.spanId;
    this.service = carrier.service;
    this.serviceInstance = carrier.serviceInstance;
    this.endpoint = carrier.endpoint;
    this.clientAddress = carrier.clientAddress;
  }
}
