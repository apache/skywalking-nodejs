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

import { hostname } from 'os';
import config from '../config/AgentConfig';
import SwPlugin from '../core/SwPlugin';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import PluginInstaller from '../core/PluginInstaller';
import { KeyTrace, KeyParams } from '../aws/AWSLambdaTriggerPlugin';
import { getAWS, execute } from '../aws/SDK2';

class AWS2LambdaPlugin implements SwPlugin {
  readonly module = 'aws-sdk';
  readonly versions = '2.*';

  install(installer: PluginInstaller): void {
    const AWS = getAWS(installer);
    const _Lambda = AWS.Lambda;

    function Lambda(this: any) {
      const lambda = _Lambda.apply(this, arguments);
      const _invoke = lambda.invoke;

      lambda.invoke = function (params: any, callback: any) {
        if (params.InvocationType === 'DryRun') return _invoke.call(this, params, callback);

        let funcName = params.FunctionName;
        const li = funcName.lastIndexOf(':');
        let name;

        if (li === -1) name = funcName;
        else {
          // my-function:v1
          if (funcName.indexOf(':') === -1) name = funcName.slice(li);
          else name = funcName.slice(li + 1); // 123456789012:function:my-function, arn:aws:lambda:us-west-2:123456789012:function:my-function
        }

        const span = ContextManager.current.newExitSpan(
          `AWS/Lambda/invoke/${name || ''}`,
          Component.AWSLAMBDA_FUNCTION,
          Component.HTTP,
        );

        span.component = Component.AWSLAMBDA_FUNCTION;
        span.layer = SpanLayer.HTTP;

        if (li !== -1) span.tag(Tag.arn(funcName));

        if (config.awsLambdaChain) {
          let payload = params.Payload;

          if (payload instanceof Buffer) payload = payload.toString();

          if (typeof payload === 'string') {
            const traceid = JSON.stringify(`${span.inject().value}/${hostname()}`);
            const keyTrace = JSON.stringify(KeyTrace);
            const keyParams = JSON.stringify(KeyParams);

            if (payload.match(/^\s*{\s*}\s*$/)) payload = `{${keyTrace}:${traceid}}`;
            else if (payload.match(/^\s*{/))
              payload = `{${keyTrace}:${traceid},${payload.slice(payload.indexOf('{') + 1)}`;
            else payload = `{${keyTrace}:${traceid},${keyParams}:${payload}}`;

            params = Object.assign({}, params, { Payload: payload });
          }
        }

        return execute(span, this, _invoke, params, callback);
      };

      return lambda;
    }

    Object.assign(Lambda, _Lambda);

    Lambda.prototype = _Lambda.prototype;
    AWS.Lambda = Lambda;
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AWS2LambdaPlugin();

// // Example code for test maybe:
// const AWS = require("aws-sdk");

// AWS.config.update({region: 'your-region'});

// const lambda = new AWS.Lambda();

// function callback(err, data) {
//     console.log('... callback err:', err);
//     console.log('... callback data:', data);
// }

// const params = {
//   FunctionName: 'function_to_call',
//   InvocationType: 'RequestResponse',  // or 'Event',
//   // LogType: 'Tail',
//   Payload: JSON.stringify({arg1: 'args to function'}),
// };

// lambda.invoke(params, callback);
// // OR:
// lambda.invoke(params).send(callback);
// // OR:
// lambda.invoke(params).promise()
//   .then(r => { console.log('... promise res:', r); })
//   .catch(e => { console.log('... promise err:', e); });
