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

describe('AgentConfig collector heartbeat period', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    jest.resetModules();
  });

  it('defaults to 20 seconds (Java HEARTBEAT_PERIOD)', () => {
    delete process.env.SW_AGENT_COLLECTOR_HEARTBEAT_PERIOD;
    jest.resetModules();
    const config = require('../../src/config/AgentConfig').default;
    expect(config.collectorHeartbeatPeriod).toBe(20);
  });

  it('reads SW_AGENT_COLLECTOR_HEARTBEAT_PERIOD in seconds', () => {
    process.env.SW_AGENT_COLLECTOR_HEARTBEAT_PERIOD = '15';
    jest.resetModules();
    const config = require('../../src/config/AgentConfig').default;
    expect(config.collectorHeartbeatPeriod).toBe(15);
  });
});
