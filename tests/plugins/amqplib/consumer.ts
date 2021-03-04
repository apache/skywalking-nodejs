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
import agent from '../../../src';

agent.start({
  serviceName: 'client',
  maxBufferSize: 1000,
})

const server = http.createServer(async (req, res) => {
  const q = 'queue';

  await new Promise((resolve, reject) => {
    require('amqplib/callback_api').connect(`amqp://${process.env.RABBITMQ_HOST}`, (err: any, conn: any) => {
      conn.createChannel((err: any, ch: any) => {
        ch.assertQueue(q, {durable: false});
        ch.consume(q, (msg: any) => {
          ch.ack(msg);
          ch.close(() => conn.close(() => {
            res.end('done');
            resolve(null);
          }));
        });
      });
    });
  });
});

server.listen(5001, () => console.info('Listening on port 5001...'));
