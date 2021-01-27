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

import Context from '../../trace/context/Context';
import Span from '../../trace/span/Span';
import DummySpan from '../../trace/span/DummySpan';
import Segment from '../../trace/context/Segment';
import { SpanType } from '../../proto/language-agent/Tracing_pb';
import { ContextCarrier } from './ContextCarrier';

export default class DummyContext implements Context {
  span: Span = new DummySpan({
    context: this,
    operation: '',
    type: SpanType.LOCAL,
  });
  segment: Segment = new Segment();
  depth = 0;
  invalid = false;

  newEntrySpan(operation: string, carrier?: ContextCarrier): Span {
    return this.span;
  }

  newExitSpan(operation: string, peer: string): Span {
    return this.span;
  }

  newLocalSpan(operation: string): Span {
    return this.span;
  }

  start(): Context {
    this.depth++;
    return this;
  }

  stop(): boolean {
    return --this.depth === 0;
  }

  async(span: Span) {
    return;
  }

  resync(span: Span) {
    return;
  }

  currentSpan(): Span {
    throw new Error('DummyContext.currentSpan() should never be called!');
  }
}
