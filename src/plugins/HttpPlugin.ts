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

import SwPlugin, {wrapEmit} from '../core/SwPlugin';
import { URL } from 'url';
import { ClientRequest, IncomingMessage, RequestOptions, ServerResponse } from 'http';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import Span from '../trace/span/Span';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../trace/context/ContextCarrier';
import DummySpan from '../trace/span/DummySpan';
import { ignoreHttpMethodCheck } from '../config/AgentConfig';

class HttpPlugin implements SwPlugin {
  readonly module = 'http';
  readonly versions = '*';

  install(): void {
    const http = require('http');
    const https = require('https');

    this.interceptClientRequest(http, 'http');
    this.interceptServerRequest(http, 'http');
    this.interceptClientRequest(https, 'https');
    this.interceptServerRequest(https, 'https');
  }

  private interceptClientRequest(module: any, protocol: string) {
    const _request = module.request;  // BUG! this doesn't work with "import {request} from http", but haven't found an alternative yet

    module.request = function () {
      const url: URL | string | RequestOptions = arguments[0];

      const { host, pathname } =
        url instanceof URL
          ? url
          : typeof url === 'string'
          ? new URL(url)  // TODO: this may throw invalid URL
          : {
            host: (url.host || url.hostname || 'unknown') + ':' + (url.port || 80),
            pathname: url.path || '/',
          };

      const operation = pathname.replace(/\?.*$/g, '');
      const method = arguments[url instanceof URL || typeof url === 'string' ? 1 : 0]?.method || 'GET';
      const span = ignoreHttpMethodCheck(method)
        ? DummySpan.create()
        : ContextManager.current.newExitSpan(operation, host, Component.HTTP);

      if ((span as any).depth)  // if we inherited from a higher level plugin then do nothing, higher level should do all the work and we don't duplicate here
        return _request.apply(this, arguments);

      span.start();

      try {
        span.component = Component.HTTP;
        span.layer = SpanLayer.HTTP;
        span.peer = host;

        span.tag(Tag.httpURL(protocol + '://' + host + pathname));
        span.tag(Tag.httpMethod(method));

        const copyStatusAndWrapEmit = (res: any) => {
          span.tag(Tag.httpStatusCode(res.statusCode));

          if (res.statusCode && res.statusCode >= 400)
            span.errored = true;

          if (res.statusMessage)
            span.tag(Tag.httpStatusMsg(res.statusMessage));

            wrapEmit(span, res, false);
        };

        const responseCB = function(this: any, res: any) {  // may wrap callback instead of event because it procs first
          span.resync();

          copyStatusAndWrapEmit(res);

          try {
            if (callback)
              return callback.apply(this, arguments);

          } catch (err) {
            span.error(err);

            throw err;

          } finally {
            span.async();
          }
        };

        const idxCallback = typeof arguments[2] === 'function' ? 2 : typeof arguments[1] === 'function' ? 1 : 0;
        const callback    = arguments[idxCallback];

        if (idxCallback)
          arguments[idxCallback] = responseCB;

        const req: ClientRequest = _request.apply(this, arguments);

        span.inject().items.forEach((item) => req.setHeader(item.key, item.value));

        wrapEmit(span, req, true, 'close');

        req.on('timeout', () => span.log('Timeout', true));
        req.on('abort', () => span.log('Abort', span.errored = true));

        if (!idxCallback)
          req.on('response', copyStatusAndWrapEmit);

        span.async();

        return req;

      } catch (err) {
        span.error(err);
        span.stop();

        throw err;
      }
    };
  }

  private interceptServerRequest(module: any, protocol: string) {
    const plugin = this;
    const _addListener = module.Server.prototype.addListener;  // TODO? full event protocol support not currently implemented (prependListener(), removeListener(), etc...)

    module.Server.prototype.addListener = module.Server.prototype.on = function (event: any, handler: any, ...addArgs: any[]) {
      return _addListener.call(this, event, event === 'request' ? _sw_request : handler, ...addArgs);

      function _sw_request(this: any, req: IncomingMessage, res: ServerResponse, ...reqArgs: any[]) {
        const carrier = ContextCarrier.from((req as any).headers || {});
        const operation = (req.url || '/').replace(/\?.*/g, '');
        const span = ignoreHttpMethodCheck(req.method ?? 'GET')
          ? DummySpan.create()
          : ContextManager.current.newEntrySpan(operation, carrier);

        span.component = Component.HTTP_SERVER;

        span.tag(Tag.httpURL(protocol + '://' + (req.headers.host || '') + req.url));

        return plugin.wrapHttpResponse(span, req, res, () => handler.call(this, req, res, ...reqArgs));
      }
    };
  }

  wrapHttpResponse(span: Span, req: IncomingMessage, res: ServerResponse, handler: any): any {
    span.start();

    try {
      span.layer = SpanLayer.HTTP;
      span.peer =
        (typeof req.headers['x-forwarded-for'] === 'string' && req.headers['x-forwarded-for'].split(',').shift())
        || (req.connection.remoteFamily === 'IPv6'
          ? `[${req.connection.remoteAddress}]:${req.connection.remotePort}`
          : `${req.connection.remoteAddress}:${req.connection.remotePort}`);

      span.tag(Tag.httpMethod(req.method ?? 'GET'));

      const ret = handler();

      const stopper = (stopEvent: any) => {
        const stop = (emittedEvent: any) => {
          if (emittedEvent === stopEvent) {
            span.tag(Tag.httpStatusCode(res.statusCode));

            if (res.statusCode && res.statusCode >= 400)
              span.errored = true;

            if (res.statusMessage)
              span.tag(Tag.httpStatusMsg(res.statusMessage));

            return true;
          }
        };

        return stop;
      };

      const isSub12 = process.version < 'v12';

      wrapEmit(span, req, true, isSub12 ? stopper('end') : NaN);
      wrapEmit(span, res, true, isSub12 ? NaN : stopper('close'));

      span.async();

      return ret;

    } catch (err) {
      span.error(err);
      span.stop();

      throw err;
    }
  }
}

// noinspection JSUnusedGlobalSymbols
export default new HttpPlugin();
