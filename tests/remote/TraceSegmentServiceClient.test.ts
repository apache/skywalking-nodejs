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

import TraceSegmentServiceClient from '../../src/agent/core/remote/TraceSegmentServiceClient';
import { GRPCChannelStatus } from '../../src/agent/core/remote/GRPCChannelStatus';
import ServiceManager from '../../src/agent/core/boot/ServiceManager';
import Segment from '../../src/trace/context/Segment';

const mockStream = {
  write: jest.fn(),
  end: jest.fn(),
  cancel: jest.fn(),
};

let pendingCollectCallback: ((error: Error | null) => void) | undefined;
const mockCollect = jest.fn((_meta: unknown, _opts: unknown, cb: (error: Error | null) => void) => {
  pendingCollectCallback = cb;
  return mockStream;
});
const mockCreateClient = jest.fn(() => ({ collect: mockCollect }));
const mockChannelManager = {
  addChannelListener: jest.fn(),
  createClient: mockCreateClient,
  reportError: jest.fn(),
};

jest.mock('../../src/agent/core/boot/ServiceManager', () => ({
  __esModule: true,
  default: {
    INSTANCE: {
      findService: jest.fn(() => mockChannelManager),
    },
  },
}));

function fakeSegment(): Segment {
  return {
    transform: () => ({ fake: true }),
  } as unknown as Segment;
}

describe('TraceSegmentServiceClient flush / coalesce', () => {
  let client: TraceSegmentServiceClient;

  beforeEach(() => {
    jest.clearAllMocks();
    pendingCollectCallback = undefined;
    mockStream.write.mockReset();
    mockStream.end.mockReset();
    mockStream.cancel.mockReset();
    mockCollect.mockImplementation((_meta, _opts, cb) => {
      pendingCollectCallback = cb;
      return mockStream;
    });
    (ServiceManager.INSTANCE.findService as jest.Mock).mockReturnValue(mockChannelManager);

    client = new TraceSegmentServiceClient();
    client.prepare();
    client.statusChanged(GRPCChannelStatus.CONNECTED);
    client.boot();
  });

  afterEach(() => {
    client.shutdown();
  });

  it('flush while a report is in flight runs a second report and drains the buffer', async () => {
    const buffer = (client as unknown as { buffer: Segment[] }).buffer;
    buffer.push(fakeSegment());

    const reportOnce = (client as unknown as { reportOnce: () => Promise<void> }).reportOnce.bind(client);
    const first = reportOnce();
    await Promise.resolve();
    expect(mockCollect).toHaveBeenCalledTimes(1);
    expect(buffer.length).toBe(0);

    // Segment arrives while first report is still in flight.
    buffer.push(fakeSegment());
    const flushPromise = client.flush();
    expect(flushPromise).not.toBeNull();

    pendingCollectCallback?.(null);
    await first;
    await Promise.resolve();
    await Promise.resolve();

    // Second report should have started for the buffered segment (forceReport).
    expect(mockCollect).toHaveBeenCalledTimes(2);
    pendingCollectCallback?.(null);
    await flushPromise;

    expect(buffer.length).toBe(0);
    expect(mockStream.write.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('discardBatch runs at most once when sync end fails and callback also errors', async () => {
    const buffer = (client as unknown as { buffer: Segment[] }).buffer;
    buffer.push(fakeSegment());
    mockStream.end.mockImplementation(() => {
      throw new Error('end failed');
    });

    const reportOnce = (client as unknown as { reportOnce: () => Promise<void> }).reportOnce.bind(client);
    const p = reportOnce();
    await Promise.resolve();
    pendingCollectCallback?.(new Error('callback error'));
    await p;

    expect(mockChannelManager.reportError).toHaveBeenCalledTimes(1);
    expect(mockStream.cancel).toHaveBeenCalled();
  });
});
