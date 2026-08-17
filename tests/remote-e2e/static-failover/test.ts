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
import { createRemoteE2eContext } from '../support/helpers';

const e2e = createRemoteE2eContext(__dirname, {
  serverPort: 5010,
  collectorAHttpPort: 12810,
  collectorBHttpPort: 12811,
});

describe('remote-e2e static failover', () => {
  let compose: StartedDockerComposeEnvironment | undefined;

  beforeAll(async () => {
    compose = await e2e.upCompose();
  });

  afterAll(async () => {
    if (compose) {
      await compose.down();
    }
  });

  it('fails over to the standby collector after the active one stops', async () => {
    if (!compose) {
      throw new Error('Docker Compose environment failed to start');
    }

    await waitForExpect(async () => e2e.pingServer());
    await e2e.flushServer();

    const activeInfo = { activeService: '' as 'collector-a' | 'collector-b', standbyHttpPort: 0 };
    let ambiguousProbe: string | undefined;
    await waitForExpect(async () => {
      const resolved = await e2e.resolveActiveCollector();
      if (resolved.kind === 'ambiguous') {
        ambiguousProbe = resolved.probePath;
        return;
      }
      if (resolved.kind === 'pending') {
        throw new Error(`Probe ${resolved.probePath} not received by either collector yet`);
      }
      activeInfo.activeService = resolved.activeService;
      activeInfo.standbyHttpPort = resolved.standbyHttpPort;
    });
    expect(ambiguousProbe).toBeUndefined();
    expect(activeInfo.activeService).toMatch(/^collector-[ab]$/);
    await e2e.stopComposeService(compose, activeInfo.activeService);

    await waitForExpect(
      async () => {
        await e2e.pingServer();
        await e2e.flushServer();
        await e2e.assertCollectorReceivedPing(activeInfo.standbyHttpPort);
      },
      120000,
      3000,
    );
  }, 300000);
});
