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

import async_hooks from 'async_hooks';

type AsyncState = { context: Context, spans: Span[], valid: boolean };

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
    // since `AsyncLocalStorage.getStore` may get previous state, see issue https://github.com/nodejs/node/issues/35286#issuecomment-697207158, so recreate when asyncState is not valid
    // Necessary because span may "finish()" in a child async task of where the asyncState was actually created and so clearing in the child would not clear in parent and invalid asyncState would be reused in new children of that parent.
    let asyncState = store.getStore();
    if (!asyncState?.valid) {
      asyncState = { context: new SpanContext(), spans: [], valid: true };
      store.enterWith(asyncState);
    }

    return asyncState;
  }

  get hasContext(): boolean | undefined {
    return store.getStore()?.valid;
  }

  get current(): Context {
    return this.asyncState.context;
  }

  get spans(): Span[] {
    return this.asyncState.spans;
  }

  spansDup(): Span[] {
    let asyncState = store.getStore();

    if (!asyncState?.valid) {
      asyncState = { context: new SpanContext(), spans: [], valid: true };
    } else {
      asyncState = { context: asyncState.context, spans: [...asyncState.spans], valid: asyncState.valid };
    }

    store.enterWith(asyncState);

    return asyncState.spans;
  }

  clear(): void {
    this.asyncState.valid = false;
    store.enterWith(undefined as unknown as AsyncState);
  }

  restore(context: Context, spans: Span[]): void {
    store.enterWith({ context, spans: spans || [], valid: this.asyncState.valid });
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
