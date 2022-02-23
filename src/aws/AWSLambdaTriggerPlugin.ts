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

import config from '../config/AgentConfig';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Span from '../trace/span/Span';
import { default as agent } from '../index';

class AWSLambdaTriggerPlugin {
  // default working start function, should be overridden by the various types of lambda trigger subclasses
  start(event: any, context: any): Span {
    const span = ContextManager.current.newEntrySpan(context.functionName ? `/${context.functionName}` : '/');

    span.component = Component.AWSLAMBDA_FUNCTION;
    span.peer = 'Unknown';

    span.start();

    return span;
  }

  // default working stop function
  stop(span: Span, err: Error | null, res: any): void {
    span.stop();
  }

  wrap(func: any) {
    return async (event: any, context: any, callback: any) => {
      ContextManager.removeTailFinishedContexts(); // need this because AWS seems to chain sequential independent operations linearly instead of hierarchically

      const span = this.start(event, context);
      let ret: any;

      let stop = async (err: Error | null, res: any) => {
        stop = async (err: Error | null, res: any) => {};

        this.stop(span, err, res);

        if (config.awsLambdaFlush) {
          const p = agent.flush(); // flush all data before aws freezes the process on exit

          if (p) await p;
        }

        return res;
      };

      let resolve: any;
      let reject: any;
      let callbackDone = false;

      const callbackPromise = new Promise((_resolve: any, _reject: any) => {
        resolve = _resolve;
        reject = _reject;
      });

      try {
        ret = func(event, context, (err: Error | null, res: any) => {
          if (!callbackDone) {
            callbackDone = true;

            if (err) reject(err);
            else resolve(res);
          }
        });

        if (typeof ret?.then !== 'function')
          // generic Promise check
          ret = callbackPromise;

        return await stop(null, await ret);
      } catch (e) {
        span.error(e);
        await stop(e, null);

        throw e;
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AWSLambdaTriggerPlugin();

export { AWSLambdaTriggerPlugin };
