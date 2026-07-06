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

import { GRPCChannelStatus } from '../../src/agent/core/remote/GRPCChannelStatus';

const mockReportInstanceProperties = jest.fn((_req, _meta, opts, cb) => cb(null));
const mockKeepAlive = jest.fn((_req, _meta, opts, cb) => cb(null));
const mockGrpcUpstreamDeadlineMs = jest.fn(() => 9_876_543_210);
let pendingReportCallback: ((error: Error | null) => void) | undefined;
let pendingKeepAliveCallback: ((error: Error | null) => void) | undefined;

const mockChannelManager = {
  addChannelListener: jest.fn(),
  resolveAddress: jest.fn(() => '127.0.0.1:11800'),
  getClientOptions: jest.fn(() => ({ channelOverride: {} as never })),
  reportError: jest.fn(),
};

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: {
    serviceName: 'test-service',
    serviceInstance: 'test-instance',
    collectorHeartbeatPeriod: 20,
  },
}));

jest.mock('../../src/proto/management/Management_grpc_pb', () => ({
  ManagementServiceClient: jest.fn().mockImplementation(() => ({
    reportInstanceProperties: jest.fn((_req, _meta, opts, cb) => {
      pendingReportCallback = cb;
      mockReportInstanceProperties(_req, _meta, opts, cb);
    }),
    keepAlive: jest.fn((_req, _meta, opts, cb) => {
      pendingKeepAliveCallback = cb;
      mockKeepAlive(_req, _meta, opts, cb);
    }),
  })),
}));

jest.mock('../../src/agent/core/remote/GrpcUpstreamOptions', () => ({
  grpcUpstreamDeadlineMs: () => mockGrpcUpstreamDeadlineMs(),
}));

jest.mock('../../src/agent/core/boot/ServiceManager', () => ({
  __esModule: true,
  default: {
    INSTANCE: {
      findService: jest.fn((serviceClass: { name?: string }) => {
        if (serviceClass?.name === 'CommandService') {
          return { receiveCommand: jest.fn() };
        }
        return mockChannelManager;
      }),
    },
  },
}));

jest.mock('../../src/logging', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    _isDebugEnabled: false,
  }),
  throttled: () => jest.fn(),
}));

import ServiceManagementClient from '../../src/agent/core/remote/ServiceManagementClient';
import config from '../../src/config/AgentConfig';

describe('ServiceManagementClient', () => {
  let client: ServiceManagementClient;

  beforeEach(() => {
    jest.useFakeTimers();
    mockReportInstanceProperties.mockClear();
    mockKeepAlive.mockClear();
    mockGrpcUpstreamDeadlineMs.mockClear();
    mockChannelManager.reportError.mockClear();
    pendingReportCallback = undefined;
    pendingKeepAliveCallback = undefined;
    (config as { collectorHeartbeatPeriod: number }).collectorHeartbeatPeriod = 20;
    client = new ServiceManagementClient();
    client.prepare();
    client.statusChanged(GRPCChannelStatus.CONNECTED);
    client.boot();
  });

  afterEach(() => {
    client.shutdown();
    jest.useRealTimers();
  });

  describe('upstream gRPC deadline', () => {
    it('passes grpcUpstreamDeadlineMs() as deadline on heartbeat RPCs', () => {
      jest.advanceTimersByTime(20_000);

      expect(mockGrpcUpstreamDeadlineMs).toHaveBeenCalled();
      expect(mockReportInstanceProperties).toHaveBeenCalledTimes(1);
      expect(mockKeepAlive).not.toHaveBeenCalled();

      const reportOpts = mockReportInstanceProperties.mock.calls[0][2];
      expect(reportOpts).toEqual({ deadline: 9_876_543_210 });

      mockReportInstanceProperties.mockClear();
      mockKeepAlive.mockClear();
      jest.advanceTimersByTime(20_000);

      expect(mockKeepAlive).toHaveBeenCalledTimes(1);
      expect(mockKeepAlive.mock.calls[0][2]).toEqual({ deadline: 9_876_543_210 });
    });
  });

  describe('collector heartbeat period (Java HEARTBEAT_PERIOD)', () => {
    it('uses collectorHeartbeatPeriod seconds for timer interval', () => {
      (config as { collectorHeartbeatPeriod: number }).collectorHeartbeatPeriod = 5;
      client.shutdown();
      client = new ServiceManagementClient();
      client.prepare();
      client.statusChanged(GRPCChannelStatus.CONNECTED);
      client.boot();

      jest.advanceTimersByTime(4_999);
      expect(mockReportInstanceProperties).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(mockReportInstanceProperties).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown late callback safety (H2)', () => {
    it('does not call reportError when RPC callback fires after shutdown', () => {
      mockReportInstanceProperties.mockImplementationOnce((_req, _meta, _opts, cb) => {
        pendingReportCallback = cb;
      });

      jest.advanceTimersByTime(20_000);
      expect(pendingReportCallback).toBeDefined();

      client.shutdown();
      expect(() => pendingReportCallback?.(new Error('UNAVAILABLE'))).not.toThrow();
      expect(mockChannelManager.reportError).not.toHaveBeenCalled();
    });
  });
});
