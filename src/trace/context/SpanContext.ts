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
import SegmentRef from './SegmentRef';
import ContextManager from './ContextManager';
import Tag from '../../Tag';
import { Component } from '../Component';
import { createLogger } from '../../logging';
import { ContextCarrier } from './ContextCarrier';
import { SpanType } from '../../proto/language-agent/Tracing_pb';
import { emitter } from '../../lib/EventEmitter';

const logger = createLogger(__filename);

emitter.on('segments-sent', () => {
  SpanContext.nActiveSegments = 0;  // reset limiter
});

export default class SpanContext implements Context {
  static nActiveSegments = 0;  // counter to allow only config.maxBufferSize active (non-dummy) segments per reporting frame
  spanId = 0;
  nSpans = 0;
  finished = false;
  segment: Segment = new Segment();

  ignoreCheck(operation: string, type: SpanType, carrier?: ContextCarrier): Span | undefined {
    if (operation.match(config.reIgnoreOperation) || (carrier && !carrier.isValid()))
      return DummySpan.create();

    return undefined;
  }

  spanCheck(spanType: SpanType, operation: string, carrier?: ContextCarrier): [Span | null, Span?] {
    const span = this.ignoreCheck(operation, SpanType.ENTRY, carrier);

    if (span)
      return [span];

    const spans = ContextManager.spans;
    const parent = spans[spans.length - 1];

    if (parent instanceof DummySpan)
      return [parent];

    return [null, parent];
  }

  newSpan(spanClass: typeof EntrySpan | typeof ExitSpan | typeof LocalSpan, parent: Span, operation: string): Span {
    const context = !this.finished ? this : new SpanContext();

    const span = new spanClass({
      id: context.spanId++,
      parentId: this.finished ? -1 : parent?.id ?? -1,
      context,
      operation,
    });

    if (this.finished && parent) {  // segment has already been closed and sent to server, if there is a parent span then need new segment to reference
      const carrier = new ContextCarrier(
        parent.context.segment.relatedTraces[0],
        parent.context.segment.segmentId,
        parent.id,
        config.serviceName,
        config.serviceInstance,
        parent.operation,
        parent.peer,
        [],
      );

      const ref = SegmentRef.fromCarrier(carrier);

      context.segment.relate(carrier.traceId!);
      span.refer(ref);
    }

    return span;
  }

  newEntrySpan(operation: string, carrier?: ContextCarrier, inherit?: Component): Span {
    // tslint:disable-next-line:prefer-const
    let [span, parent] = this.spanCheck(SpanType.ENTRY, operation, carrier);

    if (span)
      return span;

    if (logger._isDebugEnabled) {
      logger.debug('Creating entry span', {
        parent,
      });
    }

    if (!this.finished && parent?.type === SpanType.ENTRY && inherit && inherit === parent.component) {
      span = parent;
      parent.operation = operation;

    } else {
      span = this.newSpan(EntrySpan, parent!, operation);

      if (carrier && carrier.isValid())
        span.extract(carrier);
    }

    return span;
  }

  newExitSpan(operation: string, component: Component, inherit?: Component): Span {
    // tslint:disable-next-line:prefer-const
    let [span, parent] = this.spanCheck(SpanType.EXIT, operation);

    if (span)
      return span;

    if (logger._isDebugEnabled) {
      logger.debug('Creating exit span', {
        operation,
        parent,
      });
    }

    if (!this.finished && parent?.type === SpanType.EXIT && component === parent.inherit)
      span = parent;
    else
      span = this.newSpan(ExitSpan, parent!, operation);

    if (inherit)
      span.inherit = inherit;

    return span;
  }

  newLocalSpan(operation: string): Span {
    const [span, parent] = this.spanCheck(SpanType.LOCAL, operation);

    if (span)
      return span;

    if (logger._isDebugEnabled) {
      logger.debug('Creating local span', {
        parentId: parent?.id ?? -1,
      });
    }

    return this.newSpan(LocalSpan, parent!, operation);
  }

  start(span: Span): Context {
    const spans = ContextManager.spansDup();

    logger.debug(`Starting span ${span.operation}`, {
      span,
      spans,
      nSpans: this.nSpans,
    });

    if (!this.nSpans++) {
      SpanContext.nActiveSegments += 1;
      span.isCold = ContextManager.checkCold();

      if (span.isCold)
        span.tag(Tag.coldStart(), true);
    }

    if (spans.indexOf(span) === -1)
      spans.push(span);

    return this;
  }

  stop(span: Span): boolean {
    logger.debug(`Stopping span ${span.operation}`, {
      span,
      spans: ContextManager.spans,
      nSpans: this.nSpans,
    });

    span.finish(this.segment);
    ContextManager.clear(span);

    if (--this.nSpans === 0) {
      this.finished = true;

      emitter.emit('segment-finished', this.segment);

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

    ContextManager.clear(span);
  }

  resync(span: Span) {
    logger.debug(`Resync span ${span.operation}`, {
      span,
      spans: ContextManager.spans,
      nSpans: this.nSpans,
    });

    ContextManager.restore(span);
  }

  traceId(): string {
    if (!this.segment.relatedTraces) {
      return 'N/A';
    }
    return this.segment.relatedTraces[0].toString();
  }
}
