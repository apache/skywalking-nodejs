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
import EntrySpan from '../trace/span/EntrySpan';
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
    const _handle = router.handle;

    router.handle = function(req: IncomingMessage, res: ServerResponse, next: any) {
      const carrier = ContextCarrier.from((req as any).headers || {});
      const operation = (req.url || '/').replace(/\?.*/g, '');
      const span: EntrySpan = ContextManager.current.newEntrySpan(operation, carrier, Component.HTTP_SERVER) as EntrySpan;

      span.component = Component.EXPRESS;

      if (span.depth)  // if we inherited from http then just change component ID and let http do the work
        return _handle.apply(this, arguments);

      // all the rest of this code is only needed to make express tracing work if the http plugin is disabled

      let copyStatusErrorAndStopIfNotStopped = (err: Error | undefined) => {
        copyStatusErrorAndStopIfNotStopped = () => undefined;

        span.tag(Tag.httpStatusCode(res.statusCode));

        if (res.statusCode && res.statusCode >= 400)
          span.errored = true;

        if (res.statusMessage)
          span.tag(Tag.httpStatusMsg(res.statusMessage));

        if (err instanceof Error)
          span.error(err);

        span.stop();
      };

      span.start();

      try {
        span.layer = SpanLayer.HTTP;
        span.peer =
          (typeof req.headers['x-forwarded-for'] === 'string' && req.headers['x-forwarded-for'].split(',').shift())
          || (req.connection.remoteFamily === 'IPv6'
            ? `[${req.connection.remoteAddress}]:${req.connection.remotePort}`
            : `${req.connection.remoteAddress}:${req.connection.remotePort}`);

        span.tag(Tag.httpMethod(req.method));

        const ret = _handle.call(this, req, res, (err: Error) => {
          span.error(err);
          next.call(this, err);
        });

        if (process.version < 'v12')
          req.on('end', copyStatusErrorAndStopIfNotStopped);  // this insead of req or res.close because Node 10 doesn't emit those
        else
          res.on('close', copyStatusErrorAndStopIfNotStopped);  // this works better

        span.async();

        return ret;

      } catch (err) {
        copyStatusErrorAndStopIfNotStopped(err);

        throw err;

      } finally {  // req.protocol is only possibly available after call to _handle()
        span.tag(Tag.httpURL(((req as any).protocol ? (req as any).protocol + '://' : '') + (req.headers.host || '') + req.url));
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new ExpressPlugin();
