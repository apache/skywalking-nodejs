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
import { CarrierItem } from './CarrierItem';

export class ContextCarrier extends CarrierItem {
  constructor(
    public traceId?: ID,
    public segmentId?: ID,
    public spanId?: number,
    public service?: string,
    public serviceInstance?: string,
    public endpoint?: string,
    public clientAddress?: string,
    public items: CarrierItem[] = [],
  ) {
    super('sw8');
    this.items.push(this);
  }

  private encode = (s: string): string => {
    return Buffer.from(s).toString('base64');
  };

  private decode = (s: string): string => {
    return Buffer.from(s, 'base64').toString();
  };

  get value(): string {
    return [
      '1',
      this.encode(this.traceId?.toString() || ''),
      this.encode(this.segmentId?.toString() || ''),
      this.spanId?.toString(),
      this.encode(this.service || ''),
      this.encode(this.serviceInstance || ''),
      this.encode(this.endpoint || ''),
      this.encode(this.clientAddress || ''),
    ].join('-');
  }

  set value(val) {
    const parts = val.split('-');
    this.traceId = new ID(this.decode(parts[1]));
    this.segmentId = new ID(this.decode(parts[2]));
    this.spanId = Number.parseInt(parts[3], 10);
    this.service = this.decode(parts[4]);
    this.serviceInstance = this.decode(parts[5]);
    this.endpoint = this.decode(parts[6]);
    this.clientAddress = this.decode(parts[7]);
  }

  isValid(): boolean {
    return Boolean(
      this.traceId?.rawId &&
      this.segmentId?.rawId &&
      this.spanId !== undefined &&
      !isNaN(this.spanId) &&
      this.service &&
      this.endpoint &&
      this.clientAddress
    );
  }

  public static from(map: { [key: string]: string }): ContextCarrier | undefined {
    if (!map.hasOwnProperty('sw8'))
      return;

    const carrier = new ContextCarrier();

    carrier.items.filter((item) => map.hasOwnProperty(item.key)).forEach((item) => (item.value = map[item.key]));

    return carrier;
  }
}
