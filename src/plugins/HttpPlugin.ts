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
import onFinished from 'on-finished';

class HttpPlugin implements SwPlugin {
  readonly module = 'http';
  readonly versions = '*';

  install(): void {
    const http = require('http');
    const https = require('https');

    this.interceptClientRequest(http);
    this.interceptServerRequest(http);
    this.interceptClientRequest(https);
    this.interceptServerRequest(https);
  }

  private interceptClientRequest(module: any) {
    const _request = module.request;

    module.request = function() {
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

      const span: ExitSpan = ContextManager.current.newExitSpan(operation, host).start() as ExitSpan;

      let stopped = 0;  // compensating if request aborted right after creation 'close' is not emitted
      const stopIfNotStopped = (err?: Error | null) => {
        if (stopped++) {
          return;
        }
        span.stop();
        if (err) {
          span.error(err);
        }
      };

      try {
        // TODO: these should go into span class
        if (span.depth === 1) {  // only set HTTP if this span is not overridden by a higher level one
          span.component = Component.HTTP;
          span.layer = SpanLayer.HTTP;
        }
        if (!span.peer) {
          span.peer = host;
        }
        const httpURL = host + pathname;
        if (!span.hasTag(httpURL)) {
          span.tag(Tag.httpURL(httpURL));
        }

        const req: ClientRequest = _request.apply(this, arguments);

        span.inject().items.forEach((item) => {
          req.setHeader(item.key, item.value);
        });

        req.prependListener('response', (res) => {
          span.resync();
          span.tag(Tag.httpStatusCode(res.statusCode));
          if (res.statusCode && res.statusCode >= 400) {
            span.errored = true;
          }
          if (res.statusMessage) {
            span.tag(Tag.httpStatusMsg(res.statusMessage));
          }
        });
        onFinished(req, stopIfNotStopped);

        span.async();

        return req;

      } catch (e) {
        stopIfNotStopped(e);
        throw e;
      }
    };
  }

  private interceptServerRequest(module: any) {
    const _emit = module.Server.prototype.emit;

    module.Server.prototype.emit = function() {
      if (arguments[0] !== 'request') {
        return _emit.apply(this, arguments);
      }

      const [req, res] = [arguments[1] as IncomingMessage, arguments[2] as ServerResponse];

      const headers = req.rawHeaders || [];
      const headersMap: { [key: string]: string } = {};

      for (let i = 0; i < headers.length / 2; i += 2) {
        headersMap[headers[i]] = headers[i + 1];
      }

      const carrier = ContextCarrier.from(headersMap);
      const operation = (req.url || '/').replace(/\?.*/g, '');
      const span = ContextManager.current.newEntrySpan(operation, carrier).start();

      span.component = Component.HTTP_SERVER;
      span.layer = SpanLayer.HTTP;
      span.peer = req.headers.host || '';
      span.tag(Tag.httpURL(span.peer + req.url));

      let stopped = 0;
      const stopIfNotStopped = (err: Error | null) => {
        if (!stopped++) {
          span.stop();
          span.tag(Tag.httpStatusCode(res.statusCode));
          if (res.statusCode && res.statusCode >= 400) {
            span.errored = true;
          }
          if (err) {
            span.error(err);
          }
          if (res.statusMessage) {
            span.tag(Tag.httpStatusMsg(res.statusMessage));
          }
        }
      };
      onFinished(res, stopIfNotStopped);

      try {
        return _emit.apply(this, arguments);
      } catch (e) {
        stopIfNotStopped(e);
        throw e;
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new HttpPlugin();
