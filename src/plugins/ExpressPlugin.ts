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

import SwPlugin from '../core/SwPlugin';
import { IncomingMessage, ServerResponse } from 'http';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../trace/context/ContextCarrier';
import PluginInstaller from '../core/PluginInstaller';

class ExpressPlugin implements SwPlugin {
  readonly module = 'express';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    this.interceptServerRequest(installer);
  }

  private interceptServerRequest(installer: PluginInstaller) {
    const router = installer.require('express/lib/router');
    const onFinished = installer.require('on-finished');
    const _handle = router.handle;

    router.handle = function(req: IncomingMessage, res: ServerResponse, out: any) {
      const headers = req.rawHeaders || [];
      const headersMap: { [key: string]: string } = {};

      for (let i = 0; i < headers.length / 2; i += 2) {
        headersMap[headers[i]] = headers[i + 1];
      }

      const carrier = ContextCarrier.from(headersMap);
      const operation = (req.url || '/').replace(/\?.*/g, '');
      const span = ContextManager.current.newEntrySpan(operation, carrier, Component.HTTP_SERVER).start();

      let stopped = 0;
      const stopIfNotStopped = (err: Error | null) => {
        if (!stopped++) {
          span.stop();
          span.tag(Tag.httpStatusCode(res.statusCode));
          if (res.statusCode && res.statusCode >= 400) {
            span.errored = true;
          }
          if (err instanceof Error) {
            span.error(err);
          }
          if (res.statusMessage) {
            span.tag(Tag.httpStatusMsg(res.statusMessage));
          }
        }
      };

      try {
        span.layer = SpanLayer.HTTP;
        span.component = Component.EXPRESS;
        span.peer =
          (typeof req.headers['x-forwarded-for'] === 'string' && req.headers['x-forwarded-for'].split(',').shift())
          || (req.connection.remoteFamily === 'IPv6'
            ? `[${req.connection.remoteAddress}]:${req.connection.remotePort}`
            : `${req.connection.remoteAddress}:${req.connection.remotePort}`);
        span.tag(Tag.httpMethod(req.method));

        const ret = _handle.call(this, req, res, (err: Error) => {
          if (err) {
            span.error(err);
          } else {
            span.errored = true;
          }
          out.call(this, err);
          stopped -= 1;  // skip first stop attempt, make sure stop executes once status code and message is set
          onFinished(res, stopIfNotStopped);  // this must run after any handlers deferred in 'out'
        });
        onFinished(res, stopIfNotStopped); // this must run after any handlers deferred in 'out'

        return ret;
      } catch (e) {
        stopIfNotStopped(e);
        throw e;
      } finally {  // req.protocol is only possibly available after call to _handle()
        span.tag(Tag.httpURL(((req as any).protocol ? (req as any).protocol + '://' : '') + (req.headers.host || '') + req.url));
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new ExpressPlugin();
