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
import { coalesceReport, flushCoalesced, FLUSH_WAIT_MS, ReportCoalesceState, runCollectStream } from './coalesceReport';

const logger = createLogger(__filename);
const logBufferFull = throttled(logger, 'warn', 30000);
const logDiscardedBatch = throttled(logger, 'warn', 30000);

export default class TraceSegmentServiceClient implements BootService, GRPCChannelListener {
  private closed = false;
  private channelManager?: GRPCChannelManager;
  private status = GRPCChannelStatus.DISCONNECT;
  private reporterClient?: TraceSegmentReportServiceClient;
  private readonly buffer: Segment[] = [];
  private timeout?: NodeJS.Timeout;
  private readonly reportState: ReportCoalesceState = {};
  /** Monotonic count of segments discarded after report failure (for throttled logs). */
  private discardedSegmentTotal = 0;
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
          `Trace buffer reached maximum size (${config.maxBufferSize}); discarding oldest segments. Configured backends [${config.collectorAddress}] are likely unreachable.`,
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

    this.reportState.reporting = undefined;
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
    return this.channelManager.createClient(TraceSegmentReportServiceClient);
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
    return coalesceReport(
      this.reportState,
      () => this.doReport(),
      () => this.closed,
    );
  }

  private doReport(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closed) {
        resolve();
        return;
      }

      try {
        emitter.emit('segments-sent');
      } catch (error) {
        // Listener errors must not reject the report promise (host unhandledRejection).
        logger.debug(`segments-sent listener failed: ${error}`);
      }

      if (this.buffer.length === 0) {
        resolve();
        return;
      }

      if (this.status !== GRPCChannelStatus.CONNECTED || !this.reporterClient) {
        resolve();
        return;
      }

      // Take ownership. On failure discard once (never re-send): disconnect-window
      // data is already protected by READY→IDLE → DISCONNECT (status !== CONNECTED skips splice).
      const batch = this.buffer.splice(0, this.buffer.length);
      const client = this.reporterClient;
      void runCollectStream({
        open: (onStatus) =>
          client.collect(new grpc.Metadata(), { deadline: Date.now() + config.traceTimeout }, onStatus),
        writeAll: (stream) => {
          for (const segment of batch) {
            if (segment) {
              if (logger._isDebugEnabled) {
                logger.debug('Sending segment ', { segment });
              }
              stream.write(segment.transform());
            }
          }
        },
        onFailure: (reason, error) => {
          this.discardedSegmentTotal += batch.length;
          logDiscardedBatch(
            `Discarded ${batch.length} trace segment(s) after report failure (${reason}) (total discarded: ${this.discardedSegmentTotal})`,
            error,
          );
          this.reportGrpcError(error);
        },
        openFailureReason: 'Failed to report trace data',
        endFailureReason: 'Failed to end trace collect stream',
      }).then(resolve);
    });
  }

  private reportGrpcError(error: unknown): void {
    if (this.closed) {
      return;
    }

    this.channelManager?.reportError(error);
  }

  /**
   * Best-effort: one shared FLUSH_WAIT_MS budget for forceReport of remaining buffer, then in-flight wait.
   */
  flush(): Promise<unknown> | null {
    if (this.closed) {
      return null;
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    return flushCoalesced(
      this.reportState,
      () => this.doReport(),
      () => this.closed,
      () => this.buffer.length > 0,
      FLUSH_WAIT_MS,
    ).finally(() => this.scheduleNextReport());
  }
}
