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

import agent from '../../../src';
import * as http from 'http';

import express from 'express';

agent.start({
  serviceName: 'server',
  maxBufferSize: 1000,
});
const app = express();

app.get('/express', (req, res) => {
  http
  .request('http://httpbin.org/json', (r) => {
    let data = '';
    r.on('data', (chunk) => (data += chunk));
    r.on('end', () => res.send(data));
  })
  .end();
});

app.listen(5000, () => console.info('Listening on port 5000...'));
