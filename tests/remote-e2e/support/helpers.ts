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

import * as path from 'path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import axios from 'axios';

export type RemoteE2ePorts = {
  serverPort: number;
  collectorAHttpPort: number;
  collectorBHttpPort: number;
};

export function createRemoteE2eContext(caseDir: string, ports: RemoteE2ePorts) {
  const rootDir = path.resolve(caseDir);
  const { serverPort, collectorAHttpPort, collectorBHttpPort } = ports;

  async function pingServer(): Promise<void> {
    const response = await axios.get(`http://localhost:${serverPort}/ping`);
    expect(response.status).toBe(200);
  }

  async function flushServer(): Promise<void> {
    const response = await axios.get(`http://localhost:${serverPort}/flush`, {
      validateStatus: () => true,
    });
    expect(response.status).toBe(200);
    expect(response.data).toBe('flushed');
  }

  async function collectorReceiveData(port: number): Promise<string> {
    return String((await axios.get(`http://localhost:${port}/receiveData`)).data);
  }

  async function collectorHasPing(port: number): Promise<boolean> {
    const data = await collectorReceiveData(port);
    return data.includes('operationName: GET:/ping');
  }

  async function assertCollectorReceivedPing(port: number): Promise<void> {
    const data = await collectorReceiveData(port);
    expect(data).toContain('serviceName: server');
    expect(data).toContain('operationName: GET:/ping');
    expect(data).toContain("http.status_code, value: '200'");
  }

  /**
   * Identify which mock collector the agent is currently reporting to via a
   * unique per-probe path.
   * - pending: neither has the probe yet (caller may retry)
   * - ambiguous: both received it (fail outside waitForExpect — do not retry)
   * - ready: exactly one collector has the probe
   */
  async function resolveActiveCollector(): Promise<
    | {
        kind: 'ready';
        activeService: 'collector-a' | 'collector-b';
        standbyService: 'collector-a' | 'collector-b';
        activeHttpPort: number;
        standbyHttpPort: number;
      }
    | { kind: 'pending'; probePath: string }
    | { kind: 'ambiguous'; probePath: string }
  > {
    const token = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const probePath = `/probe/${token}`;
    const needle = `operationName: GET:${probePath}`;

    const probeRes = await axios.get(`http://localhost:${serverPort}${probePath}`);
    expect(probeRes.status).toBe(200);
    await flushServer();

    const aData = await collectorReceiveData(collectorAHttpPort);
    const bData = await collectorReceiveData(collectorBHttpPort);
    const aHas = aData.includes(needle);
    const bHas = bData.includes(needle);

    if (!aHas && !bHas) {
      return { kind: 'pending', probePath };
    }
    if (aHas && bHas) {
      return { kind: 'ambiguous', probePath };
    }
    if (aHas) {
      return {
        kind: 'ready',
        activeService: 'collector-a',
        standbyService: 'collector-b',
        activeHttpPort: collectorAHttpPort,
        standbyHttpPort: collectorBHttpPort,
      };
    }
    return {
      kind: 'ready',
      activeService: 'collector-b',
      standbyService: 'collector-a',
      activeHttpPort: collectorBHttpPort,
      standbyHttpPort: collectorAHttpPort,
    };
  }

  async function upCompose(): Promise<StartedDockerComposeEnvironment> {
    // Server depends_on collectors with service_healthy — waiting on server alone is enough.
    // compose `build:` for the agent image — Docker layer cache invalidates on lockfile/Dockerfile change.
    return new DockerComposeEnvironment(rootDir, 'docker-compose.yml')
      .withWaitStrategy('server-1', Wait.forHealthCheck())
      .up();
  }

  /** Stop one compose service (Compose v2 / testcontainers: `<service>-1`). */
  async function stopComposeService(
    compose: StartedDockerComposeEnvironment,
    service: 'collector-a' | 'collector-b',
  ): Promise<void> {
    await compose.getContainer(`${service}-1`).stop();
  }

  return {
    rootDir,
    pingServer,
    flushServer,
    collectorHasPing,
    assertCollectorReceivedPing,
    resolveActiveCollector,
    upCompose,
    stopComposeService,
  };
}
