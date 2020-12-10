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

import ID from '../../trace/ID';
import { ContextCarrier } from './ContextCarrier';

export default class SegmentRef {
  private constructor(
    public refType: 'CrossProcess' | 'CrossThread' = 'CrossProcess',
    public traceId: ID,
    public segmentId: ID,
    public spanId: number,
    public service: string,
    public serviceInstance: string,
    public endpoint: string,
    public clientAddress: string,
  ) {
    this.traceId = traceId;
    this.segmentId = segmentId;
    this.spanId = spanId;
    this.service = service;
    this.serviceInstance = serviceInstance;
    this.endpoint = endpoint;
    this.clientAddress = clientAddress;
  }

  static fromCarrier(carrier: ContextCarrier): SegmentRef {
    return new SegmentRef(
      'CrossProcess',
      carrier.traceId!,
      carrier.segmentId!,
      carrier.spanId!,
      carrier.service!,
      carrier.serviceInstance!,
      carrier.endpoint!,
      carrier.clientAddress!,
    );
  }
}
