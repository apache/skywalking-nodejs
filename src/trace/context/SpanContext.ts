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
import Span from '../../trace/span/Span';
import DummySpan from '../../trace/span/DummySpan';
import Segment from '../../trace/context/Segment';
import EntrySpan from '../../trace/span/EntrySpan';
import ExitSpan from '../../trace/span/ExitSpan';
import LocalSpan from '../../trace/span/LocalSpan';
import { Component } from '../../trace/Component';
import { createLogger } from '../../logging';
import { executionAsyncId } from 'async_hooks';
import { ContextCarrier } from './ContextCarrier';
import ContextManager from './ContextManager';
import { SpanType } from '../../proto/language-agent/Tracing_pb';
import { emitter } from '../../lib/EventEmitter';

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
    if (operation.match(config.reIgnoreOperation))
      return DummySpan.create();

    return undefined;
  }

  newEntrySpan(operation: string, carrier?: ContextCarrier, inherit?: Component): Span {
    let span = this.ignoreCheck(operation, SpanType.ENTRY);

    if (span)
      return span;

    const spans = ContextManager.spansDup();
    const parent = spans[spans.length - 1];

    if (logger._isDebugEnabled) {
      logger.debug('Creating entry span', {
        spans,
        parent,
      });
    }

    if (parent && parent.type === SpanType.ENTRY && inherit && inherit === parent.component) {
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

  newExitSpan(operation: string, component: Component, inherit?: Component): Span {
    let span = this.ignoreCheck(operation, SpanType.EXIT);

    if (span)
      return span;

    const spans = ContextManager.spansDup();
    const parent = spans[spans.length - 1];

    if (logger._isDebugEnabled) {
      logger.debug('Creating exit span', {
        operation,
        parent,
        spans,
      });
    }

    if (parent && parent.type === SpanType.EXIT && component === parent.inherit) {
      span = parent;

    } else {
      span = new ExitSpan({
        id: this.spanId++,
        parentId: this.parentId,
        context: this,
        operation,
      });
    }

    if (inherit)
      span.inherit = inherit;

    return span;
  }

  newLocalSpan(operation: string): Span {
    const span = this.ignoreCheck(operation, SpanType.LOCAL);

    if (span)
      return span;

    ContextManager.spansDup();

    if (logger._isDebugEnabled) {
      logger.debug('Creating local span', {
        parentId: this.parentId,
        executionAsyncId: executionAsyncId(),
      });
    }

    return new LocalSpan({
      id: this.spanId++,
      parentId: this.parentId,
      context: this,
      operation,
    });
  }

  start(span: Span): Context {
    logger.debug(`Starting span ${span.operation}`, {
      span,
      spans: ContextManager.spans,
      nSpans: this.nSpans,
    });

    this.nSpans += 1;
    if (ContextManager.spans.every((s) => s.id !== span.id || s.context !== span.context)) {
      ContextManager.spans.push(span);
    }

    return this;
  }

  stop(span: Span): boolean {
    logger.debug(`Stopping span ${span.operation}`, {
      span,
      spans: ContextManager.spans,
      nSpans: this.nSpans,
    });

    span.finish(this.segment);

    const idx = ContextManager.spans.indexOf(span);
    if (idx !== -1) {
      ContextManager.spans.splice(idx, 1);
    }

    if (--this.nSpans === 0) {
      emitter.emit('segment-finished', this.segment);
      ContextManager.clear();
      return true;
    }

    return false;
  }

  async(span: Span) {
    logger.debug(`Async span ${span.operation}`, {
      span,
      spans: ContextManager.spans,
      nSpans: this.nSpans,
    });

    const spans = ContextManager.spansDup();  // this needed to make sure async tasks created before this call will still have this span at the top of their span list
    const idx = spans.indexOf(span);

    if (idx !== -1) {
      spans.splice(idx, 1);

      if (!spans.length) {  // this will pass the context to child async task so it doesn't mess with other tasks here
        ContextManager.clear();
      }
    }
  }

  resync(span: Span) {
    logger.debug(`Resync span ${span.operation}`, {
      span,
      spans: ContextManager.spans,
      nSpans: this.nSpans,
    });

    if (!ContextManager.hasContext || !ContextManager.spans.length) {
      ContextManager.restore(span.context, [span]);
    } else if (ContextManager.spans.every((s) => s.id !== span.id || s.context !== span.context)) {
      ContextManager.spans.push(span);
    }
  }
}
