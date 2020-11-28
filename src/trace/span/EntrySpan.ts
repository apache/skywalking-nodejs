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

import StackedSpan from '../../trace/span/StackedSpan';
import { Component } from '../Component';
import { SpanCtorOptions } from './Span';
import SegmentRef from '../../trace/context/SegmentRef';
import { SpanLayer, SpanType } from '../../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../context/ContextCarrier';

export default class EntrySpan extends StackedSpan {
  constructor(options: SpanCtorOptions) {
    super(
      Object.assign(options, {
        type: SpanType.ENTRY,
      }),
    );
  }

  start(): this {
    super.start();
    this.layer = SpanLayer.UNKNOWN;
    this.component = Component.UNKNOWN;
    this.logs.splice(0, this.logs.length);
    this.tags.splice(0, this.tags.length);
    return this;
  }

  inject(carrier: ContextCarrier): this {
    super.inject(carrier);

    const ref = SegmentRef.fromCarrier(carrier);

    if (!this.refs.includes(ref)) {
      this.refs.push(ref);
    }

    return this;
  }
}
