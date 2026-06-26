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

import config from '../../../config/AgentConfig';
import * as grpc from '@grpc/grpc-js';
import { createLogger, throttled } from '../../../logging';
import BootService from '../boot/BootService';
import ServiceManager from '../boot/ServiceManager';
import { TraceSegmentReportServiceClient } from '../../../proto/language-agent/Tracing_grpc_pb';
import { emitter } from '../../../lib/EventEmitter';
import Segment from '../../../trace/context/Segment';
import GRPCChannelManager from './GRPCChannelManager';
import { GRPCChannelListener } from './GRPCChannelListener';
import { GRPCChannelStatus } from './GRPCChannelStatus';

const logger = createLogger(__filename);
const logReportError = throttled(logger, 'error', 30000);
const logBufferFull = throttled(logger, 'warn', 30000);

export default class TraceSegmentServiceClient implements BootService, GRPCChannelListener {
  private reporterClient!: TraceSegmentReportServiceClient;
  private readonly buffer: Segment[] = [];
  private timeout?: NodeJS.Timeout;
  private segmentFinishedListener!: (segment: Segment) => void;

  prepare(): void {
    ServiceManager.INSTANCE.findService(GRPCChannelManager)!.addChannelListener(this);

    this.segmentFinishedListener = (segment: Segment) => {
      if (this.buffer.length >= config.maxBufferSize) {
        logBufferFull(
          `Trace buffer reached maximum size (${config.maxBufferSize}); discarding oldest segments. The collector at ${config.collectorAddress} is likely unreachable.`,
        );
        this.buffer.shift();
      }

      this.buffer.push(segment);
      this.timeout?.ref();
    };

    emitter.on('segment-finished', this.segmentFinishedListener);
  }

  boot(): void {
    this.timeout = setTimeout(this.reportFunction.bind(this), 1000) as unknown as NodeJS.Timeout;
    this.timeout.unref();
  }

  onComplete(): void {}

  shutdown(): void {
    if (this.segmentFinishedListener) {
      emitter.off('segment-finished', this.segmentFinishedListener);
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    this.buffer.length = 0;
    logger.info('TraceSegmentServiceClient destroyed and resources cleaned up');
  }

  priority(): number {
    return 0;
  }

  statusChanged(status: GRPCChannelStatus): void {
    if (status === GRPCChannelStatus.CONNECTED) {
      this.reporterClient = this.createReporterClient();
    }
  }

  private createReporterClient(): TraceSegmentReportServiceClient {
    const channelManager = ServiceManager.INSTANCE.findService(GRPCChannelManager)!;
    return new TraceSegmentReportServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      channelManager.getClientOptions(),
    );
  }

  private get isConnected(): boolean {
    return ServiceManager.INSTANCE.findService(GRPCChannelManager)!.isConnected();
  }

  private reportFunction(callback?: () => void) {
    emitter.emit('segments-sent');

    try {
      if (this.buffer.length === 0) {
        callback?.();
        return;
      }

      if (!this.isConnected || !this.reporterClient) {
        callback?.();
        return;
      }

      const stream = this.reporterClient.collect(
        new grpc.Metadata(),
        { deadline: Date.now() + config.traceTimeout },
        (error) => {
          if (error) {
            logReportError('Failed to report trace data', error);
            ServiceManager.INSTANCE.findService(GRPCChannelManager)!.reportError(error);
          }
          callback?.();
        },
      );

      try {
        for (const segment of this.buffer) {
          if (segment) {
            if (logger._isDebugEnabled) {
              logger.debug('Sending segment ', { segment });
            }
            stream.write(segment.transform());
          }
        }
      } finally {
        this.buffer.length = 0;
      }

      stream.end();
    } finally {
      this.timeout = setTimeout(this.reportFunction.bind(this), 1000) as unknown as NodeJS.Timeout;
      this.timeout.unref();
    }
  }

  flush(): Promise<unknown> | null {
    return this.buffer.length === 0
      ? null
      : new Promise((resolve) => {
          this.reportFunction(resolve);
        });
  }
}
