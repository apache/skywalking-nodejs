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

import axios from 'axios';
import waitForExpect from 'wait-for-expect';
import * as path from 'path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';

const rootDir = path.resolve(__dirname);
const serverUrl = 'http://localhost:5012';
const oapGraphqlUrl = 'http://localhost:12802/graphql';
const serviceName = 'nodejs-dns-periodic-e2e';

/** OAP Duration with MINUTE step: `yyyy-MM-dd HHmm` in UTC. */
function formatUtcMinute(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}`;
}

function isIpHostPort(entry: string): boolean {
  // IPv4 host:port or bracketed IPv6 host:port — not a DNS name like oap-a.
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(entry)) {
    return true;
  }
  return /^\[[0-9a-fA-F:]+\]:\d+$/.test(entry);
}

async function queryGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await axios.post(
    oapGraphqlUrl,
    { query, variables },
    {
      validateStatus: () => true,
    },
  );
  expect(response.status).toBe(200);
  expect(response.data.errors).toBeUndefined();
  return response.data.data as T;
}

describe('remote-e2e dns-periodic with real OAP', () => {
  let compose: StartedDockerComposeEnvironment | undefined;

  beforeAll(async () => {
    compose = await new DockerComposeEnvironment(rootDir, 'docker-compose.yml')
      .withWaitStrategy('server-1', Wait.forHealthCheck())
      .up();
  });

  afterAll(async () => {
    await compose?.down();
  });

  it('expands multi-hostname backends to IP dial targets and reports traces to OAP', async () => {
    if (!compose) {
      throw new Error('Docker Compose environment failed to start');
    }

    await waitForExpect(async () => {
      expect((await axios.get(`${serverUrl}/ping`)).status).toBe(200);
    });

    // Unique proof of DNS expand: dial list must be IP literals (not oap-a/oap-b),
    // and oap-a vs oap-b-proxy must yield at least two distinct addresses.
    await waitForExpect(
      async () => {
        const response = await axios.get(`${serverUrl}/debug/resolved-backends`);
        expect(response.status).toBe(200);
        const backends = response.data.backends as string[];
        expect(backends.length).toBeGreaterThanOrEqual(2);
        for (const backend of backends) {
          expect(isIpHostPort(backend)).toBe(true);
          expect(backend).not.toMatch(/^oap-[ab]/);
        }
        const hosts = new Set(backends.map((entry) => entry.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')));
        expect(hosts.size).toBeGreaterThanOrEqual(2);
      },
      60000,
      2000,
    );

    // Prove the configured 3s interval (not the 30s default): next refresh must arrive soon.
    const beforeRefresh = (await axios.get(`${serverUrl}/debug/resolved-backends`)).data.dnsRefreshCount as number;
    await waitForExpect(
      async () => {
        const response = await axios.get(`${serverUrl}/debug/resolved-backends`);
        expect(response.status).toBe(200);
        expect(response.data.dnsRefreshCount).toBeGreaterThan(beforeRefresh);
        const backends = response.data.backends as string[];
        expect(backends.length).toBeGreaterThanOrEqual(2);
        for (const backend of backends) {
          expect(isIpHostPort(backend)).toBe(true);
        }
      },
      12000,
      500,
    );

    await axios.get(`${serverUrl}/ping`);
    const flush = await axios.get(`${serverUrl}/flush`);
    expect(flush.status).toBe(200);
    expect(flush.data).toBe('flushed');

    let serviceId = '';
    await waitForExpect(
      async () => {
        const data = await queryGraphql<{ listServices: Array<{ id: string; name: string }> }>(
          '{ listServices { id name } }',
        );
        const service = data.listServices.find((item) => item.name === serviceName);
        expect(service).toBeDefined();
        serviceId = service!.id;
      },
      120000,
      3000,
    );

    const now = Date.now();
    const start = formatUtcMinute(new Date(now - 60 * 60 * 1000));
    const end = formatUtcMinute(new Date(now + 5 * 60 * 1000));

    await waitForExpect(
      async () => {
        // Same queryTraces shape as mtls e2e (BanyanDB / Trace Query V2).
        const data = await queryGraphql<{
          queryTraces: { traces: Array<{ spans: Array<{ serviceCode: string; endpointName: string }> }> };
        }>(
          `query($serviceId: ID!, $start: String!, $end: String!) {
            queryTraces(condition: {
              serviceId: $serviceId
              queryDuration: { start: $start, end: $end, step: MINUTE }
              traceState: ALL
              queryOrder: BY_START_TIME
              paging: { pageNum: 1, pageSize: 20 }
            }) {
              traces {
                spans {
                  serviceCode
                  endpointName
                }
              }
            }
          }`,
          { serviceId, start, end },
        );

        const spans: Array<{ serviceCode: string; endpointName: string }> = [];
        for (const trace of data.queryTraces.traces) {
          spans.push(...trace.spans);
        }
        expect(spans.length).toBeGreaterThan(0);
        expect(spans).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              serviceCode: serviceName,
              endpointName: expect.stringMatching(/\/ping/),
            }),
          ]),
        );
      },
      120000,
      3000,
    );
  }, 300000);
});
