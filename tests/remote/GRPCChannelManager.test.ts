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

const mockShutdownNow = jest.fn();
const mockGetConnectivityState = jest.fn();
const mockWatchConnectivityState = jest.fn();

jest.mock('../../src/agent/core/remote/GRPCChannel', () => ({
  __esModule: true,
  default: {
    newBuilder: jest.fn(() => ({
      addManagedChannelBuilder: jest.fn().mockReturnThis(),
      addChannelDecorator: jest.fn().mockReturnThis(),
      build: jest.fn(() => ({
        getChannel: () => ({
          getConnectivityState: mockGetConnectivityState,
          watchConnectivityState: mockWatchConnectivityState,
        }),
        getClientOptions: () => ({ channelOverride: {} }),
        isConnected: jest.fn(() => true),
        shutdownNow: mockShutdownNow,
      })),
    })),
  },
}));

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: {
    collectorAddress: '127.0.0.1:11800',
  },
}));

describe('GRPCChannelManager initial connectivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWatchConnectivityState.mockImplementation(() => undefined);
  });

  it('notifies CONNECTED when channel is already READY at boot', () => {
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.READY);

    const listener = { statusChanged: jest.fn() };
    const manager = new GRPCChannelManager();

    manager.addChannelListener(listener);
    manager.boot();

    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.CONNECTED);
  });

  it('notifies DISCONNECT when channel is not READY at boot', () => {
    mockGetConnectivityState.mockReturnValue(grpc.connectivityState.CONNECTING);

    const listener = { statusChanged: jest.fn() };
    const manager = new GRPCChannelManager();

    manager.addChannelListener(listener);
    manager.boot();

    expect(listener.statusChanged).toHaveBeenCalledWith(GRPCChannelStatus.DISCONNECT);
  });
});
