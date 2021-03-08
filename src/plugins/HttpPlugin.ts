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
import { URL } from 'url';
import { ClientRequest, IncomingMessage, RequestOptions, ServerResponse } from 'http';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import ExitSpan from '../trace/span/ExitSpan';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../trace/context/ContextCarrier';

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

      const httpMethod = arguments[url instanceof URL || typeof url === 'string' ? 1 : 0]?.method || 'GET';
      const httpURL = protocol + '://' + host + pathname;
      const operation = pathname.replace(/\?.*$/g, '');

      const span: ExitSpan = ContextManager.current.newExitSpan(operation, host, Component.HTTP).start() as ExitSpan;

      try {
        if (span.depth === 1) {  // only set HTTP if this span is not overridden by a higher level one
          span.component = Component.HTTP;
          span.layer = SpanLayer.HTTP;
        }

        if (!span.peer)
          span.peer = host;

        if (!span.hasTag(Tag.httpURLKey))  // only set if a higher level plugin with more info did not already set
          span.tag(Tag.httpURL(httpURL));

        if (!span.hasTag(Tag.httpMethodKey))
          span.tag(Tag.httpMethod(httpMethod));

        const req: ClientRequest = _request.apply(this, arguments);

        span.inject().items.forEach((item) => req.setHeader(item.key, item.value));

        req.on('timeout', () => span.log('Timeout', true));
        req.on('abort', () => span.log('Abort', span.errored = true));
        req.on('error', (err) => span.error(err));

        const _emit = req.emit;

        req.emit = function(): any {
          const event = arguments[0];

          span.resync();

          try {
            if (event === 'response') {
              const res = arguments[1];

              span.tag(Tag.httpStatusCode(res.statusCode));

              if (res.statusCode && res.statusCode >= 400)
                span.errored = true;

              if (res.statusMessage)
                span.tag(Tag.httpStatusMsg(res.statusMessage));

              const _emitRes = res.emit;

              res.emit = function(): any {
                span.resync();

                try {
                  return _emitRes.apply(this, arguments);

                } catch (err) {
                  span.error(err);

                  throw err;

                } finally {
                  span.async();
                }
              }
            }

            return _emit.apply(this, arguments as any);

          } catch (err) {
            span.error(err);

            throw err;

          } finally {
            if (event === 'close')
              span.stop();
            else
              span.async();
          }
        };

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
    /// TODO? full event protocol support not currently implemented (prependListener(), removeListener(), etc...)
    const _addListener = module.Server.prototype.addListener;

    module.Server.prototype.addListener = module.Server.prototype.on = function (event: any, handler: any, ...addArgs: any[]) {
      return _addListener.call(this, event, event === 'request' ? _sw_request : handler, ...addArgs);

      function _sw_request(this: any, req: IncomingMessage, res: ServerResponse, ...reqArgs: any[]) {
        const headers = req.rawHeaders || [];
        const headersMap: { [key: string]: string } = {};

        for (let i = 0; i < headers.length / 2; i += 2)
          headersMap[headers[i]] = headers[i + 1];

        const carrier = ContextCarrier.from(headersMap);
        const operation = (req.url || '/').replace(/\?.*/g, '');
        const span = ContextManager.current.newEntrySpan(operation, carrier).start();

        try {
          span.component = Component.HTTP_SERVER;
          span.layer = SpanLayer.HTTP;
          span.peer =
            (typeof req.headers['x-forwarded-for'] === 'string' && req.headers['x-forwarded-for'].split(',').shift())
            || (req.connection.remoteFamily === 'IPv6'
              ? `[${req.connection.remoteAddress}]:${req.connection.remotePort}`
              : `${req.connection.remoteAddress}:${req.connection.remotePort}`);

          span.tag(Tag.httpURL(protocol + '://' + (req.headers.host || '') + req.url));
          span.tag(Tag.httpMethod(req.method));

          const ret = handler.call(this, req, res, ...reqArgs);

          let copyStatusAndStopIfNotStopped = () => {
            copyStatusAndStopIfNotStopped = () => undefined;

            span.tag(Tag.httpStatusCode(res.statusCode));

            if (res.statusCode && res.statusCode >= 400)
              span.errored = true;

            if (res.statusMessage)
              span.tag(Tag.httpStatusMsg(res.statusMessage));

            span.stop();
          };

          req.on('end', copyStatusAndStopIfNotStopped);  // this insead of 'close' because Node 10 doesn't emit those
          res.on('abort', () => (span.errored = true, span.log('Abort', true), copyStatusAndStopIfNotStopped()));
          res.on('error', (err) => (span.error(err), copyStatusAndStopIfNotStopped()));

          span.async();

          return ret;

        } catch (err) {
          span.error(err);
          span.stop();

          throw err;
        }
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new HttpPlugin();
