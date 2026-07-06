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

const mockCollect = jest.fn();
const mockGrpcUpstreamDeadlineMs = jest.fn(() => 1_234_567_890);
let pendingCollectCallback: ((error: Error | null) => void) | undefined;

const mockChannelManager = {
  addChannelListener: jest.fn(),
  resolveAddress: jest.fn(() => '127.0.0.1:11800'),
  getClientOptions: jest.fn(() => ({ channelOverride: {} as never })),
  reportError: jest.fn(),
};

const mockStream = {
  write: jest.fn(),
  end: jest.fn(),
};

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: {
    maxBufferSize: 300,
    collectorAddress: '127.0.0.1:11800',
  },
}));

jest.mock('../../src/proto/language-agent/Tracing_grpc_pb', () => ({
  TraceSegmentReportServiceClient: jest.fn().mockImplementation(() => ({
    collect: jest.fn((_meta, opts, cb) => {
      pendingCollectCallback = cb;
      return mockCollect(_meta, opts, cb);
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
      findService: jest.fn(() => mockChannelManager),
    },
  },
}));

jest.mock('../../src/logging', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    _isDebugEnabled: false,
  }),
  throttled: () => jest.fn(),
}));

jest.mock('../../src/lib/EventEmitter', () => ({
  emitter: {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
  },
}));

import { emitter } from '../../src/lib/EventEmitter';
import TraceSegmentServiceClient from '../../src/agent/core/remote/TraceSegmentServiceClient';
import { TraceSegmentReportServiceClient } from '../../src/proto/language-agent/Tracing_grpc_pb';

describe('TraceSegmentServiceClient', () => {
  let client: TraceSegmentServiceClient;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCollect.mockClear();
    mockGrpcUpstreamDeadlineMs.mockClear();
    (TraceSegmentReportServiceClient as jest.Mock).mockClear();
    mockChannelManager.reportError.mockClear();
    mockStream.write.mockReset();
    mockStream.write.mockImplementation(() => undefined);
    mockStream.end.mockReset();
    mockStream.end.mockImplementation(() => undefined);
    pendingCollectCallback = undefined;
    mockCollect.mockImplementation((_meta, _opts, cb) => {
      pendingCollectCallback = cb;
      return mockStream;
    });
    client = new TraceSegmentServiceClient();
    client.prepare();
    client.statusChanged(GRPCChannelStatus.CONNECTED);
    client.boot();
  });

  afterEach(() => {
    client.shutdown();
    jest.useRealTimers();
  });

  it('does not ref report timer when buffer has segments (allows process exit)', () => {
    const segmentListener = (emitter.on as jest.Mock).mock.calls.find((call) => call[0] === 'segment-finished')?.[1];
    expect(segmentListener).toBeDefined();

    const timeout = (client as unknown as { timeout: NodeJS.Timeout }).timeout;
    expect(timeout).toBeDefined();
    const refSpy = jest.spyOn(timeout, 'ref');

    segmentListener?.({ transform: () => ({}) });

    expect(refSpy).not.toHaveBeenCalled();
    refSpy.mockRestore();
  });

  it('clears reporter stub on DISCONNECT', () => {
    client.statusChanged(GRPCChannelStatus.DISCONNECT);
    expect(TraceSegmentReportServiceClient).toHaveBeenCalledTimes(1);
  });

  it('passes grpcUpstreamDeadlineMs() as deadline on collect', async () => {
    (client as unknown as { buffer: unknown[] }).buffer.push({ transform: () => ({}) });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(mockGrpcUpstreamDeadlineMs).toHaveBeenCalled();
    expect(mockCollect).toHaveBeenCalledWith(expect.anything(), { deadline: 1_234_567_890 }, expect.any(Function));
  });

  it('re-queues with buffer cap when stream.write throws synchronously (B2)', async () => {
    mockStream.write.mockImplementation(() => {
      throw new Error('stream write failed');
    });

    (client as unknown as { buffer: unknown[] }).buffer.push({ transform: () => ({}) });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    const clientAny = client as unknown as { buffer: unknown[] };
    expect(clientAny.buffer.length).toBe(1);
    expect(mockChannelManager.reportError).toHaveBeenCalled();
  });

  it('discards batch when grpc callback fails after stream delivery (Java parity, B2)', async () => {
    (client as unknown as { buffer: unknown[] }).buffer.push({ transform: () => ({}) });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(pendingCollectCallback).toBeDefined();

    pendingCollectCallback?.(new Error('UNAVAILABLE'));
    await Promise.resolve();

    const clientAny = client as unknown as { buffer: unknown[] };
    expect(clientAny.buffer.length).toBe(0);
  });

  describe('shutdown late callback safety (H2)', () => {
    it('does not call reportError when collect callback fires after shutdown', async () => {
      (client as unknown as { buffer: unknown[] }).buffer.push({ transform: () => ({}) });

      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      expect(pendingCollectCallback).toBeDefined();

      client.shutdown();
      expect(() => pendingCollectCallback?.(new Error('UNAVAILABLE'))).not.toThrow();
      expect(mockChannelManager.reportError).not.toHaveBeenCalled();
    });
  });
});
