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
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import PluginInstaller from '../core/PluginInstaller';
import { getAWS, execute } from '../aws/SDK2';

class AWS2DynamoDBPlugin implements SwPlugin {
  readonly module = 'aws-sdk';
  readonly versions = '2.*';

  install(installer: PluginInstaller): void {
    const AWS = getAWS(installer);
    const DocumentClient = AWS.DynamoDB.DocumentClient;

    function instrument(name: string): void {
      const _func = DocumentClient.prototype[name];

      DocumentClient.prototype[name] = function (params: any, callback?: any): any {
        const span = ContextManager.current.newExitSpan(`AWS/DynamoDB/${name}`, Component.POSTGRESQL, Component.HTTP);

        span.component = Component.POSTGRESQL;
        span.layer = SpanLayer.DATABASE;
        // span.peer = `${this.service.endpoint.host ?? '<unknown>'}:${this.service.endpoint.port ?? '<unknown>'}`;

        span.tag(Tag.dbType('DynamoDB'));
        span.tag(Tag.dbStatement(name));

        return execute(span, this, _func, params, callback);
      };
    }

    instrument('batchGet');
    instrument('batchWrite');
    instrument('delete');
    instrument('get');
    instrument('put');
    instrument('query');
    instrument('scan');
    instrument('update');
    instrument('transactGet');
    instrument('transactWrite');
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AWS2DynamoDBPlugin();

// // Example code for test maybe:
// const AWS = require("aws-sdk");

// AWS.config.update({region: 'your-region'});

// const dynamo = new AWS.DynamoDB.DocumentClient();

// function callback(err, data) {
//     console.log('... callback err:', err);
//     console.log('... callback data:', data);
// }

// const data = {TableName: "table-name", Item: {id: 1, name: 'Bob'}};

// dynamo.put(data, callback);
// // OR:
// dynamo.put(data).send(callback);
// // OR:
// dynamo.put(data).promise()
//   .then(r => { console.log('... promise res:', r); })
//   .catch(e => { console.log('... promise err:', e); });
