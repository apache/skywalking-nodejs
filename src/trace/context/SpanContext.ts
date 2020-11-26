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
import Segment from '../../trace/context/Segment';
import EntrySpan from '../../trace/span/EntrySpan';
import ExitSpan from '../../trace/span/ExitSpan';
import LocalSpan from '../../trace/span/LocalSpan';
import buffer from '../../agent/Buffer';
import { createLogger } from '../../logging';
import { executionAsyncId } from 'async_hooks';
import Snapshot from '../../trace/context/Snapshot';
import SegmentRef from '../../trace/context/SegmentRef';
import { ContextCarrier } from './ContextCarrier';

const logger = createLogger(__filename);

export default class SpanContext implements Context {
  spanId = 0;
  spans: Span[] = [];
  segment: Segment = new Segment();
  asyncCount: number = 0;

  get parent(): Span | null {
    if (this.spans.length > 0) {
      return this.spans[this.spans.length - 1];
    }
    return null;
  }

  get parentId(): number {
    return this.parent ? this.parent.id : -1;
  }

  newEntrySpan(operation: string, carrier?: ContextCarrier): Span {
    if (logger.isDebugEnabled()) {
      logger.debug('Creating entry span', {
        parentId: this.parentId,
        executionAsyncId: executionAsyncId(),
      });
    }

    const span = new EntrySpan({
      id: this.spanId++,
      parentId: this.parentId,
      context: this,
      operation,
    });

    if (carrier && carrier.isValid()) {
      span.inject(carrier);
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

    return new ExitSpan({
      id: this.spanId++,
      parentId: this.parentId,
      context: this,
      peer,
      operation,
    });
  }

  newLocalSpan(operation: string): Span {
    if (logger.isDebugEnabled()) {
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
    if (this.spans.every((s) => s.id !== span.id)) {
      this.spans.push(span);
    }

    return this;
  }

  stop(span: Span): boolean {
    logger.info('Stopping span', { span, spans: this.spans });

    if (this.tryFinish(span)) {
      this.spans.splice(this.spans.length - 1, 1);
    }

    return this.asyncCount === 0 && this.spans.length === 0;
  }

  tryFinish(span: Span): boolean {
    if (span.finish(this.segment) && !span.isAsync) {
      if (logger.isDebugEnabled()) {
        logger.debug('Finishing span', { span });
      }
      buffer.put(this.segment);
      return true;
    }
    return false;
  }

  currentSpan(): Span | undefined {
    return this.spans[this.spans.length - 1];
  }

  capture(): Snapshot {
    return {
      segmentId: this.segment.segmentId,
      spanId: this.currentSpan()?.id ?? -1,
      traceId: this.segment.relatedTraces[0],
      parentEndpoint: this.spans[0].operation,
    };
  }

  restore(snapshot: Snapshot) {
    const ref = SegmentRef.fromSnapshot(snapshot);
    this.segment.refer(ref);
    this.currentSpan()?.refer(ref);
    this.segment.relate(ref.traceId);
  }

  async(span: Span) {
    this.asyncCount++;
    this.spans.splice(this.spans.indexOf(span), 1);
  }

  await(span: Span) {
    this.asyncCount--;
  }
}
