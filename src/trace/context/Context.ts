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

import Span from '@/trace/span/Span';
import Segment from '@/trace/context/Segment';
import Snapshot from '@/trace/context/Snapshot';
import { ContextCarrier } from '@/trace/context/ContextCarrier';

export default interface Context {
  segment: Segment;
  spans: Span[];

  newLocalSpan(operation: string): Span;

  newEntrySpan(operation: string, carrier?: ContextCarrier): Span;

  newExitSpan(operation: string, peer: string, carrier?: ContextCarrier): Span;

  start(span: Span): Context;

  stop(span: Span): boolean;

  currentSpan(): Span | undefined;

  capture(): Snapshot;

  restore(snapshot: Snapshot): void;
}
