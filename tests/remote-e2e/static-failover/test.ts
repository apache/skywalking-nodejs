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

/* eslint-env jest */

import waitForExpect from 'wait-for-expect';
import { StartedDockerComposeEnvironment } from 'testcontainers';
import { createRemoteE2eContext, sleep } from '../support/helpers';

const e2e = createRemoteE2eContext(__dirname, { serverPort: 5010, collectorBHttpPort: 12811 });

describe('remote-e2e static failover (Phase A)', () => {
  let compose: StartedDockerComposeEnvironment | undefined;

  beforeAll(async () => {
    e2e.cleanupTestcontainers();
    e2e.ensureE2eAgentImage();
    compose = await e2e.upCompose();
  });

  afterAll(async () => {
    if (compose) {
      await compose.down();
    }
  });

  it('reports to secondary collector after primary stops', async () => {
    if (!compose) {
      throw new Error('Docker Compose environment failed to start');
    }

    await waitForExpect(async () => e2e.pingServer());
    await sleep(10000);

    await e2e.stopComposeService('collector-a');
    await sleep(15000);

    await waitForExpect(async () => e2e.pingServer());
    await e2e.flushServer();
    await sleep(5000);

    await waitForExpect(async () => e2e.assertCollectorReceivedPing(), 120000, 3000);
  }, 300000);
});
