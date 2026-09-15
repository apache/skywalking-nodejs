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
import * as fs from 'fs';
import * as path from 'path';
import * as tls from 'tls';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';

const rootDir = path.resolve(__dirname);
const serverUrl = 'http://localhost:5011';
const oapTlsPort = 11811;
const oapGraphqlUrl = 'http://localhost:12801/graphql';
const serviceName = 'nodejs-mtls-e2e';

/** OAP Duration with MINUTE step: `yyyy-MM-dd HHmm` in UTC. */
function formatUtcMinute(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}`;
}

/**
 * True only when the TLS failure clearly means the peer required a client
 * certificate.  Hostname / CA / cipher failures must NOT match.
 */
function isClientCertificateRequiredError(error: Error & { code?: string }): boolean {
  const code = error.code ?? '';
  const message = error.message;

  if (
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    /altname|hostname|cipher|protocol version|unable to verify|self.signed/i.test(message)
  ) {
    return false;
  }

  return (
    code === 'ERR_SSL_PEER_CERTIFICATE_REQUIRED' ||
    code === 'ERR_SSL_SSLV3_ALERT_CERTIFICATE_REQUIRED' ||
    code === 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED' ||
    /certificate.?required|peer did not return a certificate|client.?certificate.?required/i.test(message)
  );
}

function assertOapRequiresClientCertificate(): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handshakeCompleted = false;
    const socket = tls.connect({
      host: '127.0.0.1',
      port: oapTlsPort,
      ca: fs.readFileSync(path.join(rootDir, 'server', 'ca.crt')),
      servername: 'oap',
      rejectUnauthorized: true,
      // Intentionally omit key/cert — OAP must reject this connection.
    });
    const timer = setTimeout(() => {
      socket.destroy();
      finish(new Error('OAP accepted a TLS connection without a client certificate'));
    }, 10000);

    function finish(error?: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.once('secureConnect', () => {
      // TLS 1.3 may fire secureConnect before the server sends a
      // certificate-required alert.  Do not treat this as acceptance —
      // only an explicit client-certificate-required error counts.
      handshakeCompleted = true;
    });
    socket.once('error', (error: Error & { code?: string }) => {
      const code = error.code ?? '';
      const message = error.message;

      const isNetworkError = /^(ECONNREFUSED|ETIMEDOUT|ECONNRESET|EPIPE|ENOTFOUND|EHOSTUNREACH)$/.test(code);
      if (isNetworkError) {
        finish(new Error(`Infra failure reaching OAP TLS port (${code}): ${message}`));
        return;
      }

      if (isClientCertificateRequiredError(error)) {
        finish();
        return;
      }

      finish(new Error(`TLS error is not a client-certificate rejection (code=${code}): ${message}`));
    });
    socket.once('close', () => {
      if (settled) {
        return;
      }
      // A bare post-handshake close is not proof of mTLS enforcement — OAP
      // could close for other reasons.  Require an explicit certificate-
      // required alert/error (handled above).
      finish(
        new Error(
          handshakeCompleted
            ? 'OAP closed after TLS handshake without a client-certificate-required alert'
            : 'OAP closed the connection without reporting a TLS handshake failure',
        ),
      );
    });
  });
}

async function queryGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await axios.post(oapGraphqlUrl, { query, variables });
  expect(response.status).toBe(200);
  expect(response.data.errors).toBeUndefined();
  return response.data.data as T;
}

describe('remote-e2e mTLS with real OAP', () => {
  let compose: StartedDockerComposeEnvironment | undefined;

  beforeAll(async () => {
    compose = await new DockerComposeEnvironment(rootDir, 'docker-compose.yml')
      .withWaitStrategy('server-1', Wait.forHealthCheck())
      .up();
  });

  afterAll(async () => {
    await compose?.down();
  });

  it('rejects a TLS connection without a client certificate', async () => {
    if (!compose) {
      throw new Error('Docker Compose environment failed to start');
    }

    await assertOapRequiresClientCertificate();
  }, 300000);

  it('reports a trace to OAP through a mutually authenticated TLS channel', async () => {
    if (!compose) {
      throw new Error('Docker Compose environment failed to start');
    }

    await waitForExpect(async () => {
      expect((await axios.get(`${serverUrl}/ping`)).status).toBe(200);
    });

    // Generate a real entry span via the instrumented HTTP server, then flush.
    // flush() is best-effort and swallows report failures, so HTTP 200 alone
    // is not proof — we assert persistence via OAP queryTraces below.
    await axios.get(`${serverUrl}/ping`);

    const flush = await axios.get(`${serverUrl}/flush`);
    expect(flush.status).toBe(200);
    expect(flush.data).toBe('flushed');

    // Management gRPC over mTLS: service registration visible in metadata.
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

    // TraceSegmentReportService client-streaming over mTLS: segments must be
    // queryable.  queryTraces (v2) is supported on BanyanDB (same API Java
    // e2e uses via `swctl tv2 ls`); queryBasicTracesByName is not.
    const now = Date.now();
    const start = formatUtcMinute(new Date(now - 60 * 60 * 1000));
    const end = formatUtcMinute(new Date(now + 5 * 60 * 1000));

    await waitForExpect(
      async () => {
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
