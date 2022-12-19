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
import { ContextCarrier } from '../trace/context/ContextCarrier';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import Span from '../trace/span/Span';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import PluginInstaller from '../core/PluginInstaller';
import { getAWS, execute } from '../aws/SDK2';

class AWS2SQSPlugin implements SwPlugin {
  readonly module = 'aws-sdk';
  readonly versions = '2.*';

  install(installer: PluginInstaller): void {
    const AWS = getAWS(installer);
    const _SQS = AWS.SQS;

    function SQS(this: any) {
      const sqs = _SQS.apply(this, arguments);

      function instrumentSend(name: string, addTraceId: any): void {
        const _func = sqs[name];

        sqs[name] = function (params: any, callback: any) {
          const queueUrl = params.QueueUrl;
          const operation = `AWS/SQS/${name}/${queueUrl.slice(queueUrl.lastIndexOf('/') + 1)}`;
          const span = ContextManager.current.newExitSpan(operation, Component.AWS_SQS, Component.HTTP);

          span.component = Component.AWS_SQS;
          span.layer = SpanLayer.MQ;

          return execute(span, this, _func, addTraceId(params, span), callback, 'mqBroker');
        };
      }

      instrumentSend('sendMessage', (params: any, span: Span) => {
        params = Object.assign({}, params);
        params.MessageAttributes = params.MessageAttributes ? Object.assign({}, params.MessageAttributes) : {};
        params.MessageAttributes.__revdTraceId = {
          DataType: 'String',
          StringValue: `${span.inject().value}/${hostname()}`,
        };

        return params;
      });

      instrumentSend('sendMessageBatch', (params: any, span: Span) => {
        const traceId = { __revdTraceId: { DataType: 'String', StringValue: `${span.inject().value}/${hostname()}` } };
        params = Object.assign({}, params);
        params.Entries = params.Entries.map(
          (e: any) =>
            (e = Object.assign({}, e, {
              MessageAttributes: e.MessageAttributes ? Object.assign({}, e.MessageAttributes, traceId) : traceId,
            })),
        );

        return params;
      });

      const _receiveMessage = sqs.receiveMessage;

      sqs.receiveMessage = function (params: any, callback: any) {
        params = Object.assign({}, params);
        const _MessageAttributeNames = params.MessageAttributeNames;
        params.MessageAttributeNames = _MessageAttributeNames
          ? _MessageAttributeNames.concat(['__revdTraceId'])
          : ['__revdTraceId'];

        delete params.MaxNumberOfMessages; // limit to 1 message in order to be able to link all Exit and Entry spans

        const queueUrl = params.QueueUrl;
        const operation = `AWS/SQS/receiveMessage/${queueUrl.slice(queueUrl.lastIndexOf('/') + 1)}`;
        const span = ContextManager.current.newExitSpan(`${operation}<check>`, Component.AWS_SQS, Component.HTTP);

        span.component = Component.AWS_SQS;
        span.layer = SpanLayer.MQ;

        // should always be called on success only, with no err
        function beforeCB(this: any, span: Span, err: any, res: any): Span {
          if (res.Messages?.length) {
            const delall = !_MessageAttributeNames || !_MessageAttributeNames.length;
            let traceId;

            // should only be 1
            for (let msg of res.Messages) {
              if (msg.MessageAttributes !== undefined || !config.awsSQSCheckBody)
                traceId = msg.MessageAttributes?.__revdTraceId?.StringValue;
              else {
                try {
                  msg = JSON.parse(msg.Body);
                  traceId = msg.MessageAttributes?.__revdTraceId?.Value;
                } catch {
                  // NOOP
                }
              }

              if (traceId) {
                if (delall) {
                  delete msg.MD5OfMessageAttributes;
                  delete msg.MessageAttributes;
                } else {
                  delete msg.MessageAttributes.__revdTraceId;

                  if (!Object.keys(msg.MessageAttributes).length) {
                    delete msg.MD5OfMessageAttributes;
                    delete msg.MessageAttributes;
                  }
                }
              }
            }

            let peer = 'Unknown';
            let carrier: ContextCarrier | undefined = undefined;

            if (traceId) {
              const idx = traceId.lastIndexOf('/');

              if (idx !== -1) {
                peer = traceId.slice(idx + 1);
                traceId = traceId.slice(0, idx);
                carrier = ContextCarrier.from({ traceKey: traceId });
              }
            }

            span.stop();

            span = ContextManager.current.newEntrySpan(operation, carrier);

            span.component = Component.AWS_SQS;
            span.layer = SpanLayer.MQ;
            span.peer = peer;

            span.tag(Tag.mqBroker(queueUrl));

            span.start();
          }

          return span;
        }

        return execute(span, this, _receiveMessage, params, callback, 'mqBroker', beforeCB);
      };

      return sqs;
    }

    Object.assign(SQS, _SQS);

    SQS.prototype = _SQS.prototype;
    AWS.SQS = SQS;
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AWS2SQSPlugin();

// // Example code for test maybe:
// const AWS = require("aws-sdk");

// AWS.config.update({region: 'your-region'});

// const sqs = new AWS.SQS();

// function callback(err, data) {
//     console.log('... callback err:', err);
//     console.log('... callback data:', data);
// }

// const send = {
//   MessageBody: 'Hello World...', /* required */
//   QueueUrl: 'https://queue_url', /* required */
// };

// sqs.sendMessage(send, callback);
// // OR:
// sqs.sendMessage(send).send(callback);
// // OR:
// sqs.sendMessage(send).promise()
//   .then(r => { console.log('... promise res:', r); })
//   .catch(e => { console.log('... promise err:', e); });

// const recv = {
//   QueueUrl: 'https://queue_url', /* required */
// };

// sqs.receiveMessage(recv, callback);
// // OR:
// sqs.receiveMessage(recv).send(callback);
// // OR:
// sqs.receiveMessage(recv).promise()
//   .then(r => { console.log('... promise res:', r); })
//   .catch(e => { console.log('... promise err:', e); });
