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

import SwPlugin from '@/core/SwPlugin';
import { URL } from 'url';
import { ClientRequest, IncomingMessage, RequestOptions } from 'http';
import ContextManager from '@/trace/context/ContextManager';
import { Component } from '@/trace/Component';
import Tag from '@/Tag';
import { SpanLayer } from '@/proto/language-agent/Tracing_pb';

type RequestFunctionType = (
  url: string | URL,
  options: RequestOptions,
  callback?: (res: IncomingMessage) => void,
) => ClientRequest;

class HttpPlugin implements SwPlugin {
  readonly module = 'http';
  readonly versions = '';

  install(): void {
    this.interceptClientRequest();
  }

  private interceptClientRequest() {
    const http = require('http');

    if (http.request === this.wrapHttpRequest) {
      return;
    }

    http.request = this.wrapHttpRequest(http.request);
  }

  private wrapHttpRequest(originalRequest: RequestFunctionType): RequestFunctionType {
    return (
      url: string | URL,
      options: RequestOptions,
      callback?: (res: IncomingMessage) => void,
    ): ClientRequest => {
      const {
        host: peer,
        pathname: operation,
      } = url instanceof URL ? url : new URL(url);

      const span = ContextManager.current.newExitSpan(operation, peer).start();
      span.component = Component.HTTP;
      span.layer = SpanLayer.HTTP;

      const snapshot = ContextManager.current.capture();

      const request = originalRequest(url, options, res => {
        span
          .tag(Tag.httpStatusCode(res.statusCode))
          .tag(Tag.httpStatusMsg(res.statusMessage));

        const callbackSpan = ContextManager.current.newLocalSpan('callback').start();
        callbackSpan.layer = SpanLayer.HTTP;
        callbackSpan.component = Component.HTTP;

        ContextManager.current.restore(snapshot);

        if (callback) {
          callback(res);
        }

        callbackSpan.stop();
      });

      span.stop();

      return request;
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new HttpPlugin();
