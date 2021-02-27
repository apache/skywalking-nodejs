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

    this.interceptClientRequest(http);
    this.interceptServerRequest(http, 'http');
    this.interceptClientRequest(https);
    this.interceptServerRequest(https, 'https');
  }

  private interceptClientRequest(module: any) {
    const _request = module.request;

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
        const httpURL = host + pathname;
        const operation = pathname.replace(/\?.*$/g, '');

      let stopped = 0;  // compensating if request aborted right after creation 'close' is not emitted
      const stopIfNotStopped = () => !stopped++ ? span.stop() : null;  // make sure we stop only once
      const span: ExitSpan = ContextManager.current.newExitSpan(operation, host).start() as ExitSpan;

      try {
        if (span.depth === 1) {  // only set HTTP if this span is not overridden by a higher level one
          span.component = Component.HTTP;
          span.layer = SpanLayer.HTTP;
        }
        if (!span.peer) {
          span.peer = host;
        }
        if (!span.hasTag(Tag.httpURLKey)) {  // only set if a higher level plugin with more info did not already set
          span.tag(Tag.httpURL(httpURL));
        }
        if (!span.hasTag(Tag.httpMethodKey)) {
          span.tag(Tag.httpMethod(httpMethod));
        }

        const req: ClientRequest = _request.apply(this, arguments);

        span.inject().items.forEach((item) => {
          req.setHeader(item.key, item.value);
        });

        req.on('close', stopIfNotStopped);
        req.on('abort', () => (span.errored = true, stopIfNotStopped()));
        req.on('error', (err) => (span.error(err), stopIfNotStopped()));

        req.prependListener('response', (res) => {
          span.resync();
          span.tag(Tag.httpStatusCode(res.statusCode));

          if (res.statusCode && res.statusCode >= 400) {
            span.errored = true;
          }
          if (res.statusMessage) {
            span.tag(Tag.httpStatusMsg(res.statusMessage));
          }

          res.on('end', stopIfNotStopped);
        });

        span.async();

        return req;

      } catch (e) {
        if (!stopped) {  // don't want to set error if exception occurs after clean close
          span.error(e);
          stopIfNotStopped();
        }

        throw e;
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

        for (let i = 0; i < headers.length / 2; i += 2) {
          headersMap[headers[i]] = headers[i + 1];
        }

        const carrier = ContextCarrier.from(headersMap);
        const operation = (req.url || '/').replace(/\?.*/g, '');
        const span = ContextManager.current.newEntrySpan(operation, carrier).start();

        const copyStatusAndStop = () => {
          span.tag(Tag.httpStatusCode(res.statusCode));
          if (res.statusCode && res.statusCode >= 400) {
            span.errored = true;
          }
          if (res.statusMessage) {
            span.tag(Tag.httpStatusMsg(res.statusMessage));
          }

          span.stop();
        };

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

          let ret = handler.call(this, req, res, ...reqArgs);

          if (!ret || typeof ret.then !== 'function') {  // generic Promise check
            copyStatusAndStop();

          } else {
            ret = ret.then((r: any) => {
              copyStatusAndStop();

              return r;
            },

            (error: any) => {
              span.error(error);
              span.stop();

              return Promise.reject(error);
            })
          }

          return ret;

        } catch (e) {
          span.error(e);
          span.stop();

          throw e;
        }
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new HttpPlugin();
