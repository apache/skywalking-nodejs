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

import Span, { SpanCtorOptions } from '@/trace/span/Span';
import Segment from '@/trace/context/Segment';
import { createLogger } from '@/logging';
import { SpanType } from '@/proto/language-agent/Tracing_pb';

const logger = createLogger('StackedSpan');

export default class StackedSpan extends Span {
  depth = 0;

  constructor(options: SpanCtorOptions & { type: SpanType; }) {
    super(options);
  }

  finish(segment: Segment): boolean {
    logger.debug('Finishing span', this);
    return --this.depth === 0 && super.finish(segment);
  }
}
