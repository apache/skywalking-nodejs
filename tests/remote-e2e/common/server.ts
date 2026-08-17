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

agent.start({ serviceName: 'server', maxBufferSize: 1000 });

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/ping' || url.startsWith('/probe/')) {
    res.statusCode = 200;
    res.end('ok');
    return;
  }
  if (url === '/flush') {
    const deadlineMs = 8000;
    let completed = false;
    const timer = setTimeout(() => {
      if (completed) {
        return;
      }
      completed = true;
      // Distinguish hung flush from success (helpers assert status + body).
      res.statusCode = 504;
      res.end('flush deadline');
    }, deadlineMs);
    void Promise.resolve(agent.flush())
      .catch(() => undefined)
      .finally(() => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timer);
        res.statusCode = 200;
        res.end('flushed');
      });
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(5000, () => console.info('Listening on port 5000...'));
