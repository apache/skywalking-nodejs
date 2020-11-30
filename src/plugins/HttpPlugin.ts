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
import Span from '../trace/span/Span';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../trace/context/ContextCarrier';
import { createLogger } from '../logging';

const logger = createLogger(__filename);

class HttpPlugin implements SwPlugin {
  readonly module = 'http';
  readonly versions = '*';

  install(): void {
    if (logger.isDebugEnabled()) {
      logger.debug('installing http plugin');
    }
    this.interceptClientRequest();
    this.interceptServerRequest();
  }

  private interceptClientRequest() {
    const http = require('http');

    ((original) => {
      http.request = function () {
        const url: URL | string | RequestOptions = arguments[0];

        const { host, pathname } =
          url instanceof URL
            ? url
            : typeof url === 'string'
            ? new URL(url)
            : {
                host: (url.host || url.hostname || 'unknown') + ':' + url.port,
                pathname: url.path || '/',
              };
        const operation = pathname.replace(/\?.*$/g, '');

        const [span, request]: [Span, ClientRequest] = ContextManager.withSpanNoStop(
            ContextManager.current.newExitSpan(operation, host), (_span: Span, args) => {

          _span.component = Component.HTTP;
          _span.layer = SpanLayer.HTTP;
          _span.tag(Tag.httpURL(host + pathname));

          const _request = original.apply(this, args);

          _span.extract().items.forEach((item) => {
            _request.setHeader(item.key, item.value);
          });

          return [_span, _request];

        }, arguments);

        span.async();

        let stopped = 0;  // compensating if request aborted right after creation 'close' is not emitted
        const stopIfNotStopped = () => !stopped++ ? span.stop() : null;
        request.on('abort', stopIfNotStopped);  // make sure we stop only once
        request.on('close', stopIfNotStopped);
        request.on('error', stopIfNotStopped);

        request.prependListener('response', (res) => {
          span.resync();
          span.tag(Tag.httpStatusCode(res.statusCode));
          if (res.statusCode && res.statusCode >= 400) {
            span.errored = true;
          }
          if (res.statusMessage) {
            span.tag(Tag.httpStatusMsg(res.statusMessage));
          }
          stopIfNotStopped();
        });

        return request;
      };
    })(http.request);
  }

  private interceptServerRequest() {
    const http = require('http');

    ((original) => {
      http.Server.prototype.emit = function () {
        if (arguments[0] !== 'request') {
          return original.apply(this, arguments);
        }

        const [req, res] = [arguments[1] as IncomingMessage, arguments[2] as ServerResponse];

        const headers = req.rawHeaders || [];
        const headersMap: { [key: string]: string } = {};

        for (let i = 0; i < headers.length / 2; i += 2) {
          headersMap[headers[i]] = headers[i + 1];
        }

        const carrier = ContextCarrier.from(headersMap);
        const operation = (req.url || '/').replace(/\?.*/g, '');

        return ContextManager.withSpan(ContextManager.current.newEntrySpan(operation, carrier),
            (span, self, args) => {

          span.component = Component.HTTP_SERVER;
          span.layer = SpanLayer.HTTP;
          span.tag(Tag.httpURL((req.headers.host || '') + req.url));

          const ret = original.apply(self, args);

          span.tag(Tag.httpStatusCode(res.statusCode));
          if (res.statusCode && res.statusCode >= 400) {
            span.errored = true;
          }
          if (res.statusMessage) {
            span.tag(Tag.httpStatusMsg(res.statusMessage));
          }

          return ret;

        }, this, arguments);
      };
    })(http.Server.prototype.emit);
  }
}

// noinspection JSUnusedGlobalSymbols
export default new HttpPlugin();
