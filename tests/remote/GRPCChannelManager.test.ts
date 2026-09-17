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
import * as BackendAddressResolver from '../../src/agent/core/remote/BackendAddressResolver';
import GRPCChannelManager, { dnsReResolveIntervalMs } from '../../src/agent/core/remote/GRPCChannelManager';
import { GRPCChannelStatus } from '../../src/agent/core/remote/GRPCChannelStatus';
import config from '../../src/config/AgentConfig';

const mockShutdownNow = jest.fn();
const mockGetConnectivityState = jest.fn();
const mockWatchConnectivityState = jest.fn();
const mockIsConnected = jest.fn(() => true);
const mockNewBuilder = jest.fn();
const mockWithChannelOptions = jest.fn().mockReturnThis();

jest.mock('../../src/agent/core/remote/GRPCChannel', () => ({
  __esModule: true,
  default: {
    newBuilder: (...args: unknown[]) => mockNewBuilder(...args),
  },
}));

function installChannelMock(): void {
  mockNewBuilder.mockImplementation(() => ({
    withChannelOptions: mockWithChannelOptions,
    addManagedChannelBuilder: jest.fn().mockReturnThis(),
    addChannelDecorator: jest.fn().mockReturnThis(),
    build: jest.fn(() => ({
      getChannel: () => ({
        getConnectivityState: mockGetConnectivityState,
        watchConnectivityState: mockWatchConnectivityState,
      }),
      getClientOptions: () => ({ channelOverride: {} }),
      isConnected: mockIsConnected,
      getConnectivityState: mockGetConnectivityState,
      shutdownNow: mockShutdownNow,
    })),
  }));
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

/** ExpandBackendResult helper for DNS mocks. */
function dnsExpand(addresses: string[], hadLookupFailure = false) {
  return { addresses, hadLookupFailure, byConfigured: new Map<string, string[]>() };
}

describe('GRPCChannelManager (native grpc-js multi-backend failover)', () => {
  const originalCollector = config.collectorAddress;
  const originalSecure = config.secure;
  const originalTrustedCaPath = config.sslTrustedCaPath;
  const originalKeyPath = config.sslKeyPath;
  const originalCertChainPath = config.sslCertChainPath;
  const originalTargetNameOverride = config.sslTargetNameOverride;
  const originalResolveDns = config.isResolveDnsPeriodically;

  beforeEach(() => {
    jest.clearAllMocks();
    installChannelMock();
    mockWatchConnectivityState.mockImplementation(() => undefined);
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    mockIsConnected.mockReturnValue(true);
    config.collectorAddress = '127.0.0.1:11800';
    config.secure = false;
    config.isResolveDnsPeriodically = false;
    delete process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS;
    delete process.env.SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL;
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    config.collectorAddress = originalCollector;
    config.secure = originalSecure;
    config.sslTrustedCaPath = originalTrustedCaPath;
    config.sslKeyPath = originalKeyPath;
    config.sslCertChainPath = originalCertChainPath;
    config.sslTargetNameOverride = originalTargetNameOverride;
    config.isResolveDnsPeriodically = originalResolveDns;
    delete process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS;
    delete process.env.SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('dnsReResolveIntervalMs falls back when seconds overflow the Node timer limit', () => {
    process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS = '2592000';
    expect(dnsReResolveIntervalMs()).toBe(30_000);
    process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS = '60';
    expect(dnsReResolveIntervalMs()).toBe(60_000);
  });

  it('dnsReResolveIntervalMs rejects non-integer interval strings', () => {
    for (const raw of ['1.5', '1e3', '10junk', '-1', '0', '']) {
      process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS = raw;
      expect(dnsReResolveIntervalMs()).toBe(30_000);
    }
  });

  it('notifies CONNECTED when channel is READY after boot', () => {
    const listener = { statusChanged: jest.fn() };
    const manager = new GRPCChannelManager();
    manager.addChannelListener(listener);
    manager.boot();
    expect(mockNewBuilder).toHaveBeenCalled();
    expect(mockWatchConnectivityState).toHaveBeenCalled();
    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.CONNECTED);
    expect(mockWithChannelOptions).toHaveBeenCalled();
    const options = mockWithChannelOptions.mock.calls[0][0];
    expect(options['grpc.enable_http_proxy']).toBe(0);
    expect(options['grpc.keepalive_time_ms']).toBeUndefined();
    manager.shutdown();
  });

  it('uses plain host:port target for a single backend', () => {
    config.collectorAddress = 'oap.example.com:11800';
    const manager = new GRPCChannelManager();
    manager.boot();
    expect(mockNewBuilder.mock.calls[0][0]).toBe('oap.example.com:11800');
    manager.shutdown();
  });

  it('builds sw-static multi-address target for multiple backends', () => {
    config.collectorAddress = '10.0.0.1:11800,10.0.0.2:11800';
    const manager = new GRPCChannelManager();
    manager.boot();
    const target = mockNewBuilder.mock.calls[0][0] as string;
    expect(target.startsWith('sw-static:///')).toBe(true);
    expect(target).toContain('10.0.0.1:11800');
    expect(target).toContain('10.0.0.2:11800');
    manager.shutdown();
  });

  it('preserves config address order in the channel target (LB shuffles endpoints)', () => {
    config.collectorAddress = 'a:11800,b:11800';
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const manager = new GRPCChannelManager();
    manager.boot();
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///a:11800,b:11800');
    manager.shutdown();
  });

  it('preserves address order under TLS for stable authority', () => {
    config.secure = true;
    config.collectorAddress = 'a:11800,b:11800';
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    const manager = new GRPCChannelManager();
    manager.boot();
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///a:11800,b:11800');
    manager.shutdown();
  });

  it('notifies DISCONNECT when collector addresses are empty', () => {
    config.collectorAddress = '';
    const listener = { statusChanged: jest.fn() };
    const manager = new GRPCChannelManager();
    manager.addChannelListener(listener);
    manager.boot();
    expect(mockNewBuilder).not.toHaveBeenCalled();
    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.DISCONNECT);
    manager.shutdown();
  });

  it('does not rebuild on network error while READY', () => {
    const manager = new GRPCChannelManager();
    manager.boot();
    mockNewBuilder.mockClear();
    mockShutdownNow.mockClear();
    manager.reportError({ code: grpc.status.UNAVAILABLE, message: 'transient' });
    expect(mockNewBuilder).not.toHaveBeenCalled();
    expect(mockShutdownNow).not.toHaveBeenCalled();
    manager.shutdown();
  });

  it('does not rebuild on UNAUTHENTICATED (auth is not fixed by rotating backends)', () => {
    config.collectorAddress = 'a:11800,b:11800';
    const manager = new GRPCChannelManager();
    manager.boot();
    const targetBefore = mockNewBuilder.mock.calls[0][0];
    mockNewBuilder.mockClear();
    manager.reportError({ code: grpc.status.UNAUTHENTICATED, message: 'bad token' });
    expect(mockNewBuilder).not.toHaveBeenCalled();
    expect(targetBefore).toContain('sw-static:///');
    manager.shutdown();
  });

  it('does not treat CONNECTING as DISCONNECT', () => {
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.CONNECTING);
    const listener = { statusChanged: jest.fn() };
    const manager = new GRPCChannelManager();
    manager.addChannelListener(listener);
    manager.boot();
    expect(mockNewBuilder).toHaveBeenCalled();
    expect(mockWatchConnectivityState).toHaveBeenCalled();
    expect(listener.statusChanged).not.toHaveBeenCalledWith(GRPCChannelStatus.DISCONNECT);
    expect(listener.statusChanged).not.toHaveBeenCalledWith(GRPCChannelStatus.CONNECTED);
    manager.shutdown();
  });

  it('treats READY then IDLE as DISCONNECT', () => {
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    const listener = { statusChanged: jest.fn() };
    const manager = new GRPCChannelManager();
    manager.addChannelListener(listener);
    manager.boot();
    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.CONNECTED);

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.IDLE);
    const watchCb = mockWatchConnectivityState.mock.calls[0][2] as (err?: Error) => void;
    watchCb();
    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.DISCONNECT);
    manager.shutdown();
  });

  it('does not call DNS expand when isResolveDnsPeriodically is false', async () => {
    const expandSpy = jest.spyOn(BackendAddressResolver, 'expandBackendAddresses');
    config.collectorAddress = 'oap-a:11800,oap-b:11800';
    config.isResolveDnsPeriodically = false;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(expandSpy).not.toHaveBeenCalled();
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///oap-a:11800,oap-b:11800');
    manager.shutdown();
  });

  it('expands multi-hostname backends when isResolveDnsPeriodically is true', async () => {
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    config.secure = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(mockNewBuilder).toHaveBeenCalled();
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///10.0.0.1:11800,10.0.0.2:11800');
    const options = mockWithChannelOptions.mock.calls[0][0];
    expect(options['grpc.default_authority']).toBe('oap-a.svc');
    expect(options['grpc.ssl_target_name_override']).toBe('oap-a.svc');
    manager.shutdown();
  });

  it('preserves HTTP/2 default_authority on plaintext after DNS expand', async () => {
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    config.secure = false;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    const options = mockWithChannelOptions.mock.calls[0][0];
    expect(options['grpc.default_authority']).toBe('oap-a.svc');
    expect(options['grpc.ssl_target_name_override']).toBeUndefined();
    manager.shutdown();
  });

  it('keeps plaintext default_authority even when a TLS-only sslTargetNameOverride is set', async () => {
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    config.secure = false;
    config.sslTargetNameOverride = 'custom.oap.example';
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    const options = mockWithChannelOptions.mock.calls[0][0];
    expect(options['grpc.default_authority']).toBe('oap-a.svc');
    expect(options['grpc.ssl_target_name_override']).toBeUndefined();
    manager.shutdown();
  });

  it('uses sw-static even when DNS expand yields a single IP', async () => {
    jest.spyOn(BackendAddressResolver, 'expandBackendAddresses').mockResolvedValue(dnsExpand(['10.0.0.1:11800']));
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///10.0.0.1:11800');
    manager.shutdown();
  });

  it('starts the DNS timer before the initial expand finishes', async () => {
    jest.useFakeTimers();
    let resolveExpand: (value: ReturnType<typeof dnsExpand>) => void = () => undefined;
    jest.spyOn(BackendAddressResolver, 'expandBackendAddresses').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExpand = resolve;
        }),
    );
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    expect(setIntervalSpy).toHaveBeenCalled();
    expect(setIntervalSpy.mock.results[0]?.value?.unref).toEqual(expect.any(Function));
    const handle = setIntervalSpy.mock.results[0]?.value as NodeJS.Timeout;
    expect(typeof handle.unref).toBe('function');

    resolveExpand(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    await flushAsyncWork();
    expect(mockNewBuilder).toHaveBeenCalled();
    manager.shutdown();
  });

  it('skips overlapping DNS ticks while a refresh is in flight', async () => {
    jest.useFakeTimers();
    let resolveFirst: (value: ReturnType<typeof dnsExpand>) => void = () => undefined;
    const expandSpy = jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    // Ticks during in-flight expand must not queue a busy-loop of immediate re-resolves.
    jest.advanceTimersByTime(30_000);
    jest.advanceTimersByTime(30_000);
    expect(expandSpy).toHaveBeenCalledTimes(1);

    resolveFirst(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    await flushAsyncWork();
    expect(expandSpy).toHaveBeenCalledTimes(1);
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///10.0.0.1:11800,10.0.0.2:11800');

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();
    expect(expandSpy).toHaveBeenCalledTimes(2);
    expect(mockNewBuilder.mock.calls[mockNewBuilder.mock.calls.length - 1][0]).toBe(
      'sw-static:///10.0.0.1:11800,10.0.0.3:11800',
    );
    manager.shutdown();
  });

  it('runs the next DNS refresh on the following interval after in-flight completes', async () => {
    jest.useFakeTimers();
    let resolveFirst: (value: ReturnType<typeof dnsExpand>) => void = () => undefined;
    const expandSpy = jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.4:11800']));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();

    resolveFirst(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    await flushAsyncWork();
    expect(expandSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();
    expect(expandSpy).toHaveBeenCalledTimes(2);

    manager.shutdown();
  });

  it('rebuilds the channel when periodic DNS re-resolve changes the address set', async () => {
    jest.useFakeTimers();
    const expandSpy = jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    mockNewBuilder.mockClear();
    mockShutdownNow.mockClear();

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(expandSpy).toHaveBeenCalledTimes(2);
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///10.0.0.1:11800,10.0.0.3:11800');
    expect(mockShutdownNow).toHaveBeenCalled();
    manager.shutdown();
  });

  it('does not rebuild when periodic DNS re-resolve returns the same set', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    mockNewBuilder.mockClear();
    mockShutdownNow.mockClear();

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(mockNewBuilder).not.toHaveBeenCalled();
    expect(mockShutdownNow).not.toHaveBeenCalled();
    manager.shutdown();
  });

  it('does not expand DNS for a single hostname even when the flag is true', async () => {
    const expandSpy = jest.spyOn(BackendAddressResolver, 'expandBackendAddresses');
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    config.collectorAddress = 'oap.example.com:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(expandSpy).not.toHaveBeenCalled();
    expect(mockNewBuilder.mock.calls[0][0]).toBe('oap.example.com:11800');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    manager.shutdown();
  });

  it('does not expand DNS for all-IP multi-address lists when the flag is true', async () => {
    const expandSpy = jest.spyOn(BackendAddressResolver, 'expandBackendAddresses');
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    config.collectorAddress = '10.0.0.1:11800,10.0.0.2:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(expandSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    manager.shutdown();
  });

  it('keeps the existing channel when a later DNS expand returns no addresses', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand([]));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    mockNewBuilder.mockClear();
    mockShutdownNow.mockClear();

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(mockNewBuilder).not.toHaveBeenCalled();
    expect(mockShutdownNow).not.toHaveBeenCalled();
    manager.shutdown();
  });

  it('prefers sslTargetNameOverride over auto DNS authority', async () => {
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    config.secure = true;
    config.sslTargetNameOverride = 'custom.oap.example';
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    const options = mockWithChannelOptions.mock.calls[0][0];
    expect(options['grpc.default_authority']).toBeUndefined();
    expect(options['grpc.ssl_target_name_override']).toBeUndefined();
    manager.shutdown();
  });

  it('uses the first hostname in a mixed IP+hostname list as TLS authority', async () => {
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    config.collectorAddress = '10.0.0.9:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    config.secure = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    const options = mockWithChannelOptions.mock.calls[0][0];
    expect(options['grpc.default_authority']).toBe('oap-b.svc');
    expect(options['grpc.ssl_target_name_override']).toBe('oap-b.svc');
    manager.shutdown();
  });

  it('clears the DNS refresh timer on shutdown', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(setIntervalSpy).toHaveBeenCalled();
    const timerHandle = setIntervalSpy.mock.results[0]?.value as NodeJS.Timeout;
    expect(typeof timerHandle.unref).toBe('function');

    manager.shutdown();
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);
  });

  it('retries open on the next tick after a failed channel build', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));

    let buildAttempts = 0;
    mockNewBuilder.mockImplementation(() => ({
      withChannelOptions: mockWithChannelOptions,
      addManagedChannelBuilder: jest.fn().mockReturnThis(),
      addChannelDecorator: jest.fn().mockReturnThis(),
      build: jest.fn(() => {
        buildAttempts += 1;
        if (buildAttempts === 1) {
          throw new Error('tls boom');
        }
        return {
          getChannel: () => ({
            getConnectivityState: mockGetConnectivityState,
            watchConnectivityState: mockWatchConnectivityState,
          }),
          getClientOptions: () => ({ channelOverride: {} }),
          isConnected: mockIsConnected,
          getConnectivityState: mockGetConnectivityState,
          shutdownNow: mockShutdownNow,
        };
      }),
    }));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(buildAttempts).toBe(1);
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);

    mockNewBuilder.mockClear();
    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(buildAttempts).toBe(2);
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///10.0.0.1:11800,10.0.0.2:11800');
    manager.shutdown();
  });

  it('keeps the existing channel when a DNS rebuild build fails', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']));

    let buildAttempts = 0;
    mockNewBuilder.mockImplementation(() => ({
      withChannelOptions: mockWithChannelOptions,
      addManagedChannelBuilder: jest.fn().mockReturnThis(),
      addChannelDecorator: jest.fn().mockReturnThis(),
      build: jest.fn(() => {
        buildAttempts += 1;
        if (buildAttempts === 2) {
          throw new Error('rebuild boom');
        }
        return {
          getChannel: () => ({
            getConnectivityState: mockGetConnectivityState,
            watchConnectivityState: mockWatchConnectivityState,
          }),
          getClientOptions: () => ({ channelOverride: {} }),
          isConnected: mockIsConnected,
          getConnectivityState: mockGetConnectivityState,
          shutdownNow: mockShutdownNow,
        };
      }),
    }));

    const listener = { statusChanged: jest.fn() };
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.addChannelListener(listener);
    manager.boot();
    await flushAsyncWork();
    expect(buildAttempts).toBe(1);
    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.CONNECTED);
    listener.statusChanged.mockClear();
    mockShutdownNow.mockClear();
    mockNewBuilder.mockClear();

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    // Failed rebuild must not tear down the working channel or flap listeners.
    expect(buildAttempts).toBe(2);
    expect(mockShutdownNow).not.toHaveBeenCalled();
    expect(listener.statusChanged).not.toHaveBeenCalled();
    expect(() => manager.getClientOptions()).not.toThrow();

    mockNewBuilder.mockClear();
    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(buildAttempts).toBe(3);
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///10.0.0.1:11800,10.0.0.3:11800');
    expect(listener.statusChanged.mock.calls.map((c) => c[0])).toEqual([
      GRPCChannelStatus.DISCONNECT,
      GRPCChannelStatus.CONNECTED,
    ]);
    manager.shutdown();
  });

  it('keeps the existing channel when a later DNS expand has partial lookup failure', async () => {
    jest.useFakeTimers();
    // Merged dial set unchanged (failed name kept last-known IPs) → no rebuild.
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800'], true));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    mockNewBuilder.mockClear();
    mockShutdownNow.mockClear();

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(mockNewBuilder).not.toHaveBeenCalled();
    expect(mockShutdownNow).not.toHaveBeenCalled();
    expect(manager.getResolvedBackends()).toEqual(['10.0.0.1:11800', '10.0.0.2:11800']);
    manager.shutdown();
  });

  it('rebuilds when a successful name changes IP even if another name fails DNS', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      // oap-a moved to .9; oap-b failed but last-known .2 kept in the merged set.
      .mockResolvedValueOnce(dnsExpand(['10.0.0.9:11800', '10.0.0.2:11800'], true));

    mockIsConnected.mockReturnValue(false);
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.TRANSIENT_FAILURE);

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    mockNewBuilder.mockClear();

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(mockNewBuilder).toHaveBeenCalledTimes(1);
    expect(mockNewBuilder.mock.calls[0][0]).toBe('sw-static:///10.0.0.9:11800,10.0.0.2:11800');
    manager.shutdown();
  });

  it('forces DISCONNECT then CONNECTED so listeners drop stubs on DNS rebuild', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']));

    const listener = { statusChanged: jest.fn() };
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.addChannelListener(listener);
    manager.boot();
    await flushAsyncWork();
    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.CONNECTED);
    listener.statusChanged.mockClear();

    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(listener.statusChanged.mock.calls.map((c) => c[0])).toEqual([
      GRPCChannelStatus.DISCONNECT,
      GRPCChannelStatus.CONNECTED,
    ]);
    manager.shutdown();
  });

  it('keeps rebuild status-log suppress until async READY after DNS rebuild', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']));

    const watchCallbacks: Array<(error?: Error) => void> = [];
    mockWatchConnectivityState.mockImplementation((_state, _deadline, cb: (error?: Error) => void) => {
      watchCallbacks.push(cb);
    });

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(false);
    expect(manager.getDnsRefreshCount()).toBe(1);

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.CONNECTING);
    watchCallbacks.length = 0;
    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();

    expect(manager.getDnsRefreshCount()).toBe(2);
    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(true);

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    const latestWatch = watchCallbacks[watchCallbacks.length - 1];
    expect(latestWatch).toBeDefined();
    latestWatch!();
    await flushAsyncWork();

    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(false);
    manager.shutdown();
  });

  it('clears rebuild status-log suppress when new channel fails without READY', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']));

    const watchCallbacks: Array<(error?: Error) => void> = [];
    mockWatchConnectivityState.mockImplementation((_state, _deadline, cb: (error?: Error) => void) => {
      watchCallbacks.push(cb);
    });

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.CONNECTING);
    watchCallbacks.length = 0;
    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();
    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(true);

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.TRANSIENT_FAILURE);
    watchCallbacks[watchCallbacks.length - 1]!();
    await flushAsyncWork();

    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(false);
    manager.shutdown();
  });

  it('logs an outage when DNS rebuild replacement stays in TRANSIENT_FAILURE', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']));

    const watchCallbacks: Array<(error?: Error) => void> = [];
    mockWatchConnectivityState.mockImplementation((_state, _deadline, cb: (error?: Error) => void) => {
      watchCallbacks.push(cb);
    });

    const outageSpy = jest.spyOn(
      GRPCChannelManager.prototype as unknown as { logDnsRebuildFailedToConnect: () => void },
      'logDnsRebuildFailedToConnect',
    );

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.CONNECTING);
    watchCallbacks.length = 0;
    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();
    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(true);
    expect(outageSpy).not.toHaveBeenCalled();

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.TRANSIENT_FAILURE);
    watchCallbacks[watchCallbacks.length - 1]!();
    await flushAsyncWork();

    expect(outageSpy).toHaveBeenCalled();
    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(false);
    outageSpy.mockRestore();
    manager.shutdown();
  });

  it('logs an outage when a second DNS rebuild fails while already DISCONNECT', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.3:11800']))
      .mockResolvedValueOnce(dnsExpand(['10.0.0.1:11800', '10.0.0.4:11800']));

    const watchCallbacks: Array<(error?: Error) => void> = [];
    mockWatchConnectivityState.mockImplementation((_state, _deadline, cb: (error?: Error) => void) => {
      watchCallbacks.push(cb);
    });

    const outageSpy = jest.spyOn(
      GRPCChannelManager.prototype as unknown as { logDnsRebuildFailedToConnect: () => void },
      'logDnsRebuildFailedToConnect',
    );

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();

    // First rebuild: CONNECTED → quiet DISCONNECT, stuck in CONNECTING.
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.CONNECTING);
    watchCallbacks.length = 0;
    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();
    expect((manager as unknown as { lastStatus: GRPCChannelStatus }).lastStatus).toBe(GRPCChannelStatus.DISCONNECT);
    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(true);
    expect(outageSpy).not.toHaveBeenCalled();

    // Second rebuild while still DISCONNECT/CONNECTING; replacement then fails.
    watchCallbacks.length = 0;
    jest.advanceTimersByTime(30_000);
    await flushAsyncWork();
    expect((manager as unknown as { suppressDnsRebuildStatusLog: boolean }).suppressDnsRebuildStatusLog).toBe(true);

    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.TRANSIENT_FAILURE);
    watchCallbacks[watchCallbacks.length - 1]!();
    await flushAsyncWork();

    expect(outageSpy).toHaveBeenCalled();
    outageSpy.mockRestore();
    manager.shutdown();
  });

  it('honors SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS for the refresh timer', async () => {
    jest.useFakeTimers();
    const previousInterval = process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS;
    process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS = '5';
    try {
      jest
        .spyOn(BackendAddressResolver, 'expandBackendAddresses')
        .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
      config.isResolveDnsPeriodically = true;
      const manager = new GRPCChannelManager();
      manager.boot();
      await flushAsyncWork();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
      manager.shutdown();
    } finally {
      if (previousInterval === undefined) {
        delete process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS;
      } else {
        process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS = previousInterval;
      }
    }
  });

  it('honors SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL as a Java-aligned alias', async () => {
    jest.useFakeTimers();
    const previousDns = process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS;
    const previousJava = process.env.SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL;
    delete process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS;
    process.env.SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL = '7';
    try {
      jest
        .spyOn(BackendAddressResolver, 'expandBackendAddresses')
        .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
      config.isResolveDnsPeriodically = true;
      const manager = new GRPCChannelManager();
      manager.boot();
      await flushAsyncWork();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 7_000);
      manager.shutdown();
    } finally {
      if (previousDns === undefined) {
        delete process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS;
      } else {
        process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS = previousDns;
      }
      if (previousJava === undefined) {
        delete process.env.SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL;
      } else {
        process.env.SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL = previousJava;
      }
    }
  });

  it('exposes resolved IP backends after DNS expand', async () => {
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.boot();
    await flushAsyncWork();
    expect(manager.getResolvedBackends()).toEqual(['10.0.0.1:11800', '10.0.0.2:11800']);
    manager.shutdown();
  });

  it('discards a channel built after shutdown', async () => {
    const manager = new GRPCChannelManager();
    let resolveExpand: (value: ReturnType<typeof dnsExpand>) => void = () => undefined;
    jest.spyOn(BackendAddressResolver, 'expandBackendAddresses').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExpand = resolve;
        }),
    );

    mockNewBuilder.mockImplementation(() => ({
      withChannelOptions: mockWithChannelOptions,
      addManagedChannelBuilder: jest.fn().mockReturnThis(),
      addChannelDecorator: jest.fn().mockReturnThis(),
      build: jest.fn(() => {
        manager.shutdown();
        return {
          getChannel: () => ({
            getConnectivityState: mockGetConnectivityState,
            watchConnectivityState: mockWatchConnectivityState,
          }),
          getClientOptions: () => ({ channelOverride: {} }),
          isConnected: mockIsConnected,
          getConnectivityState: mockGetConnectivityState,
          shutdownNow: mockShutdownNow,
        };
      }),
    }));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    manager.boot();
    resolveExpand(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));
    await flushAsyncWork();

    expect(mockShutdownNow).toHaveBeenCalled();
    expect(() => manager.getClientOptions()).toThrow(/not available/);
  });

  it('does not commit resolved backends when shutdown races after channel install', async () => {
    jest
      .spyOn(BackendAddressResolver, 'expandBackendAddresses')
      .mockResolvedValue(dnsExpand(['10.0.0.1:11800', '10.0.0.2:11800']));

    config.collectorAddress = 'oap-a.svc:11800,oap-b.svc:11800';
    config.isResolveDnsPeriodically = true;
    const manager = new GRPCChannelManager();
    manager.addChannelListener({
      statusChanged: () => {
        // Race during openChannel notify after the channel is installed.
        manager.shutdown();
      },
    });
    manager.boot();
    await flushAsyncWork();

    expect(manager.getResolvedBackends()).toEqual([]);
    expect(() => manager.getClientOptions()).toThrow(/not available/);
  });
});
