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

const registeredServiceNames = new Set<string>();

jest.mock('../../src/agent/core/boot/ServiceManager', () => ({
  __esModule: true,
  default: {
    INSTANCE: {
      boot: jest.fn(() => {
        registeredServiceNames.clear();
        registeredServiceNames.add('GRPCChannelManager');
        registeredServiceNames.add('TraceSegmentServiceClient');
        registeredServiceNames.add('ServiceManagementClient');
        const { default: agentConfig } = jest.requireActual('../../src/config/AgentConfig') as {
          default: { runtimeMetricsReporterActive?: boolean };
        };
        if (agentConfig.runtimeMetricsReporterActive) {
          registeredServiceNames.add('MeterSender');
        }
      }),
      shutdown: jest.fn(() => {
        registeredServiceNames.clear();
      }),
      flush: jest.fn(),
      findService: jest.fn((serviceClass: { name: string }) =>
        registeredServiceNames.has(serviceClass.name) ? {} : undefined,
      ),
    },
  },
}));

jest.mock('../../src/core/PluginInstaller', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    install: jest.fn(),
  })),
}));

import agent, { config } from '../../src/index';
import ServiceManager from '../../src/agent/core/boot/ServiceManager';
import MeterSender from '../../src/agent/core/meter/MeterSender';
import { AgentConfig, normalizeDeprecatedRuntimeMetricOptions } from '../../src/config/AgentConfig';

function resetRuntimeMetricConfig(): void {
  const mutableConfig = config as AgentConfig;
  mutableConfig.runtimeMetricsReporterActive = true;
  mutableConfig.runtimeMetricsCollectPeriod = 1000;
  mutableConfig.runtimeMetricsReportPeriod = 1000;
  mutableConfig.runtimeMetricsBufferSize = 600;
  delete mutableConfig.nvmMetricsReporterActive;
  delete mutableConfig.nvmJvmReporterActive;
  delete mutableConfig.nvmMetricsCollectPeriod;
  delete mutableConfig.nvmJvmMetricsCollectPeriod;
  delete mutableConfig.nvmMetricsReportPeriod;
  delete mutableConfig.nvmJvmMetricsReportPeriod;
  delete mutableConfig.nvmMetricsBufferSize;
  delete mutableConfig.nvmJvmMetricsBufferSize;
}

describe('AgentConfig deprecated runtime metric options (unit)', () => {
  afterEach(() => {
    agent.destroy();
    resetRuntimeMetricConfig();
  });

  it('maps deprecated programmatic aliases before merge', () => {
    const normalized = normalizeDeprecatedRuntimeMetricOptions({
      nvmMetricsReporterActive: false,
      nvmMetricsCollectPeriod: 2000,
      nvmMetricsReportPeriod: 3000,
      nvmMetricsBufferSize: 42,
    });

    expect(normalized.runtimeMetricsReporterActive).toBe(false);
    expect(normalized.runtimeMetricsCollectPeriod).toBe(2000);
    expect(normalized.runtimeMetricsReportPeriod).toBe(3000);
    expect(normalized.runtimeMetricsBufferSize).toBe(42);
  });

  it('maps nvmJvm deprecated aliases before merge', () => {
    const normalized = normalizeDeprecatedRuntimeMetricOptions({
      nvmJvmReporterActive: false,
      nvmJvmMetricsCollectPeriod: 2222,
      nvmJvmMetricsReportPeriod: 3333,
      nvmJvmMetricsBufferSize: 44,
    });

    expect(normalized.runtimeMetricsReporterActive).toBe(false);
    expect(normalized.runtimeMetricsCollectPeriod).toBe(2222);
    expect(normalized.runtimeMetricsReportPeriod).toBe(3333);
    expect(normalized.runtimeMetricsBufferSize).toBe(44);
  });

  it('keeps explicit canonical options over deprecated aliases', () => {
    const normalized = normalizeDeprecatedRuntimeMetricOptions({
      runtimeMetricsReporterActive: true,
      nvmMetricsReporterActive: false,
    });

    expect(normalized.runtimeMetricsReporterActive).toBe(true);
    expect(normalized.nvmMetricsReporterActive).toBeUndefined();
    expect(normalized.nvmJvmReporterActive).toBeUndefined();
  });

  it('disables runtime metrics when agent.start receives nvmMetrics alias', () => {
    agent.start({ nvmMetricsReporterActive: false });

    expect(config.runtimeMetricsReporterActive).toBe(false);
    expect(ServiceManager.INSTANCE.findService(MeterSender)).toBeUndefined();
  });

  it('disables runtime metrics when agent.start receives nvmJvm alias', () => {
    agent.start({ nvmJvmReporterActive: false });

    expect(config.runtimeMetricsReporterActive).toBe(false);
    expect(ServiceManager.INSTANCE.findService(MeterSender)).toBeUndefined();
  });

  it('disables runtime metrics when deprecated alias is set on exported config', () => {
    (config as AgentConfig).nvmMetricsReporterActive = false;

    agent.start();

    expect(config.runtimeMetricsReporterActive).toBe(false);
    expect(ServiceManager.INSTANCE.findService(MeterSender)).toBeUndefined();
  });
  it('maps deprecated aliases without leaving stale alias keys on normalized options', () => {
    const normalized = normalizeDeprecatedRuntimeMetricOptions({
      nvmMetricsReporterActive: false,
    });

    expect(normalized.runtimeMetricsReporterActive).toBe(false);
    expect(normalized.nvmMetricsReporterActive).toBeUndefined();
    expect(normalized.nvmJvmReporterActive).toBeUndefined();
  });

  it('re-enables runtime metrics after destroy/start with canonical option', () => {
    agent.start({ nvmMetricsReporterActive: false });

    expect(config.runtimeMetricsReporterActive).toBe(false);
    expect((config as AgentConfig).nvmMetricsReporterActive).toBeUndefined();

    agent.destroy();

    agent.start({ runtimeMetricsReporterActive: true });

    expect(config.runtimeMetricsReporterActive).toBe(true);
    expect((config as AgentConfig).nvmMetricsReporterActive).toBeUndefined();
    expect(ServiceManager.INSTANCE.findService(MeterSender)).toBeDefined();
  });
});
