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

import * as grpc from '@grpc/grpc-js';
import config from '../../src/config/AgentConfig';
import * as resolver from '../../src/agent/core/remote/BackendAddressResolver';
import GRPCChannelManager from '../../src/agent/core/remote/GRPCChannelManager';
import { GRPCChannelStatus } from '../../src/agent/core/remote/GRPCChannelStatus';
import GRPCChannel from '../../src/agent/core/remote/GRPCChannel';

const mockPreloadTlsMaterials = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/agent/core/remote/TLSChannelBuilder', () => {
  const actual = jest.requireActual('../../src/agent/core/remote/TLSChannelBuilder');
  return {
    __esModule: true,
    ...actual,
    preloadTlsMaterials: (...args: unknown[]) => mockPreloadTlsMaterials(...args),
  };
});

const mockShutdownNow = jest.fn();
const mockIsConnected = jest.fn((_force?: boolean) => true);
const mockBuild = jest.fn(() => ({
  getChannel: () => ({
    getConnectivityState: jest.fn(() => grpc.connectivityState.READY),
    watchConnectivityState: jest.fn(),
  }),
  getClientOptions: () => ({ channelOverride: { kind: 'mock-channel' }, interceptors: [] }),
  isConnected: (force?: boolean) => mockIsConnected(force),
  shutdownNow: mockShutdownNow,
}));

jest.mock('../../src/agent/core/remote/GRPCChannel', () => ({
  __esModule: true,
  default: {
    newBuilder: jest.fn(() => ({
      addManagedChannelBuilder: jest.fn().mockReturnThis(),
      addChannelDecorator: jest.fn().mockReturnThis(),
      build: mockBuild,
    })),
  },
}));

describe('GRPCChannelManager (Java DNS re-resolve parity)', () => {
  const originalCollector = config.collectorAddress;
  const originalResolveDns = config.isResolveDnsPeriodically;
  const originalCheckInterval = config.grpcChannelCheckInterval;
  const originalForcePeriod = config.forceReconnectionPeriod;
  let manager: GRPCChannelManager | null = null;
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    mockShutdownNow.mockClear();
    mockIsConnected.mockReset();
    mockIsConnected.mockImplementation((_force?: boolean) => true);
    randomSpy = jest.spyOn(Math, 'random');
  });

  afterEach(() => {
    jest.useRealTimers();
    manager?.shutdown();
    manager = null;
    config.collectorAddress = originalCollector;
    config.isResolveDnsPeriodically = originalResolveDns;
    config.grpcChannelCheckInterval = originalCheckInterval;
    config.forceReconnectionPeriod = originalForcePeriod;
    randomSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('returns logical hostname for stub when channel uses resolved IP', async () => {
    config.collectorAddress = 'oap:11800';
    config.isResolveDnsPeriodically = true;
    randomSpy.mockReturnValue(0);
    jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValue([{ target: '10.0.1.1:11800', tlsServerName: 'oap' }]);

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(manager.getGrpcServersForTest()).toEqual([{ target: '10.0.1.1:11800', tlsServerName: 'oap' }]);
    expect(manager.resolveAddress()).toBe('oap:11800');
  });
  it('resolveAddress returns current target after runCheck selects backend', async () => {
    config.collectorAddress = '127.0.0.1:11800';
    config.isResolveDnsPeriodically = false;
    randomSpy.mockReturnValue(0);

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(manager.resolveAddress()).toBe('127.0.0.1:11800');
    expect(manager.getSelectedIdxForTest()).toBe(0);
    expect(manager.getReconnectStateForTest()).toBe(false);
  });

  it('does not call DNS expand when isResolveDnsPeriodically is false', async () => {
    config.collectorAddress = 'fake-oap.local:11800';
    config.isResolveDnsPeriodically = false;
    const expandSpy = jest.spyOn(resolver, 'expandBackendAddresses');

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(expandSpy).not.toHaveBeenCalled();
    expect(manager.getGrpcServersForTest()).toEqual([{ target: 'fake-oap.local:11800' }]);
  });

  it('does not call DNS expand when reconnect is false (Java IS_RESOLVE_DNS && reconnect)', async () => {
    config.collectorAddress = 'fake-oap.local:11800';
    config.isResolveDnsPeriodically = true;
    randomSpy.mockReturnValue(0);

    const expandSpy = jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValue([{ target: '10.0.1.1:11800', tlsServerName: 'oap' }]);

    manager = new GRPCChannelManager();
    await manager.runCheck();
    expect(expandSpy).toHaveBeenCalledTimes(1);

    expandSpy.mockClear();
    await manager.runCheck();
    expect(expandSpy).not.toHaveBeenCalled();
  });

  it('runCheck refreshes grpcServers from DNS when reconnect is true', async () => {
    config.collectorAddress = 'fake-oap.local:11800';
    config.isResolveDnsPeriodically = true;
    randomSpy.mockReturnValue(0);

    jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValue([{ target: '10.0.1.1:11800' }, { target: '10.0.1.2:11800' }]);

    manager = new GRPCChannelManager();
    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);
    await manager.runCheck();

    expect(resolver.expandBackendAddresses).toHaveBeenCalledWith(['fake-oap.local:11800'], true);
    expect(manager.getGrpcServersForTest()).toEqual([{ target: '10.0.1.1:11800' }, { target: '10.0.1.2:11800' }]);
  });

  it('uses static comma-separated backends without DNS (Java split comma)', async () => {
    config.collectorAddress = '127.0.0.1:11800,10.0.0.2:11800';
    config.isResolveDnsPeriodically = false;
    randomSpy.mockReturnValue(0.99);

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(manager.getGrpcServersForTest()).toEqual([{ target: '127.0.0.1:11800' }, { target: '10.0.0.2:11800' }]);
    expect(manager.resolveAddress()).toBe('10.0.0.2:11800');
  });

  it('reportError sets reconnect on gRPC network errors', () => {
    config.collectorAddress = '127.0.0.1:11800';
    manager = new GRPCChannelManager();

    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);
    expect(manager.getReconnectStateForTest()).toBe(true);
  });

  it('reportError ignores non-network gRPC errors', async () => {
    config.collectorAddress = '127.0.0.1:11800';
    randomSpy.mockReturnValue(0);
    manager = new GRPCChannelManager();
    await manager.runCheck();
    expect(manager.getReconnectStateForTest()).toBe(false);

    const listener = jest.fn();
    manager.addChannelListener({ statusChanged: listener });

    manager.reportError({ code: grpc.status.INVALID_ARGUMENT, message: 'bad' } as grpc.ServiceError);
    expect(manager.getReconnectStateForTest()).toBe(false);
    expect(listener).not.toHaveBeenCalledWith(GRPCChannelStatus.DISCONNECT);
  });

  it('reportError does not reconnect on authentication failures (B-3)', async () => {
    config.collectorAddress = '127.0.0.1:11800';
    randomSpy.mockReturnValue(0);
    manager = new GRPCChannelManager();
    await manager.runCheck();
    expect(manager.getReconnectStateForTest()).toBe(false);

    const listener = jest.fn();
    manager.addChannelListener({ statusChanged: listener });

    manager.reportError({ code: grpc.status.PERMISSION_DENIED, message: 'denied' } as grpc.ServiceError);
    expect(manager.getReconnectStateForTest()).toBe(false);
    expect(listener).not.toHaveBeenCalledWith(GRPCChannelStatus.DISCONNECT);

    manager.reportError({ code: grpc.status.UNAUTHENTICATED, message: 'bad token' } as grpc.ServiceError);
    expect(manager.getReconnectStateForTest()).toBe(false);
  });

  it('reportError notifies DISCONNECT to listeners (Java notify DISCONNECT)', () => {
    config.collectorAddress = '127.0.0.1:11800';
    manager = new GRPCChannelManager();
    const listener = jest.fn();
    manager.addChannelListener({ statusChanged: listener });

    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);

    expect(listener).toHaveBeenCalledWith(GRPCChannelStatus.DISCONNECT);
    expect(manager.getLastStatusForTest()).toBe(GRPCChannelStatus.DISCONNECT);
  });

  it('keeps channel when DNS ip changes at same index (Java GRPCChannelManager parity)', async () => {
    config.collectorAddress = 'oap.test:11800';
    config.isResolveDnsPeriodically = true;
    config.forceReconnectionPeriod = 1;
    randomSpy.mockReturnValue(0);

    jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValueOnce([{ target: '10.0.1.1:11800' }])
      .mockResolvedValueOnce([{ target: '10.0.1.2:11800' }]);

    manager = new GRPCChannelManager();
    await manager.runCheck();
    expect(manager.resolveAddress()).toBe('oap.test:11800');
    expect(mockShutdownNow).not.toHaveBeenCalled();

    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);
    mockIsConnected.mockReturnValue(true);
    await manager.runCheck();

    expect(manager.resolveAddress()).toBe('oap.test:11800');
    expect(mockShutdownNow).not.toHaveBeenCalled();
    expect(manager.getSelectedIdxForTest()).toBe(0);
  });

  it('switches channel when random index changes (Java selectedIdx rotation)', async () => {
    config.collectorAddress = '127.0.0.1:11800,10.0.0.2:11800';
    config.isResolveDnsPeriodically = false;

    manager = new GRPCChannelManager();
    randomSpy.mockReturnValue(0);
    await manager.runCheck();
    expect(manager.getSelectedIdxForTest()).toBe(0);
    expect(mockShutdownNow).not.toHaveBeenCalled();

    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);
    randomSpy.mockReturnValue(0.99);
    await manager.runCheck();

    expect(manager.getSelectedIdxForTest()).toBe(1);
    expect(mockShutdownNow).toHaveBeenCalledTimes(1);
    expect(manager.resolveAddress()).toBe('10.0.0.2:11800');
  });

  it('clears reconnect on same index when forceReconnectionPeriod exceeded (Java FORCE_RECONNECTION_PERIOD)', async () => {
    config.collectorAddress = '127.0.0.1:11800';
    config.isResolveDnsPeriodically = false;
    config.forceReconnectionPeriod = 1;
    randomSpy.mockReturnValue(0);

    manager = new GRPCChannelManager();
    await manager.runCheck();
    expect(manager.getReconnectStateForTest()).toBe(false);

    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);
    mockIsConnected.mockImplementation((force?: boolean) => force === true);

    await manager.runCheck();
    expect(manager.getReconnectCountForTest()).toBe(1);
    expect(manager.getReconnectStateForTest()).toBe(true);

    await manager.runCheck();
    expect(manager.getReconnectStateForTest()).toBe(false);
    expect(manager.getReconnectCountForTest()).toBe(0);
  });

  it('keeps reconnect when DNS returns empty list', async () => {
    config.collectorAddress = 'missing.local:11800';
    config.isResolveDnsPeriodically = true;

    jest.spyOn(resolver, 'expandBackendAddresses').mockResolvedValue([]);

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(manager.getGrpcServersForTest()).toEqual([]);
    expect(manager.getReconnectStateForTest()).toBe(true);
  });

  it('recovers after DNS returns empty then later returns backends', async () => {
    config.collectorAddress = 'oap.test:11800';
    config.isResolveDnsPeriodically = true;
    randomSpy.mockReturnValue(0);

    jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ target: '10.0.1.1:11800' }]);

    manager = new GRPCChannelManager();
    await manager.runCheck();
    expect(manager.getGrpcServersForTest()).toEqual([]);
    expect(manager.getReconnectStateForTest()).toBe(true);

    await manager.runCheck();
    expect(manager.resolveAddress()).toBe('oap.test:11800');
    expect(manager.getReconnectStateForTest()).toBe(false);
  });

  it('rotates to next backend when same random index is unreachable', async () => {
    config.collectorAddress = '127.0.0.1:11800,10.0.0.2:11800';
    config.isResolveDnsPeriodically = false;
    config.forceReconnectionPeriod = 1;
    randomSpy.mockReturnValue(0);

    manager = new GRPCChannelManager();
    await manager.runCheck();
    expect(manager.getSelectedIdxForTest()).toBe(0);

    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);
    mockIsConnected.mockReturnValue(false);
    await manager.runCheck();

    expect(manager.getSelectedIdxForTest()).toBe(1);
    expect(mockShutdownNow).toHaveBeenCalledTimes(1);
    expect(manager.resolveAddress()).toBe('10.0.0.2:11800');
  });

  it('rotates among multiple DNS-expanded IPs on reconnect', async () => {
    config.collectorAddress = 'oap.test:11800';
    config.isResolveDnsPeriodically = true;

    jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValue([{ target: '10.0.1.1:11800' }, { target: '10.0.1.2:11800' }]);

    manager = new GRPCChannelManager();
    randomSpy.mockReturnValue(0);
    await manager.runCheck();
    expect(manager.resolveAddress()).toBe('oap.test:11800');

    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'fail' } as grpc.ServiceError);
    randomSpy.mockReturnValue(0.99);
    await manager.runCheck();
    expect(manager.resolveAddress()).toBe('oap.test:11800');
  });

  it('boot starts periodic check timer (Java GRPC_CHANNEL_CHECK_INTERVAL)', () => {
    jest.useFakeTimers();
    config.collectorAddress = '127.0.0.1:11800';
    config.grpcChannelCheckInterval = 5;
    randomSpy.mockReturnValue(0);

    manager = new GRPCChannelManager();
    manager.boot();

    expect(manager.hasCheckTimerForTest()).toBe(true);
    jest.advanceTimersByTime(5000);
  });

  it('boot skips timer when collector address is empty', () => {
    config.collectorAddress = '';
    manager = new GRPCChannelManager();
    manager.boot();
    expect(manager.hasCheckTimerForTest()).toBe(false);
  });

  it('shutdown clears check timer', () => {
    jest.useFakeTimers();
    config.collectorAddress = '127.0.0.1:11800';
    manager = new GRPCChannelManager();
    manager.boot();
    expect(manager.hasCheckTimerForTest()).toBe(true);
    manager.shutdown();
    expect(manager.hasCheckTimerForTest()).toBe(false);
  });

  describe('shutdown late async continuation safety (H2)', () => {
    it('does not build a channel when shutdown completes during DNS expand', async () => {
      config.collectorAddress = 'fake-oap.local:11800';
      config.isResolveDnsPeriodically = true;
      randomSpy.mockReturnValue(0);
      mockBuild.mockClear();
      (GRPCChannel.newBuilder as jest.Mock).mockClear();

      let resolveExpand!: (value: resolver.BackendTarget[]) => void;
      const expandPromise = new Promise<resolver.BackendTarget[]>((resolve) => {
        resolveExpand = resolve;
      });
      jest.spyOn(resolver, 'expandBackendAddresses').mockReturnValue(expandPromise);

      const listener = jest.fn();
      manager = new GRPCChannelManager();
      manager.addChannelListener({ statusChanged: listener });
      const runPromise = manager.runCheck();

      manager.shutdown();
      resolveExpand([{ target: '10.0.1.1:11800' }]);
      await runPromise;

      expect(mockBuild).not.toHaveBeenCalled();
      expect(GRPCChannel.newBuilder).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalledWith(GRPCChannelStatus.CONNECTED);
    });
  });
  it('resolveAddress brackets IPv6 literal targets for grpc client stubs', async () => {
    config.collectorAddress = '[::1]:11800';
    randomSpy.mockReturnValue(0);
    const newBuilderSpy = GRPCChannel.newBuilder as jest.Mock;

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(newBuilderSpy).toHaveBeenCalledWith('::1', 11800, undefined);
    expect(manager.resolveAddress()).toBe('[::1]:11800');
  });

  it('getClientOptions exposes channelOverride from managed channel (S-1)', async () => {
    config.collectorAddress = '127.0.0.1:11800';
    randomSpy.mockReturnValue(0);

    manager = new GRPCChannelManager();
    await manager.runCheck();

    const opts = manager.getClientOptions();
    expect(opts.channelOverride).toEqual({ kind: 'mock-channel' });
    expect(opts.interceptors).toEqual([]);
  });

  it('passes per-target tlsServerName to GRPCChannel.newBuilder', async () => {
    config.collectorAddress = 'oap:11800';
    config.isResolveDnsPeriodically = true;
    randomSpy.mockReturnValue(0);
    jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValue([{ target: '10.0.1.1:11800', tlsServerName: 'oap' }]);
    const newBuilderSpy = GRPCChannel.newBuilder as jest.Mock;

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(newBuilderSpy).toHaveBeenCalledWith('10.0.1.1', 11800, 'oap');
  });

  it('resolveAddress keeps hostname for DNS-expanded IPv6 (TLS SNI)', async () => {
    config.collectorAddress = 'oap.test:11800';
    config.isResolveDnsPeriodically = true;
    randomSpy.mockReturnValue(0);
    jest
      .spyOn(resolver, 'expandBackendAddresses')
      .mockResolvedValue([{ target: '[2001:db8::1]:11800', tlsServerName: 'oap.test' }]);

    manager = new GRPCChannelManager();
    await manager.runCheck();

    expect(manager.resolveAddress()).toBe('oap.test:11800');
  });

  it('does not leak channel when shutdown runs during preloadTlsMaterials', async () => {
    config.collectorAddress = '127.0.0.1:11800';
    randomSpy.mockReturnValue(0);
    let resolvePreload!: () => void;
    mockPreloadTlsMaterials.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePreload = resolve;
        }),
    );
    manager = new GRPCChannelManager();
    const switchPromise = (manager as any).switchToServer({ target: '127.0.0.1:11800' }, 0);
    await new Promise((r) => setImmediate(r));
    manager.shutdown();
    resolvePreload();
    await switchPromise;
    expect((manager as any).managedChannel).toBeNull();
  });

  it('uses Infinity deadline for connectivity watch', () => {
    const watchSpy = jest.fn();
    manager = new GRPCChannelManager();
    (manager as any).managedChannel = {
      getChannel: () => ({
        getConnectivityState: jest.fn(() => grpc.connectivityState.READY),
        watchConnectivityState: watchSpy,
      }),
      shutdownNow: jest.fn(),
    };
    (manager as any).watchConnectivityState();
    expect(watchSpy).toHaveBeenCalledWith(grpc.connectivityState.READY, Infinity, expect.any(Function));
  });
});
