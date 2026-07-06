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

describe('grpcUpstreamDeadlineMs (Java GRPC_UPSTREAM_TIMEOUT parity)', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    jest.resetModules();
  });

  it('defaults to 30 seconds when unset', () => {
    delete process.env.SW_AGENT_COLLECTOR_GRPC_UPSTREAM_TIMEOUT;
    delete process.env.SW_AGENT_TRACE_TIMEOUT;
    jest.resetModules();
    const { grpcUpstreamDeadlineMs } = require('../../src/agent/core/remote/GrpcUpstreamOptions');
    const before = Date.now();
    expect(grpcUpstreamDeadlineMs()).toBeGreaterThanOrEqual(before + 30_000);
    expect(grpcUpstreamDeadlineMs()).toBeLessThanOrEqual(before + 30_000 + 50);
  });

  it('reads SW_AGENT_COLLECTOR_GRPC_UPSTREAM_TIMEOUT in seconds', () => {
    process.env.SW_AGENT_COLLECTOR_GRPC_UPSTREAM_TIMEOUT = '45';
    jest.resetModules();
    const { grpcUpstreamDeadlineMs } = require('../../src/agent/core/remote/GrpcUpstreamOptions');
    const before = Date.now();
    expect(grpcUpstreamDeadlineMs()).toBeGreaterThanOrEqual(before + 45_000);
  });

  it('falls back to SW_AGENT_TRACE_TIMEOUT milliseconds when collector timeout unset', () => {
    delete process.env.SW_AGENT_COLLECTOR_GRPC_UPSTREAM_TIMEOUT;
    process.env.SW_AGENT_TRACE_TIMEOUT = '12000';
    jest.resetModules();
    const { grpcUpstreamDeadlineMs } = require('../../src/agent/core/remote/GrpcUpstreamOptions');
    const before = Date.now();
    expect(grpcUpstreamDeadlineMs()).toBeGreaterThanOrEqual(before + 12_000);
  });
});
