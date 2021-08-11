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
import { Component } from '../Component';
import { ContextCarrier } from './ContextCarrier';
import ContextManager from './ContextManager';

export default class DummyContext implements Context {
  segment: Segment = new Segment();
  nSpans = 0;
  finished = false;

  newEntrySpan(operation: string, carrier?: ContextCarrier, inherit?: Component): Span {
    return DummySpan.create(this);
  }

  newExitSpan(operation: string, component: Component, inherit?: Component): Span {
    return DummySpan.create(this);
  }

  newLocalSpan(operation: string): Span {
    return DummySpan.create(this);
  }

  start(span: DummySpan): Context {
    const spans = ContextManager.spansDup();

    if (!this.nSpans++) {
      ContextManager.checkCold();  // set cold to false

      if (spans.indexOf(span) === -1)
        spans.push(span);
    }

    return this;
  }

  stop(span: DummySpan): boolean {
    if (--this.nSpans)
      return false;

    ContextManager.clear(span);

    return true;
  }

  async(span: DummySpan) {
    ContextManager.clear(span);
  }

  resync(span: DummySpan) {
    ContextManager.restore(span);
  }

  traceId(): string {
    if (!this.segment.relatedTraces) {
      return 'N/A';
    }
    return this.segment.relatedTraces[0].toString();
  }
}
