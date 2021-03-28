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
import { Component } from '../../trace/Component';
import { ContextCarrier } from './ContextCarrier';

export default interface Context {
  segment: Segment;

  newLocalSpan(operation: string): Span;

  /* If 'inherit' is specified then if the span at the top of the stack is an Entry span of this component type then the
     span is reused instead of a new child span being created. This is intended for situations like an express handler
     inheriting an opened incoming http connection to present a single span. */
  newEntrySpan(operation: string, carrier?: ContextCarrier, inherit?: Component): Span;

  /* if 'inherit' is specified then the span returned is marked for inheritance by an Exit span component which is
     created later and calls this function with a matching 'component' value. For example Axios using an Http exit
     connection will be merged into a single exit span, see those plugins for how this is done. */
  newExitSpan(operation: string, peer: string, component: Component, inherit?: Component): Span;

  start(span: Span): Context;

  stop(span: Span): boolean;

  /* This should be called just before a span is passed to a different async context, like for example a callback from
     an asynchronous operation the code belonging to the span initiated. After this is called a span should only call
     .resync() or .stop(). See HttpPlugin.interceptClientRequest() in plugins/HttpPlugin.ts for example of usage. */
  async(span: Span): void;

  /* This should be called upon entering the new async context for a span that has previously executed .async(), it
     should be the first thing the callback function belonging to the span does. */
  resync(span: Span): void;
}
