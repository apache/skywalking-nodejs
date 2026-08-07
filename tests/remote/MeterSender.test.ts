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

let pendingCollectCallback: ((error: Error | null) => void) | undefined;
let sampleSequence = 0;

const mockChannelManager = {
  addChannelListener: jest.fn(),
  getClientOptions: jest.fn(() => ({})),
  reportError: jest.fn(),
};

const createMeterData = () => ({
  setService: jest.fn().mockReturnThis(),
  setServiceinstance: jest.fn().mockReturnThis(),
  setTimestamp: jest.fn().mockReturnThis(),
});

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
    runtimeMetricsReportPeriod: 1000,
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
    toMeterData: jest.fn(() => [createMeterData(), createMeterData()]),
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
    mockChannelManager.reportError.mockClear();
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
    expect((sender as unknown as { reporterClient?: unknown }).reporterClient).toBeUndefined();
    expect(MeterReportServiceClient).toHaveBeenCalledTimes(1);
  });

  it('uses collectedAt on the first stream element only', async () => {
    const meterA = createMeterData();
    const meterB = createMeterData();
    const collector = (sender as unknown as { collector: { toMeterData: jest.Mock } }).collector;
    collector.toMeterData.mockReturnValueOnce([meterA, meterB]);
    (sender as unknown as { latestSnapshot?: { collectedAt: number } }).latestSnapshot = {
      collectedAt: 1_111_111,
    };

    const reportPromise = (sender as unknown as { reportBufferedMetrics: () => Promise<void> }).reportBufferedMetrics();
    await Promise.resolve();
    pendingCollectCallback?.(null);
    await reportPromise;

    expect(meterA.setService).toHaveBeenCalledWith('meter-service');
    expect(meterA.setServiceinstance).toHaveBeenCalledWith('meter-instance');
    expect(meterA.setTimestamp).toHaveBeenCalledWith(1_111_111);
    expect(meterB.setService).not.toHaveBeenCalled();
    expect(meterB.setServiceinstance).not.toHaveBeenCalled();
    expect(meterB.setTimestamp).not.toHaveBeenCalled();
    expect(mockStream.write).toHaveBeenCalledTimes(2);
  });

  it('reports only the latest snapshot and discards older ones', async () => {
    (sender as unknown as { latestSnapshot?: { collectedAt: number } }).latestSnapshot = {
      collectedAt: 3,
    };

    const reportPromise = (sender as unknown as { reportBufferedMetrics: () => Promise<void> }).reportBufferedMetrics();
    await Promise.resolve();
    pendingCollectCallback?.(null);
    await reportPromise;

    expect((sender as unknown as { latestSnapshot?: unknown }).latestSnapshot).toBeUndefined();
    expect(mockStream.write).toHaveBeenCalled();
  });

  it('keeps overwriting with the newest sample between reports', () => {
    const collector = (sender as unknown as { collector: { sample: jest.Mock } }).collector;
    collector.sample.mockReturnValueOnce({ collectedAt: 10 }).mockReturnValueOnce({ collectedAt: 20 });

    (sender as unknown as { collectSample: () => void }).collectSample();
    (sender as unknown as { collectSample: () => void }).collectSample();

    expect((sender as unknown as { latestSnapshot?: { collectedAt: number } }).latestSnapshot?.collectedAt).toBe(20);
  });

  it('skips duplicate boot timers', () => {
    const timer = (sender as unknown as { timer?: NodeJS.Timeout }).timer;
    sender.boot();
    expect((sender as unknown as { timer?: NodeJS.Timeout }).timer).toBe(timer);
  });

  it('collects then reports on the same timer tick', async () => {
    const collector = (sender as unknown as { collector: { sample: jest.Mock } }).collector;
    collector.sample.mockReturnValueOnce({ collectedAt: 42 });

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    pendingCollectCallback?.(null);
    await Promise.resolve();

    expect(collector.sample).toHaveBeenCalled();
    expect(mockStream.write).toHaveBeenCalled();
  });
});
