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
  private closed = false;
  private channelManager?: GRPCChannelManager;
  private status = GRPCChannelStatus.DISCONNECT;
  private reporterClient?: TraceSegmentReportServiceClient;
  private readonly buffer: Segment[] = [];
  private timeout?: NodeJS.Timeout;
  private reporting?: Promise<void>;
  private segmentFinishedListener?: (segment: Segment) => void;

  prepare(): void {
    this.channelManager = ServiceManager.INSTANCE.findService(GRPCChannelManager);
    this.channelManager?.addChannelListener(this);

    if (this.segmentFinishedListener) {
      emitter.off('segment-finished', this.segmentFinishedListener);
    }

    this.segmentFinishedListener = (segment: Segment) => {
      if (this.closed) {
        return;
      }

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
    this.scheduleNextReport();
  }

  onComplete(): void {}

  shutdown(): void {
    this.closed = true;
    if (this.segmentFinishedListener) {
      emitter.off('segment-finished', this.segmentFinishedListener);
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    this.reporting = undefined;
    this.reporterClient = undefined;
    this.buffer.length = 0;
    this.channelManager = undefined;
    logger.info('TraceSegmentServiceClient destroyed and resources cleaned up');
  }

  priority(): number {
    return 0;
  }

  statusChanged(status: GRPCChannelStatus): void {
    this.status = status;
    this.reporterClient = status === GRPCChannelStatus.CONNECTED ? this.createReporterClient() : undefined;
  }

  private createReporterClient(): TraceSegmentReportServiceClient | undefined {
    if (!this.channelManager) {
      return undefined;
    }

    return new TraceSegmentReportServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      this.channelManager.getClientOptions(),
    );
  }

  private scheduleNextReport(): void {
    if (this.closed || this.timeout) {
      return;
    }

    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      if (this.closed) {
        return;
      }
      void this.reportOnce().finally(() => this.scheduleNextReport());
    }, 1000) as unknown as NodeJS.Timeout;
    this.timeout.unref();
  }

  private reportOnce(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }

    if (this.reporting) {
      return this.reporting;
    }

    this.reporting = this.doReport().finally(() => {
      this.reporting = undefined;
    });

    return this.reporting;
  }

  private doReport(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve();
        return;
      }

      emitter.emit('segments-sent');

      if (this.buffer.length === 0) {
        resolve();
        return;
      }

      if (this.status !== GRPCChannelStatus.CONNECTED || !this.reporterClient) {
        resolve();
        return;
      }

      let stream: ReturnType<TraceSegmentReportServiceClient['collect']> | undefined;
      try {
        stream = this.reporterClient.collect(
          new grpc.Metadata(),
          { deadline: Date.now() + config.traceTimeout },
          (error) => {
            if (error) {
              logReportError('Failed to report trace data', error);
              this.reportGrpcError(error);
            }
            resolve();
          },
        );

        for (const segment of this.buffer) {
          if (segment) {
            if (logger._isDebugEnabled) {
              logger.debug('Sending segment ', { segment });
            }
            stream.write(segment.transform());
          }
        }
      } catch (error) {
        logReportError('Failed to report trace data', error);
        this.reportGrpcError(error);
        resolve();
      } finally {
        this.buffer.length = 0;
        try {
          stream?.end();
        } catch (error) {
          logReportError('Failed to end trace collect stream', error);
          resolve();
        }
      }
    });
  }

  private reportGrpcError(error: unknown): void {
    if (this.closed) {
      return;
    }

    this.channelManager?.reportError(error);
  }

  flush(): Promise<unknown> | null {
    if (this.closed) {
      return null;
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    if (this.buffer.length === 0) {
      this.scheduleNextReport();
      return null;
    }

    return this.reportOnce().finally(() => this.scheduleNextReport());
  }
}
