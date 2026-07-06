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
import { MeterReportServiceClient } from '../../../proto/language-agent/Meter_grpc_pb';
import BootService from '../boot/BootService';
import ServiceManager from '../boot/ServiceManager';
import RuntimeMetricsCollector from './RuntimeMetricsCollector';
import { RuntimeSnapshot } from './RuntimeSampler';
import GRPCChannelManager from '../remote/GRPCChannelManager';
import { grpcUpstreamDeadlineMs } from '../remote/GrpcUpstreamOptions';
import { GRPCChannelListener } from '../remote/GRPCChannelListener';
import { GRPCChannelStatus } from '../remote/GRPCChannelStatus';
import CommandService from '../commands/CommandService';
import { Commands } from '../../../proto/common/Common_pb';

const logger = createLogger(__filename);
const logReportError = throttled(logger, 'error', 30000);

/**
 * Java JVMMetricsSender drains the full queue in one unary RPC.
 * Node/grpc-js uses client streaming — drain at most one snapshot per report tick.
 */

/** Reports Node.js runtime metrics via gRPC MeterReportService (Go/Python-compatible pipeline). */
export default class MeterSender implements BootService, GRPCChannelListener {
  private closed = false;
  private channelManager?: GRPCChannelManager;
  private status = GRPCChannelStatus.DISCONNECT;
  private reporterClient?: MeterReportServiceClient;
  private readonly buffer: RuntimeSnapshot[] = [];
  private collectTimer?: NodeJS.Timeout;
  private reportTimer?: NodeJS.Timeout;
  private reporting?: Promise<void>;
  private collector!: RuntimeMetricsCollector;

  prepare(): void {
    this.collector = new RuntimeMetricsCollector();
    this.channelManager = ServiceManager.INSTANCE.findService(GRPCChannelManager);
    this.channelManager?.addChannelListener(this);
  }

  boot(): void {
    if (this.collectTimer || this.reportTimer) {
      logger.warn('MeterSender timers already scheduled; skipping duplicate boot.');
      return;
    }

    this.startTimers();
  }

  onComplete(): void {}

  priority(): number {
    return 0;
  }

  statusChanged(status: GRPCChannelStatus): void {
    this.status = status;
    this.reporterClient = status === GRPCChannelStatus.CONNECTED ? this.createReporterClient() : undefined;
  }

  private createReporterClient(): MeterReportServiceClient | undefined {
    if (!this.channelManager) {
      return undefined;
    }

    return new MeterReportServiceClient(
      this.channelManager.resolveAddress(),
      grpc.credentials.createInsecure(),
      this.channelManager.getClientOptions(),
    );
  }

  private startTimers(): void {
    this.collectTimer = setInterval(() => {
      if (this.closed) {
        return;
      }
      this.collectSample();
    }, config.runtimeMetricsCollectPeriod || 1000) as NodeJS.Timeout;
    this.collectTimer.unref();
    this.reportTimer = setInterval(() => {
      if (this.closed) {
        return;
      }
      void this.reportBufferedMetrics();
    }, config.runtimeMetricsReportPeriod || 1000) as NodeJS.Timeout;
    this.reportTimer.unref();
  }

  private maxBufferSize(): number {
    return config.runtimeMetricsBufferSize || 600;
  }

  private collectSample(): void {
    const maxBufferSize = this.maxBufferSize();
    if (this.buffer.length >= maxBufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(this.collector.sample());
  }

  /** Re-queue failed snapshots while enforcing the same cap as collectSample(). */
  private requeueSnapshots(snapshots: RuntimeSnapshot[]): void {
    if (snapshots.length === 0) {
      return;
    }
    const maxBufferSize = this.maxBufferSize();
    const combined = [...snapshots, ...this.buffer];
    if (combined.length > maxBufferSize) {
      combined.splice(0, combined.length - maxBufferSize);
    }
    this.buffer.length = 0;
    this.buffer.push(...combined);
  }

  private reportBufferedMetrics(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }

    if (this.reporting) {
      return this.reporting;
    }

    this.reporting = this.doReportBufferedMetrics().finally(() => {
      this.reporting = undefined;
    });
    return this.reporting;
  }

  private doReportBufferedMetrics(): Promise<void> {
    return new Promise((resolve) => {
      let snapshots: RuntimeSnapshot[] = [];
      let settled = false;
      let stream: ReturnType<MeterReportServiceClient['collect']> | undefined;
      let writesStarted = false;

      const settle = (error?: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (error != null) {
          if (!this.handleMeterReportError(error)) {
            logReportError('Failed to report runtime meter data', error);
            this.reportGrpcError(error);
          }
          // Java JVMMetricsSender discards drained metrics on failure; re-queue only before stream writes.
          if (!this.closed && !writesStarted) {
            this.requeueSnapshots(snapshots);
          }
        }
        resolve();
      };

      try {
        if (this.closed) {
          resolve();
          return;
        }

        if (this.buffer.length === 0 || this.status !== GRPCChannelStatus.CONNECTED || !this.reporterClient) {
          resolve();
          return;
        }

        if (!config.serviceName || !config.serviceInstance) {
          resolve();
          return;
        }

        const maxSnapshots = config.runtimeMetricsMaxSnapshotsPerReport ?? 1;
        snapshots = this.buffer.splice(0, Math.min(this.buffer.length, maxSnapshots));
        const batch = snapshots;

        stream = this.reporterClient.collect(
          new grpc.Metadata(),
          { deadline: grpcUpstreamDeadlineMs() },
          (error: grpc.ServiceError | null, commands?: Commands | null) => {
            if (error) {
              settle(error);
            } else {
              ServiceManager.INSTANCE.findService(CommandService)?.receiveCommand(commands ?? undefined);
              settle();
            }
          },
        );

        for (const snapshot of batch) {
          for (const meterData of this.collector.toMeterData(snapshot)) {
            if (this.closed) {
              break;
            }
            meterData
              .setService(config.serviceName)
              .setServiceinstance(config.serviceInstance)
              .setTimestamp(snapshot.collectedAt);
            const writeAccepted = stream.write(meterData);
            writesStarted = true;
            if (writeAccepted === false) {
              logger.warn('Meter stream backpressure; dropping remaining meters in this report tick');
              break;
            }
          }
        }

        if (stream) {
          stream.end();
        }
      } catch (error) {
        settle(error);
      }
    });
  }

  private reportGrpcError(error: unknown): void {
    if (this.closed) {
      return;
    }

    this.channelManager?.reportError(error);
  }

  /** Java MeterSender: disable reporting when OAP has no MeterReportService. */
  private handleMeterReportError(error: unknown): boolean {
    const code = (error as grpc.ServiceError | undefined)?.code;
    if (code !== grpc.status.UNIMPLEMENTED) {
      return false;
    }

    logger.warn("Backend doesn't support meter report; runtime meter reporting will be disabled.");
    this.shutdown();
    return true;
  }

  flush(): Promise<void> | null {
    if (this.closed) {
      return null;
    }

    this.collectSample();
    return this.reportBufferedMetrics();
  }

  shutdown(): void {
    this.closed = true;
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
      this.collectTimer = undefined;
    }
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
    this.reporting = undefined;
    this.reporterClient = undefined;
    this.buffer.length = 0;
    this.collector.destroy();
    this.channelManager = undefined;
    logger.info('MeterSender destroyed and resources cleaned up');
  }
}
