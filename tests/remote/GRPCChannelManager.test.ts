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
import GRPCChannelManager from '../../src/agent/core/remote/GRPCChannelManager';
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

describe('GRPCChannelManager (native grpc-js multi-backend failover)', () => {
  const originalCollector = config.collectorAddress;
  const originalSecure = config.secure;

  beforeEach(() => {
    jest.clearAllMocks();
    installChannelMock();
    mockWatchConnectivityState.mockImplementation(() => undefined);
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);
    mockIsConnected.mockReturnValue(true);
    config.collectorAddress = '127.0.0.1:11800';
    config.secure = false;
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    config.collectorAddress = originalCollector;
    config.secure = originalSecure;
    jest.restoreAllMocks();
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
});
