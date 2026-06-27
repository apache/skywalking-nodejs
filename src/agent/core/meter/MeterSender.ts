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
import { GRPCChannelListener } from '../remote/GRPCChannelListener';
import { GRPCChannelStatus } from '../remote/GRPCChannelStatus';

const logger = createLogger(__filename);
const logReportError = throttled(logger, 'error', 30000);

/** Reports Node.js runtime metrics via gRPC MeterReportService (Go/Python-compatible pipeline). */
export default class MeterSender implements BootService, GRPCChannelListener {
  private status = GRPCChannelStatus.DISCONNECT;
  private reporterClient?: MeterReportServiceClient;
  private readonly buffer: RuntimeSnapshot[] = [];
  private collectTimer?: NodeJS.Timeout;
  private reportTimer?: NodeJS.Timeout;
  private reporting?: Promise<void>;

  private collector!: RuntimeMetricsCollector;

  prepare(): void {
    this.collector = new RuntimeMetricsCollector();
    ServiceManager.INSTANCE.findService(GRPCChannelManager)!.addChannelListener(this);
  }

  boot(): void {
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

  private createReporterClient(): MeterReportServiceClient {
    return new MeterReportServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      ServiceManager.INSTANCE.findService(GRPCChannelManager)!.getClientOptions(),
    );
  }

  private startTimers(): void {
    this.collectTimer = setInterval(
      () => this.collectSample(),
      config.runtimeMetricsCollectPeriod || 1000,
    ) as NodeJS.Timeout;
    this.collectTimer.unref();
    this.reportTimer = setInterval(() => {
      void this.reportBufferedMetrics();
    }, config.runtimeMetricsReportPeriod || 1000) as NodeJS.Timeout;
    this.reportTimer.unref();
  }

  private collectSample(): void {
    const maxBufferSize = config.runtimeMetricsBufferSize || 600;
    if (this.buffer.length >= maxBufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(this.collector.sample());
  }

  private reportBufferedMetrics(): Promise<void> {
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
      try {
        if (this.buffer.length === 0 || this.status !== GRPCChannelStatus.CONNECTED || !this.reporterClient) {
          resolve();
          return;
        }

        const snapshots = this.buffer.splice(0, this.buffer.length);
        const stream = this.reporterClient.collect(
          new grpc.Metadata(),
          { deadline: Date.now() + (config.traceTimeout || 10000) },
          (error: grpc.ServiceError | null) => {
            if (error) {
              logReportError('Failed to report runtime meter data', error);
              ServiceManager.INSTANCE.findService(GRPCChannelManager)!.reportError(error);
            }
            resolve();
          },
        );

        try {
          let metadataWritten = false;
          const timestamp = Date.now();
          for (const snapshot of snapshots) {
            for (const meterData of this.collector.toMeterData(snapshot)) {
              if (!metadataWritten) {
                meterData
                  .setService(config.serviceName!)
                  .setServiceinstance(config.serviceInstance!)
                  .setTimestamp(timestamp);
                metadataWritten = true;
              }
              stream.write(meterData);
            }
          }
        } finally {
          stream.end();
        }
      } catch (error) {
        logReportError('Failed to report runtime meter data', error);
        ServiceManager.INSTANCE.findService(GRPCChannelManager)!.reportError(error);
        resolve();
      }
    });
  }

  flush(): Promise<any> | null {
    this.collectSample();
    return this.reportBufferedMetrics();
  }

  shutdown(): void {
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
    logger.info('MeterSender destroyed and resources cleaned up');
  }
}
