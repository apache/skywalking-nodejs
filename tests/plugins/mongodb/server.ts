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

import * as http from 'http';
import {MongoClient} from 'mongodb';
import agent from '../../../src';

process.env.SW_AGENT_LOGGING_LEVEL = 'ERROR';

agent.start({
  serviceName: 'server',
  maxBufferSize: 1000,
});

const server = http.createServer(async (req, res) => {
  await new Promise((resolve, reject) => {
    MongoClient.connect(`mongodb://root:root@${process.env.MONGO_HOST}:27017`, {useUnifiedTopology: true}, function(err: any, client: any) {
      if (err) {
          res.end(`${err}`);
          resolve(null);
      } else {
        client.db('admin').collection('docs').findOne().then(
          (resDB: any) => {
            res.end(`${resDB}`);
            resolve(null);
            client.close();
          },
          (err: any) => {
            res.end(`${err}`);
            resolve(null);
            client.close();
          },
        );
      }
    });
  });
});

server.listen(5000, () => console.info('Listening on port 5000...'));
