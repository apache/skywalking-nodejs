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

import StackedSpan from '@/trace/span/StackedSpan';
import { Component } from '@/trace/Component';
import { SpanCtorOptions } from '@/trace/span/Span';
import { ContextCarrier } from '@/trace/context/Carrier';
import SegmentRef from '@/trace/context/SegmentRef';
import { SpanLayer, SpanType } from '@/proto/language-agent/Tracing_pb';

export default class EntrySpan extends StackedSpan {
  maxDepth = 0;

  constructor(options: SpanCtorOptions) {
    super(Object.assign(options, {
      type: SpanType.ENTRY,
    }));
  }

  start(): this {
    this.maxDepth = ++this.depth;
    if (this.maxDepth === 1) {
      super.start();
    }
    this.layer = SpanLayer.UNKNOWN;
    this.component = Component.UNKNOWN;
    this.logs.splice(0, this.logs.length);
    this.tags.splice(0, this.tags.length);
    return this;
  }

  extract(carrier: ContextCarrier): this {
    super.extract(carrier);

    const ref = SegmentRef.fromCarrier(carrier);

    if (!this.refs.includes(ref)) {
      this.refs.push(ref);
    }

    return this;
  }
}
