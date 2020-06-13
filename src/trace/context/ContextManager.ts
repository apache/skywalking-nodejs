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
import SpanContext from '@/trace/context/SpanContext';
import { AsyncHook, createHook, executionAsyncId } from 'async_hooks';

class ContextManager {
  hooks: AsyncHook;
  scopeContext: Map<number, Context>;

  constructor() {
    this.scopeContext = new Map<number, Context>();

    this.scopeContext.set(1, new SpanContext());

    this.hooks = createHook({
      init: (asyncId: number, type: string, triggerAsyncId: number, resource: object) => {
        if (type === 'TIMERWRAP') {
          return;
        }
        const context = this.scopeContext.get(triggerAsyncId) || new SpanContext();
        this.scopeContext.set(asyncId, context);
      },
      destroy: (asyncId: number) => {
        this.scopeContext.delete(asyncId);
      },
    }).enable();
  }

  get currentContext(): Context {
    return this.scopeContext.get(executionAsyncId()) || new SpanContext();
  }
}

export default new ContextManager();
