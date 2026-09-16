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
import ServiceManager from '../../../src/agent/core/boot/ServiceManager';
import GRPCChannelManager from '../../../src/agent/core/remote/GRPCChannelManager';
import * as http from 'http';

agent.start({
  serviceName: 'nodejs-dns-periodic-e2e',
  maxBufferSize: 1000,
});

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/ping') {
    res.statusCode = 200;
    res.end('ok');
    return;
  }

  if (url === '/debug/resolved-backends') {
    const manager = ServiceManager.INSTANCE.findService(GRPCChannelManager);
    const backends = manager?.getResolvedBackends() ?? [];
    const dnsRefreshCount = manager?.getDnsRefreshCount() ?? 0;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ backends, dnsRefreshCount }));
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
      res.statusCode = 504;
      res.end('flush deadline');
    }, deadlineMs);

    void Promise.resolve(agent.flush())
      .then(() => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timer);
        res.statusCode = 200;
        res.end('flushed');
      })
      .catch((error: unknown) => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timer);
        const message = error instanceof Error ? error.message : String(error);
        res.statusCode = 500;
        res.end(`flush failed: ${message}`);
      });
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

server.listen(5000, () => console.info('Listening on port 5000...'));
