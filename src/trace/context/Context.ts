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

import Span from '../../trace/span/Span';
import Segment from '../../trace/context/Segment';
import { ContextCarrier } from './ContextCarrier';

export default interface Context {
  segment: Segment;

  invalid: boolean;

  newLocalSpan(operation: string): Span;

  newEntrySpan(operation: string, carrier?: ContextCarrier): Span;

  newExitSpan(operation: string, peer: string): Span;

  start(span: Span): Context;

  stop(span: Span): boolean;

  /* This should be called just before a span is passed to a different async context, like for example a callback from
     an asynchronous operation the code belonging to the span initiated. After this is called a span should only call
     .resync() or .stop(). See HttpPlugin.interceptClientRequest() in plugins/HttpPlugin.ts for example of usage. */
  async(span: Span): void;

  /* This should be called upon entering the new async context for a span that has previously executed .async(), it
     should be the first thing the callback function belonging to the span does. */
  resync(span: Span): void;

  currentSpan(): Span | undefined;
}
