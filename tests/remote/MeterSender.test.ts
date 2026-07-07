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
let pendingCollectCallback: ((error: Error | null) => void) | undefined;
let sampleSequence = 0;

const mockChannelManager = {
  addChannelListener: jest.fn(),
  getClientOptions: jest.fn(() => ({})),
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

const mockSnapshot = () => ({ collectedAt: 1_000_000 + sampleSequence++ * 500, cpu: 1 });

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: {
    serviceName: 'meter-service',
    serviceInstance: 'meter-instance',
    traceTimeout: 10000,
    runtimeMetricsCollectPeriod: 1000,
    runtimeMetricsReportPeriod: 1000,
    runtimeMetricsBufferSize: 600,
    runtimeMetricsMaxSnapshotsPerReport: 1,
  },
}));

jest.mock('../../src/proto/language-agent/Meter_grpc_pb', () => ({
  MeterReportServiceClient: jest.fn().mockImplementation(() => ({
    collect: jest.fn((_meta, _opts, cb) => {
      pendingCollectCallback = cb;
      return mockStream;
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
    _isDebugEnabled: false,
  }),
  throttled: () => jest.fn(),
}));

import MeterSender from '../../src/agent/core/meter/MeterSender';
import { MeterReportServiceClient } from '../../src/proto/language-agent/Meter_grpc_pb';

describe('MeterSender', () => {
  let sender: MeterSender;

  beforeEach(() => {
    jest.useFakeTimers();
    sampleSequence = 0;
    mockCollect.mockClear();
    mockChannelManager.reportError.mockClear();
    mockMeterData.setService.mockClear();
    mockMeterData.setServiceinstance.mockClear();
    mockMeterData.setTimestamp.mockClear();
    mockStream.write.mockReset();
    mockStream.end.mockReset();
    pendingCollectCallback = undefined;
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

  it('uses per-snapshot collectedAt timestamps', async () => {
    const senderAny = sender as unknown as { buffer: Array<{ collectedAt: number }> };
    senderAny.buffer.push({ collectedAt: 1_111_111 } as never, { collectedAt: 2_222_222 } as never);

    const firstReport = (sender as unknown as { reportBufferedMetrics: () => Promise<void> }).reportBufferedMetrics();
    await Promise.resolve();
    pendingCollectCallback?.(null);
    await firstReport;

    const secondReport = (sender as unknown as { reportBufferedMetrics: () => Promise<void> }).reportBufferedMetrics();
    await Promise.resolve();
    pendingCollectCallback?.(null);
    await secondReport;

    const timestamps = mockMeterData.setTimestamp.mock.calls.map((call) => call[0]);
    expect(timestamps).toEqual(expect.arrayContaining([1_111_111, 2_222_222]));
  });

  it('drains at most one snapshot per report tick by default', async () => {
    const senderAny = sender as unknown as { buffer: Array<{ collectedAt: number }> };
    senderAny.buffer.push({ collectedAt: 1 } as never, { collectedAt: 2 } as never, { collectedAt: 3 } as never);

    const reportPromise = (sender as unknown as { reportBufferedMetrics: () => Promise<void> }).reportBufferedMetrics();
    await Promise.resolve();
    pendingCollectCallback?.(null);
    await reportPromise;

    expect(senderAny.buffer.length).toBe(2);
    expect(mockStream.write).toHaveBeenCalled();
  });

  it('skips duplicate boot timers', () => {
    const collectTimer = (sender as unknown as { collectTimer?: NodeJS.Timeout }).collectTimer;
    const reportTimer = (sender as unknown as { reportTimer?: NodeJS.Timeout }).reportTimer;
    sender.boot();
    expect((sender as unknown as { collectTimer?: NodeJS.Timeout }).collectTimer).toBe(collectTimer);
    expect((sender as unknown as { reportTimer?: NodeJS.Timeout }).reportTimer).toBe(reportTimer);
  });
});
