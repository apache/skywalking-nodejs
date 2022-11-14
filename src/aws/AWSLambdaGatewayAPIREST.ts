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

import { URL } from 'url';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../trace/context/ContextCarrier';
import Span from '../trace/span/Span';
import DummySpan from '../trace/span/DummySpan';
import { ignoreHttpMethodCheck } from '../config/AgentConfig';
import { AWSLambdaTriggerPlugin } from './AWSLambdaTriggerPlugin';

class AWSLambdaGatewayAPIREST extends AWSLambdaTriggerPlugin {
  start(event: any, context: any): [Span, any] {
    const headers = event.headers;
    const reqCtx = event.requestContext;
    const method = reqCtx?.httpMethod ?? event.httpMethod;
    const proto = reqCtx?.protocol ? reqCtx.protocol.split('/')[0].toLowerCase() : headers?.['X-Forwarded-Proto'];
    const port = headers?.['X-Forwarded-Port'] || '';
    const host = headers?.Host ?? (reqCtx?.domainName || '');
    const hostport = host ? (port ? `${host}:${port}` : host) : port;
    const operation = reqCtx?.path ?? event.path ?? (context.functionName ? `/${context.functionName}` : '/');

    const query = event.multiValueQueryStringParameters
      ? '?' +
        Object.entries(event.multiValueQueryStringParameters)
          .map(([k, vs]: any[]) => vs.map((v: String) => `${k}=${v}`).join('&'))
          .join('&')
      : event.queryStringParameters
      ? '?' +
        Object.entries(event.queryStringParameters)
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
      : '';

    const carrier = headers && ContextCarrier.from(headers);

    const span =
      method && ignoreHttpMethodCheck(method)
        ? DummySpan.create()
        : ContextManager.current.newEntrySpan(operation, carrier);

    span.component = Component.AWSLAMBDA_GATEWAYAPIREST;
    span.peer = reqCtx?.identity?.sourceIp ?? headers?.['X-Forwarded-For'] ?? 'Unknown';

    if (method) span.tag(Tag.httpMethod(method));

    if (hostport && proto) span.tag(Tag.httpURL(new URL(`${proto}://${hostport}${operation}${query}`).toString()));

    span.start();

    return [span, event];
  }

  stop(span: Span, err: Error | null, res: any): void {
    const statusCode = res?.statusCode || (typeof res === 'number' ? res : err ? 500 : null);

    if (statusCode) {
      if (statusCode >= 400) span.errored = true;

      span.tag(Tag.httpStatusCode(statusCode));
    }

    span.stop();
  }
}

export default new AWSLambdaGatewayAPIREST();
