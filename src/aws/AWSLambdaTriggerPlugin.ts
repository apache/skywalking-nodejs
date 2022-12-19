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

import { performance } from 'perf_hooks';
import config from '../config/AgentConfig';
import { ContextCarrier, traceKey } from '../trace/context/ContextCarrier';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import Span from '../trace/span/Span';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { default as agent } from '../index';

let _lastTimestamp = -Infinity;

const KeyTrace = '__revdTraceId';
const KeyParams = '__revdParams'; // original params (if not originally an object)

class AWSLambdaTriggerPlugin {
  // default working start function, should be overridden by the various types of lambda trigger subclasses
  start(event: any, context: any): [Span, any] {
    let peer = 'Unknown';
    let carrier: ContextCarrier | undefined = undefined;

    if (event && typeof event === 'object') {
      // pull traceid out of params if it is in there
      let traceId = event[KeyTrace];

      if (traceId && typeof traceId === 'string') {
        const idx = traceId.lastIndexOf('/');

        if (idx !== -1) {
          peer = traceId.slice(idx + 1);
          traceId = traceId.slice(0, idx);
          carrier = ContextCarrier.from({ [traceKey]: traceId });

          if (carrier) {
            if (!carrier.isValid()) carrier = undefined;
            else {
              const params = event[KeyParams];

              if (params !== undefined) event = params;
              else delete event[KeyTrace];
            }
          }
        }
      }
    }

    const span = ContextManager.current.newEntrySpan('AWS/Lambda/' + (context.functionName || ''), carrier);

    span.component = Component.AWSLAMBDA_FUNCTION;
    span.peer = peer;

    span.start();

    return [span, event];
  }

  // default working stop function
  stop(span: Span, err: Error | null, res: any): void {
    span.stop();
  }

  wrap(func: any) {
    return async (event: any, context: any, callback: any) => {
      const ts = performance.now() / 1000;

      let done = async (err: Error | null, res?: any) => {
        done = async (err: Error | null, res?: any) => res;

        if (err) span.error(err);

        this.stop(span, err, res);

        if (config.awsLambdaFlush >= 0) {
          if (ts - _lastTimestamp >= config.awsLambdaFlush) {
            await new Promise((resolve) => setTimeout(resolve, 0)); // child spans of this span may have finalization waiting in the event loop in which case we give them a chance to run so that the segment can be archived properly for flushing

            const p = agent.flush(); // flush all data before aws freezes the process on exit

            if (p) await p;
          }

          _lastTimestamp = performance.now() / 1000;
        }

        return res;
      };

      let cbdone = (err: Error | null, res?: any): any => {
        // for the weird AWS done function behaviors
        cbdone = (err: Error | null, res?: any) => ({ finally: () => undefined });

        return done(err, res);
      };

      ContextManager.clearAll(); // need this because AWS seems to chain sequential independent operations linearly instead of hierarchically

      const _done = context.done;
      const [span, _event] = this.start(event, context);

      try {
        event = _event;
        span.layer = SpanLayer.HTTP;

        if (context.invokedFunctionArn) span.tag(Tag.arn(context.invokedFunctionArn));

        context.done = (err: Error | null, res: any) => {
          cbdone(err, res).finally(() => _done(err, res));
        };
        context.succeed = (res: any) => {
          cbdone(null, res).finally(() => _done(null, res));
        };
        context.fail = (err: Error | null) => {
          cbdone(err).finally(() => _done(err));
        };

        let ret = func(event, context, (err: Error | null, res: any) => {
          cbdone(err, res).finally(() => callback(err, res));
        });

        if (typeof ret?.then === 'function')
          // generic Promise check
          ret = await ret;

        return await done(null, ret);
      } catch (e) {
        await done(e, null);

        throw e;
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AWSLambdaTriggerPlugin();

export { AWSLambdaTriggerPlugin, KeyTrace, KeyParams };
