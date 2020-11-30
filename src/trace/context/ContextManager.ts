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
import SpanContext from '../../trace/context/SpanContext';
import { AsyncLocalStorage } from 'async_hooks';

type AsyncState = {context: Context, spans: Span[]};

const store = new AsyncLocalStorage<AsyncState>();

class ContextManager {
  get asyncState(): AsyncState {
    let asyncState = store.getStore();

    if (asyncState === undefined) {
      asyncState = {context: new SpanContext(), spans: []};
      store.enterWith(asyncState);
    }

    return asyncState;
  }

  get current(): Context { return this.asyncState.context; }
  get spans(): Span[] { return this.asyncState.spans; }

  spansDup(): Span[] {
    let asyncState = store.getStore();

    if (asyncState === undefined) {
      asyncState = {context: new SpanContext(), spans: []};
    } else {
      asyncState = {context: asyncState.context, spans: [...asyncState.spans]};
    }

    store.enterWith(asyncState);

    return asyncState.spans;
  }

  clear(): void {
    store.enterWith(undefined as unknown as AsyncState);
  }

  restore(context: Context, spans: Span[]): void {
    store.enterWith({context, spans: spans || []});
  }

  withSpan(span: Span, callback: (...args: any[]) => any, ...args: any[]): any {
    if(!span.startTime)
      span.start();

    try {
      return callback(span, ...args);
    } catch (e) {
      span.error(e);
      throw e;
    } finally {
      span.stop();
    }
  }

  withSpanNoStop(span: Span, callback: (...args: any[]) => any, ...args: any[]): any {
    if(!span.startTime)
      span.start();

    try {
      return callback(span, ...args);
    } catch (e) {
      span.error(e);
      span.stop();
      throw e;
    }
  }
}

export default new ContextManager();
