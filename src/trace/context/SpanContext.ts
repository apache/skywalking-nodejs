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

import Context from '@/trace/context/Context';
import { ContextCarrier } from '@/trace/context/Carrier';
import Span from '@/trace/span/Span';
import Segment from '@/trace/context/Segment';
import EntrySpan from '@/trace/span/EntrySpan';
import ExitSpan from '@/trace/span/ExitSpan';
import LocalSpan from '@/trace/span/LocalSpan';
import * as assert from 'assert';
import buffer from '@/agent/Buffer';
import { createLogger } from '@/logging';

const logger = createLogger('SpanContext');

export default class SpanContext implements Context {
  spanId = 0;
  spans: Span[] = [];
  segment: Segment = new Segment();

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
    logger.debug('Creating entry span', { parentId: this.parentId });
    return new EntrySpan({
      id: this.spanId++,
      parentId: this.parentId,
      context: this,
      operation,
    });
  }

  newExitSpan(operation: string, peer: string, carrier?: ContextCarrier): Span {
    return new ExitSpan({
      id: this.spanId++,
      parentId: this.parentId,
      context: this,
      operation,
    });
  }

  newLocalSpan(operation: string): Span {
    return new LocalSpan({
      id: this.spanId++,
      parentId: this.parentId,
      context: this,
      operation,
    });
  }

  start(span: Span): Context {
    if (!this.spans.includes(span)) {
      this.spans.push(span);
    }

    return this;
  }

  stop(span: Span): boolean {
    logger.info('Stopping span', { span, spans: this.spans });

    assert(this.spans[this.spans.length - 1] === span);

    if (span.finish(this.segment)) {
      logger.debug('Finishing span', { span });
      this.spans.pop();
      buffer.put(this.segment);
    }

    return this.spans.length === 0;
  }
}
