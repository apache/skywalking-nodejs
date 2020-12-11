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

import config from '../../config/AgentConfig';
import Context from '../../trace/context/Context';
import DummyContext from '../../trace/context/DummyContext';
import Span from '../../trace/span/Span';
import DummySpan from '../../trace/span/DummySpan';
import Segment from '../../trace/context/Segment';
import EntrySpan from '../../trace/span/EntrySpan';
import ExitSpan from '../../trace/span/ExitSpan';
import LocalSpan from '../../trace/span/LocalSpan';
import buffer from '../../agent/Buffer';
import { createLogger } from '../../logging';
import { executionAsyncId } from 'async_hooks';
import { ContextCarrier } from './ContextCarrier';
import ContextManager from './ContextManager';
import { SpanType } from '../../proto/language-agent/Tracing_pb';

const logger = createLogger(__filename);

export default class SpanContext implements Context {
  spanId = 0;
  nSpans = 0;
  segment: Segment = new Segment();

  get parent(): Span | null {
    if (ContextManager.spans.length > 0) {
      return ContextManager.spans[ContextManager.spans.length - 1];
    }
    return null;
  }

  get parentId(): number {
    return this.parent ? this.parent.id : -1;
  }

  ignoreCheck(operation: string, type: SpanType): Span | undefined {
    if (operation.match(config.reIgnoreOperation)) {
      return new DummySpan({
        context: new DummyContext(),
        operation: '',
        type,
      });
    }

    return undefined;
  }

  newEntrySpan(operation: string, carrier?: ContextCarrier): Span {
    if (logger.isDebugEnabled()) {
      logger.debug('Creating entry span', {
        parentId: this.parentId,
        executionAsyncId: executionAsyncId(),
      });
    }

    let span = this.ignoreCheck(operation, SpanType.ENTRY);

    if (span)
      return span;

    const spans = ContextManager.spansDup();
    const parent = spans[spans.length - 1];

    if (parent && parent.type === SpanType.ENTRY) {
      span = parent;
      parent.operation = operation;

    } else {
      span = new EntrySpan({
        id: this.spanId++,
        parentId: this.parentId,
        context: this,
        operation,
      });

      if (carrier && carrier.isValid()) {
        span.extract(carrier);
      }
    }

    return span;
  }

  newExitSpan(operation: string, peer: string): Span {
    if (logger.isDebugEnabled()) {
      logger.debug('Creating exit span', {
        parentId: this.parentId,
        executionAsyncId: executionAsyncId(),
      });
    }

    let span = this.ignoreCheck(operation, SpanType.EXIT);

    if (span)
      return span;

    const spans = ContextManager.spansDup();
    const parent = spans[spans.length - 1];

    if (parent && parent.type === SpanType.EXIT) {
      span = parent;

    } else {
      span = new ExitSpan({
        id: this.spanId++,
        parentId: this.parentId,
        context: this,
        peer,
        operation,
      });
    }

    return span;
  }

  newLocalSpan(operation: string): Span {
    if (logger.isDebugEnabled()) {
      logger.debug('Creating local span', {
        parentId: this.parentId,
        executionAsyncId: executionAsyncId(),
      });
    }

    const span = this.ignoreCheck(operation, SpanType.LOCAL);

    if (span)
      return span;

    ContextManager.spansDup();

    return new LocalSpan({
      id: this.spanId++,
      parentId: this.parentId,
      context: this,
      operation,
    });
  }

  start(span: Span): Context {
    logger.debug('Starting span', { span: span.operation, spans: ContextManager.spans, nSpans: this.nSpans });

    this.nSpans += 1;
    if (ContextManager.spans.every((s) => s.id !== span.id)) {
      ContextManager.spans.push(span);
    }

    return this;
  }

  stop(span: Span): boolean {
    logger.debug('Stopping span', { span: span.operation, spans: ContextManager.spans, nSpans: this.nSpans });

    span.finish(this.segment);

    const idx = ContextManager.spans.indexOf(span);
    if (idx !== -1) {
      ContextManager.spans.splice(idx, 1);
    }

    if (--this.nSpans === 0) {
      buffer.put(this.segment);
      ContextManager.clear();
      return true;
    }

    return false;
  }

  async(span: Span) {
    logger.debug('Async span', { span: span.operation, spans: ContextManager.spans, nSpans: this.nSpans });

    const idx = ContextManager.spans.indexOf(span);

    if (idx !== -1) {
      ContextManager.spans.splice(idx, 1);
    }

    if (this.nSpans === 1) {  // this will pass the context to child async task so it doesn't mess with other tasks here
      ContextManager.clear();
    }
  }

  resync(span: Span) {
    logger.debug('Resync span', { span: span.operation, spans: ContextManager.spans, nSpans: this.nSpans });

    if ((span.context as SpanContext).nSpans === 1) {
      ContextManager.restore(span.context, [span]);
    } else if (ContextManager.spans.every((s) => s.id !== span.id)) {
      ContextManager.spans.push(span);
    }
  }

  currentSpan(): Span | undefined {
    return ContextManager.spans[ContextManager.spans.length - 1];
  }
}
