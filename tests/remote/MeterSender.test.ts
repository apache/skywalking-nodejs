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
const mockGrpcUpstreamDeadlineMs = jest.fn(() => 5_432_109_876);
let pendingCollectCallback: ((error: Error | null) => void) | undefined;

const mockChannelManager = {
  addChannelListener: jest.fn(),
  resolveAddress: jest.fn(() => '127.0.0.1:11800'),
  getClientOptions: jest.fn(() => ({ channelOverride: {} as never })),
  reportError: jest.fn(),
};

const mockMeterData = {
  setService: jest.fn().mockReturnThis(),
  setServiceinstance: jest.fn().mockReturnThis(),
  setTimestamp: jest.fn().mockReturnThis(),
};

const mockStream = {
  write: jest.fn(),
  end: jest.fn(),
};

let sampleSequence = 0;
const mockSnapshot = () => ({ collectedAt: 1_000_000 + sampleSequence++ * 500, cpu: 1 });

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: {
    serviceName: 'meter-service',
    serviceInstance: 'meter-instance',
    runtimeMetricsCollectPeriod: 1000,
    runtimeMetricsReportPeriod: 1000,
    runtimeMetricsBufferSize: 600,
  },
}));

jest.mock('../../src/proto/language-agent/Meter_grpc_pb', () => ({
  MeterReportServiceClient: jest.fn().mockImplementation(() => ({
    collect: jest.fn((_meta, opts, cb) => {
      pendingCollectCallback = cb;
      return mockCollect(_meta, opts, cb);
    }),
  })),
}));

jest.mock('../../src/agent/core/meter/RuntimeMetricsCollector', () => {
  return jest.fn().mockImplementation(() => ({
    sample: jest.fn(() => mockSnapshot()),
    toMeterData: jest.fn(() => [mockMeterData, { ...mockMeterData }]),
    destroy: jest.fn(),
  }));
});

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

import * as grpc from '@grpc/grpc-js';
import MeterSender from '../../src/agent/core/meter/MeterSender';
import { MeterReportServiceClient } from '../../src/proto/language-agent/Meter_grpc_pb';

describe('MeterSender', () => {
  let sender: MeterSender;

  beforeEach(() => {
    jest.useFakeTimers();
    mockCollect.mockClear();
    mockGrpcUpstreamDeadlineMs.mockClear();
    mockChannelManager.reportError.mockClear();
    mockMeterData.setService.mockClear();
    mockMeterData.setServiceinstance.mockClear();
    mockMeterData.setTimestamp.mockClear();
    mockStream.write.mockReset();
    mockStream.end.mockReset();
    pendingCollectCallback = undefined;
    mockCollect.mockImplementation((_meta, _opts, cb) => {
      pendingCollectCallback = cb;
      return mockStream;
    });
    sender = new MeterSender();
    sender.prepare();
    sender.statusChanged(GRPCChannelStatus.CONNECTED);
    sender.boot();
  });

  afterEach(() => {
    sender.shutdown();
    jest.useRealTimers();
  });

  it('clears reporter stub on DISCONNECT', () => {
    sender.statusChanged(GRPCChannelStatus.DISCONNECT);
    expect(MeterReportServiceClient).toHaveBeenCalledTimes(1);
  });

  it('uses per-snapshot collectedAt timestamps (Java JVMService parity)', async () => {
    const senderAny = sender as unknown as { buffer: Array<{ collectedAt: number }> };
    senderAny.buffer.push({ collectedAt: 1_000_000, cpu: 1 } as never, { collectedAt: 2_000_000, cpu: 1 } as never);

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    const firstBatch = mockMeterData.setTimestamp.mock.calls.map((call) => call[0]);
    expect(firstBatch).toContain(1_000_000);
    expect(firstBatch).not.toContain(2_000_000);
    pendingCollectCallback?.(null);
    await Promise.resolve();

    mockMeterData.setTimestamp.mockClear();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    const secondBatch = mockMeterData.setTimestamp.mock.calls.map((call) => call[0]);
    expect(secondBatch).toContain(2_000_000);
  });

  it('sets service/instance/timestamp on every MeterData', async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(mockMeterData.setService).toHaveBeenCalledWith('meter-service');
    expect(mockMeterData.setServiceinstance).toHaveBeenCalledWith('meter-instance');
    expect(mockMeterData.setService).toHaveBeenCalledTimes(2);
    expect(mockMeterData.setServiceinstance).toHaveBeenCalledTimes(2);
    expect(mockMeterData.setTimestamp).toHaveBeenCalledTimes(2);
  });

  it('skips duplicate boot timers', () => {
    const collectTimer = (sender as unknown as { collectTimer?: NodeJS.Timeout }).collectTimer;
    const reportTimer = (sender as unknown as { reportTimer?: NodeJS.Timeout }).reportTimer;
    sender.boot();
    expect((sender as unknown as { collectTimer?: NodeJS.Timeout }).collectTimer).toBe(collectTimer);
    expect((sender as unknown as { reportTimer?: NodeJS.Timeout }).reportTimer).toBe(reportTimer);
  });

  it('re-queues with buffer cap when stream.write throws synchronously (M1)', async () => {
    mockStream.write.mockImplementation(() => {
      throw new Error('stream write failed');
    });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    const senderAny = sender as unknown as { buffer: unknown[]; maxBufferSize: () => number };
    expect(senderAny.buffer.length).toBeGreaterThan(0);
    expect(senderAny.buffer.length).toBeLessThanOrEqual(senderAny.maxBufferSize());
    expect(mockChannelManager.reportError).toHaveBeenCalled();
  });

  it('always ends stream and does not re-queue after partial writes (L1/L2, Java discard)', async () => {
    mockStream.write
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('partial write');
      });

    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(mockStream.end).toHaveBeenCalled();
    const senderAny = sender as unknown as { buffer: unknown[]; maxBufferSize: () => number };
    expect(senderAny.buffer.length).toBeLessThanOrEqual(senderAny.maxBufferSize());
    expect(senderAny.buffer.length).toBeLessThanOrEqual(2);
  });

  it('discards batch when grpc callback fails after stream delivery (Java JVM parity, L2)', async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(pendingCollectCallback).toBeDefined();

    const bufferBeforeCallback = (sender as unknown as { buffer: unknown[] }).buffer.length;
    pendingCollectCallback?.(new Error('UNAVAILABLE'));
    await Promise.resolve();

    const senderAny = sender as unknown as { buffer: unknown[]; maxBufferSize: () => number };
    expect(senderAny.buffer.length).toBeLessThanOrEqual(senderAny.maxBufferSize());
    expect(senderAny.buffer.length).toBeLessThanOrEqual(bufferBeforeCallback + 1);
  });

  it('enforces buffer cap when failed report re-queues snapshots (B1)', () => {
    const senderAny = sender as unknown as {
      buffer: unknown[];
      requeueSnapshots: (snapshots: unknown[]) => void;
      maxBufferSize: () => number;
    };
    const maxSize = senderAny.maxBufferSize();
    const failedBatch = Array.from({ length: maxSize }, (_, index) => ({ failed: index }));
    senderAny.buffer.push(...Array.from({ length: 100 }, (_, index) => ({ live: index })));

    senderAny.requeueSnapshots(failedBatch);

    expect(senderAny.buffer.length).toBe(maxSize);
  });

  it('disables meter reporting when OAP returns UNIMPLEMENTED (Java MeterSender parity)', async () => {
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(pendingCollectCallback).toBeDefined();

    const err = Object.assign(new Error('Meter API unimplemented'), { code: grpc.status.UNIMPLEMENTED });
    pendingCollectCallback?.(err);
    await Promise.resolve();

    expect(mockChannelManager.reportError).not.toHaveBeenCalled();
    expect((sender as unknown as { closed: boolean }).closed).toBe(true);
  });

  describe('shutdown late callback safety (H2 / E6 edge case)', () => {
    it('does not re-queue buffer when collect callback fires after shutdown', async () => {
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      jest.advanceTimersByTime(1_000);
      await Promise.resolve();
      expect(pendingCollectCallback).toBeDefined();

      const bufferBefore = (sender as unknown as { buffer: unknown[] }).buffer.length;
      sender.shutdown();
      expect((sender as unknown as { buffer: unknown[] }).buffer.length).toBe(0);

      expect(() => pendingCollectCallback?.(new Error('UNAVAILABLE'))).not.toThrow();
      expect(mockChannelManager.reportError).not.toHaveBeenCalled();
      expect((sender as unknown as { buffer: unknown[] }).buffer.length).toBe(0);
      expect(bufferBefore).toBeGreaterThanOrEqual(0);
    });
  });
});
