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
import SpanContext from '../../trace/context/SpanContext';
import DummyContext from '../../trace/context/DummyContext';

import async_hooks from 'async_hooks';

type AsyncState = { spans: Span[] };

let store: {
  getStore(): AsyncState | undefined;
  enterWith(s: AsyncState): void;
};

if (async_hooks.AsyncLocalStorage) {
  store = new async_hooks.AsyncLocalStorage();
} else {  // Node 10 doesn't have AsyncLocalStore, so recreate it
  const executionAsyncId = async_hooks.executionAsyncId;
  const asyncLocalStore: { [index: string]: any } = {};

  store = {
    getStore(): AsyncState | undefined {
      return asyncLocalStore[executionAsyncId()] as unknown as AsyncState;
    },

    enterWith(s: AsyncState): void {
      asyncLocalStore[executionAsyncId()] = s;
    },
  };

  async_hooks.createHook({
    init(asyncId: number, type: string, triggerId: number) {
      asyncLocalStore[asyncId] = asyncLocalStore[triggerId];
    },
    destroy(asyncId: number) {
      delete asyncLocalStore[asyncId];
    },
  }).enable();
}

class ContextManager {
  get asyncState(): AsyncState {
    let asyncState = store.getStore();

    if (!asyncState) {
      asyncState = { spans: [] };
      store.enterWith(asyncState);
    }

    return asyncState;
  }

  get currentSpan(): Span {
    const spans = store.getStore()?.spans;

    return spans?.[spans.length - 1] as Span;
  };

  get hasContext(): boolean | undefined {
    return Boolean(store.getStore()?.spans.length);
  }

  get current(): Context {
    const asyncState = this.asyncState;

    if (asyncState.spans.length)
      return asyncState.spans[asyncState.spans.length - 1].context;

    if (SpanContext.nActiveSegments < config.maxBufferSize)
      return new SpanContext();

    return new DummyContext();
  }

  get spans(): Span[] {
    return this.asyncState.spans;
  }

  spansDup(): Span[] {
    let asyncState = store.getStore();

    if (!asyncState) {
      asyncState = { spans: [] };
    } else {
      asyncState = { spans: [...asyncState.spans] };
    }

    store.enterWith(asyncState);

    return asyncState.spans;
  }

  clear(span: Span): void {
    const spans = this.spansDup();  // this needed to make sure async tasks created before this call will still have this span at the top of their span list
    const idx = spans.indexOf(span);

    if (idx !== -1)
      spans.splice(idx, 1);
  }

  restore(span: Span): void {
    const spans = this.spansDup();

    if (spans.indexOf(span) === -1)
      spans.push(span);
  }

  withSpan(span: Span, callback: (...args: any[]) => any, ...args: any[]): any {
    if (!span.startTime)
      span.start();
    try {
      return callback(...args);
    } catch (e) {
      span.error(e);
      throw e;
    } finally {
      span.stop();
    }
  }

  async withSpanAwait(span: Span, callback: (...args: any[]) => any, ...args: any[]): Promise<any> {
    if (!span.startTime)
      span.start();
    try {
      return await callback(...args);
    } catch (e) {
      span.error(e);
      throw e;
    } finally {
      span.stop();
    }
  }
}

export default new ContextManager();
