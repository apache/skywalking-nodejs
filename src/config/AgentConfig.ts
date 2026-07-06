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

import * as os from 'os';
import { createLogger } from '../logging';
const logger = createLogger(__filename);

export type AgentConfig = {
  serviceName?: string;
  serviceInstance?: string;
  collectorAddress?: string;
  /** Legacy TLS switch; maps to forceTls. FORCE_TLS without CA may use system trust store (Java parity). */
  secure?: boolean;
  /** Prefer explicit CA file; Java may enable TLS with FORCE_TLS alone, Node does not. */
  forceTls?: boolean;
  sslTrustedCaPath?: string;
  sslCertChainPath?: string;
  sslKeyPath?: string;
  authorization?: string;
  maxBufferSize?: number;
  coldEndpoint?: boolean;
  disablePlugins?: string;
  ignoreSuffix?: string;
  traceIgnorePath?: string;
  httpIgnoreMethod?: string;
  sqlTraceParameters?: boolean;
  sqlParametersMaxLength?: number;
  mongoTraceParameters?: boolean;
  mongoParametersMaxLength?: number;
  awsLambdaFlush?: number;
  awsLambdaChain?: boolean;
  awsSQSCheckBody?: boolean;
  // the following is internal state computed from config values
  reDisablePlugins?: RegExp;
  reIgnoreOperation?: RegExp;
  reHttpIgnoreMethod?: RegExp;
  traceTimeout?: number;
  grpcUpstreamTimeout?: number;
  runtimeMetricsReporterActive?: boolean;
  runtimeMetricsCollectPeriod?: number;
  runtimeMetricsReportPeriod?: number;
  runtimeMetricsBufferSize?: number;
  runtimeMetricsMaxSnapshotsPerReport?: number;
  runtimeMetricsHeapSpaceDetail?: boolean;
  grpcChannelCheckInterval?: number;
  /** Java {@code Config.Collector.HEARTBEAT_PERIOD} (seconds). */
  collectorHeartbeatPeriod?: number;
  forceReconnectionPeriod?: number;
  isResolveDnsPeriodically?: boolean;
  /** @deprecated use runtimeMetricsReporterActive */
  nvmMetricsReporterActive?: boolean;
  /** @deprecated use runtimeMetricsCollectPeriod */
  nvmMetricsCollectPeriod?: number;
  /** @deprecated use runtimeMetricsReportPeriod */
  nvmMetricsReportPeriod?: number;
  /** @deprecated use runtimeMetricsBufferSize */
  nvmMetricsBufferSize?: number;
  /** @deprecated use runtimeMetricsReporterActive */
  nvmJvmReporterActive?: boolean;
  /** @deprecated use runtimeMetricsCollectPeriod */
  nvmJvmMetricsCollectPeriod?: number;
  /** @deprecated use runtimeMetricsReportPeriod */
  nvmJvmMetricsReportPeriod?: number;
  /** @deprecated use runtimeMetricsBufferSize */
  nvmJvmMetricsBufferSize?: number;
};

export function normalizeDeprecatedRuntimeMetricOptions(options: AgentConfig): AgentConfig {
  const normalized = { ...options };

  if (normalized.runtimeMetricsReporterActive === undefined) {
    const reporterActive = normalized.nvmMetricsReporterActive ?? normalized.nvmJvmReporterActive;
    if (reporterActive !== undefined) {
      normalized.runtimeMetricsReporterActive = reporterActive;
    }
  }
  delete normalized.nvmMetricsReporterActive;
  delete normalized.nvmJvmReporterActive;

  if (normalized.runtimeMetricsCollectPeriod === undefined) {
    const collectPeriod = normalized.nvmMetricsCollectPeriod ?? normalized.nvmJvmMetricsCollectPeriod;
    if (collectPeriod !== undefined) {
      normalized.runtimeMetricsCollectPeriod = collectPeriod;
    }
  }
  delete normalized.nvmMetricsCollectPeriod;
  delete normalized.nvmJvmMetricsCollectPeriod;

  if (normalized.runtimeMetricsReportPeriod === undefined) {
    const reportPeriod = normalized.nvmMetricsReportPeriod ?? normalized.nvmJvmMetricsReportPeriod;
    if (reportPeriod !== undefined) {
      normalized.runtimeMetricsReportPeriod = reportPeriod;
    }
  }
  delete normalized.nvmMetricsReportPeriod;
  delete normalized.nvmJvmMetricsReportPeriod;

  if (normalized.runtimeMetricsBufferSize === undefined) {
    const bufferSize = normalized.nvmMetricsBufferSize ?? normalized.nvmJvmMetricsBufferSize;
    if (bufferSize !== undefined) {
      normalized.runtimeMetricsBufferSize = bufferSize;
    }
  }
  delete normalized.nvmMetricsBufferSize;
  delete normalized.nvmJvmMetricsBufferSize;

  return normalized;
}

function clearDeprecatedRuntimeMetricFields(config: AgentConfig): void {
  delete config.nvmMetricsReporterActive;
  delete config.nvmJvmReporterActive;
  delete config.nvmMetricsCollectPeriod;
  delete config.nvmJvmMetricsCollectPeriod;
  delete config.nvmMetricsReportPeriod;
  delete config.nvmJvmMetricsReportPeriod;
  delete config.nvmMetricsBufferSize;
  delete config.nvmJvmMetricsBufferSize;
}

function applyDeprecatedRuntimeMetricConfig(config: AgentConfig, options: AgentConfig = {}): void {
  if (options.runtimeMetricsReporterActive === undefined) {
    if (config.nvmMetricsReporterActive !== undefined) {
      config.runtimeMetricsReporterActive = config.nvmMetricsReporterActive;
    } else if (config.nvmJvmReporterActive !== undefined) {
      config.runtimeMetricsReporterActive = config.nvmJvmReporterActive;
    }
  }

  if (options.runtimeMetricsCollectPeriod === undefined) {
    if (config.nvmMetricsCollectPeriod !== undefined) {
      config.runtimeMetricsCollectPeriod = config.nvmMetricsCollectPeriod;
    } else if (config.nvmJvmMetricsCollectPeriod !== undefined) {
      config.runtimeMetricsCollectPeriod = config.nvmJvmMetricsCollectPeriod;
    }
  }

  if (options.runtimeMetricsReportPeriod === undefined) {
    if (config.nvmMetricsReportPeriod !== undefined) {
      config.runtimeMetricsReportPeriod = config.nvmMetricsReportPeriod;
    } else if (config.nvmJvmMetricsReportPeriod !== undefined) {
      config.runtimeMetricsReportPeriod = config.nvmJvmMetricsReportPeriod;
    }
  }

  if (options.runtimeMetricsBufferSize === undefined) {
    if (config.nvmMetricsBufferSize !== undefined) {
      config.runtimeMetricsBufferSize = config.nvmMetricsBufferSize;
    } else if (config.nvmJvmMetricsBufferSize !== undefined) {
      config.runtimeMetricsBufferSize = config.nvmJvmMetricsBufferSize;
    }
  }

  clearDeprecatedRuntimeMetricFields(config);
}

function warnDeprecatedSecureEnv(): void {
  if (process.env.SW_AGENT_SECURE?.toLowerCase() === 'true') {
    logger.warn('SW_AGENT_SECURE is deprecated; use SW_AGENT_FORCE_TLS (Java only exposes agent.force_tls).');
  }
  for (const [oldName, newName] of [
    ['SW_AGENT_NVM_METRICS_REPORTER_ACTIVE', 'SW_AGENT_RUNTIME_METRICS_REPORTER_ACTIVE'],
    ['SW_AGENT_NVM_JVM_REPORTER_ACTIVE', 'SW_AGENT_RUNTIME_METRICS_REPORTER_ACTIVE'],
    ['SW_AGENT_NODEJS_RUNTIME_METRICS_REPORTER_ACTIVE', 'SW_AGENT_RUNTIME_METRICS_REPORTER_ACTIVE'],
    ['SW_AGENT_NODEJS_RUNTIME_METRICS_COLLECT_PERIOD', 'SW_AGENT_RUNTIME_METRICS_COLLECT_PERIOD'],
    ['SW_AGENT_NODEJS_RUNTIME_METRICS_REPORT_PERIOD', 'SW_AGENT_RUNTIME_METRICS_REPORT_PERIOD'],
    ['SW_AGENT_NODEJS_RUNTIME_METRICS_BUFFER_SIZE', 'SW_AGENT_RUNTIME_METRICS_BUFFER_SIZE'],
    ['SW_AGENT_NVM_METRICS_COLLECT_PERIOD', 'SW_AGENT_RUNTIME_METRICS_COLLECT_PERIOD'],
    ['SW_AGENT_NVM_JVM_METRICS_COLLECT_PERIOD', 'SW_AGENT_RUNTIME_METRICS_COLLECT_PERIOD'],
    ['SW_AGENT_NVM_METRICS_REPORT_PERIOD', 'SW_AGENT_RUNTIME_METRICS_REPORT_PERIOD'],
    ['SW_AGENT_NVM_JVM_METRICS_REPORT_PERIOD', 'SW_AGENT_RUNTIME_METRICS_REPORT_PERIOD'],
    ['SW_AGENT_NVM_METRICS_BUFFER_SIZE', 'SW_AGENT_RUNTIME_METRICS_BUFFER_SIZE'],
    ['SW_AGENT_NVM_JVM_METRICS_BUFFER_SIZE', 'SW_AGENT_RUNTIME_METRICS_BUFFER_SIZE'],
  ]) {
    if (process.env[oldName] !== undefined) {
      logger.warn('Deprecated env %s; use %s', oldName, newName);
    }
  }
}

export function finalizeConfig(config: AgentConfig, options: AgentConfig = {}): void {
  warnDeprecatedSecureEnv();
  applyDeprecatedRuntimeMetricConfig(config, options);
  if (config.secure && !config.forceTls) {
    config.forceTls = true;
  }

  const escapeRegExp = (s: string) => s.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, '\\$1');

  config.reDisablePlugins = RegExp(
    `^(?:${config
      .disablePlugins!.split(',')
      .map((s) => escapeRegExp(s.trim()))
      .join('|')})$`,
    'i',
  );

  const convertIgnoreSuffix = (configuredIgnoreSuffix: string | undefined) => {
    if (!configuredIgnoreSuffix) {
      // This regexp will never match => no files are ignored.
      return '\\A(?!x)x';
    } else {
      return `^.+(?:${configuredIgnoreSuffix!
        .split(',')
        .map((s) => escapeRegExp(s.trim()))
        .join('|')})$`;
    }
  };

  const ignoreSuffix = convertIgnoreSuffix(config.ignoreSuffix);
  const ignorePath =
    '^(?:' +
    config
      .traceIgnorePath!.split(',')
      .map(
        (s0) =>
          s0
            .trim()
            .split('/**/')
            .map(
              (s1) =>
                s1
                  .trim()
                  .split('**')
                  .map(
                    (s2) =>
                      s2
                        .split('*')
                        .map(
                          (s3) => s3.split('?').map(escapeRegExp).join('[^/]'), // replaces "?"
                        )
                        .join('[^/]*'), // replaces "*"
                  )
                  .join('(?:(?:[^/]+/)*[^/]+)?'), // replaces "**"
            )
            .join('/(?:[^/]*/)*'), // replaces "/**/"
      )
      .join('|') +
    ')$'; // replaces ","

  config.reIgnoreOperation = RegExp(`${ignoreSuffix}|${ignorePath}`);
  config.reHttpIgnoreMethod = RegExp(
    `^(?:${config
      .httpIgnoreMethod!.split(',')
      .map((s) => escapeRegExp(s.trim()))
      .join('|')})$`,
    'i',
  );
}

const _config = {
  serviceName: process.env.SW_AGENT_NAME || 'your-nodejs-service',
  serviceInstance:
    process.env.SW_AGENT_INSTANCE ||
    ((): string => {
      return os.hostname();
    })(),
  collectorAddress: process.env.SW_AGENT_COLLECTOR_BACKEND_SERVICES || '127.0.0.1:11800',
  // Node requires a readable CA file before TLS (Java FORCE_TLS may use the system trust store).
  /** @deprecated use forceTls / SW_AGENT_FORCE_TLS (Java agent.force_tls only) */
  secure: process.env.SW_AGENT_SECURE?.toLowerCase() === 'true',
  forceTls: process.env.SW_AGENT_FORCE_TLS?.toLowerCase() === 'true',
  sslTrustedCaPath: ((): string => {
    const configured = process.env.SW_AGENT_SSL_TRUSTED_CA_PATH;
    if (configured === undefined) {
      return 'ca/ca.crt';
    }
    return configured;
  })(),
  sslCertChainPath: process.env.SW_AGENT_SSL_CERT_CHAIN_PATH ?? '',
  sslKeyPath: process.env.SW_AGENT_SSL_KEY_PATH ?? '',
  authorization: process.env.SW_AGENT_AUTHENTICATION,
  maxBufferSize: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 1000))(
    Number.parseInt(process.env.SW_AGENT_MAX_BUFFER_SIZE ?? '', 10),
  ),
  coldEndpoint: process.env.SW_COLD_ENDPOINT?.toLowerCase() === 'true',
  disablePlugins: process.env.SW_AGENT_DISABLE_PLUGINS || '',
  ignoreSuffix: process.env.SW_IGNORE_SUFFIX ?? '.jpg,.jpeg,.js,.css,.png,.bmp,.gif,.ico,.mp3,.mp4,.html,.svg',
  traceIgnorePath: process.env.SW_TRACE_IGNORE_PATH || '',
  httpIgnoreMethod: process.env.SW_HTTP_IGNORE_METHOD || '',
  sqlTraceParameters: (process.env.SW_SQL_TRACE_PARAMETERS || '').toLowerCase() === 'true',
  sqlParametersMaxLength: Math.trunc(Math.max(0, Number(process.env.SW_SQL_PARAMETERS_MAX_LENGTH))) || 512,
  mongoTraceParameters: (process.env.SW_MONGO_TRACE_PARAMETERS || '').toLowerCase() === 'true',
  mongoParametersMaxLength: Math.trunc(Math.max(0, Number(process.env.SW_MONGO_PARAMETERS_MAX_LENGTH))) || 512,
  awsLambdaFlush: ((n) => (Number.isNaN(n) ? -1 : n))(Number(process.env.SW_AWS_LAMBDA_FLUSH || 2)),
  awsLambdaChain: (process.env.SW_AWS_LAMBDA_CHAIN || 'false').toLowerCase() === 'true',
  awsSQSCheckBody: (process.env.SW_AWS_SQS_CHECK_BODY || 'false').toLowerCase() === 'true',
  reDisablePlugins: RegExp(''), // temporary placeholder so Typescript doesn't throw a fit
  reIgnoreOperation: RegExp(''),
  reHttpIgnoreMethod: RegExp(''),
  traceTimeout: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 10 * 1000))(
    Number.parseInt(process.env.SW_AGENT_TRACE_TIMEOUT ?? '', 10),
  ),
  grpcUpstreamTimeout: ((): number => {
    const collectorTimeout = Number.parseInt(process.env.SW_AGENT_COLLECTOR_GRPC_UPSTREAM_TIMEOUT ?? '', 10);
    if (Number.isSafeInteger(collectorTimeout) && collectorTimeout > 0) {
      return collectorTimeout;
    }
    const legacyMs = Number.parseInt(process.env.SW_AGENT_TRACE_TIMEOUT ?? '', 10);
    if (Number.isSafeInteger(legacyMs) && legacyMs > 0) {
      return Math.max(1, Math.ceil(legacyMs / 1000));
    }
    return 30;
  })(),
  runtimeMetricsReporterActive: ((): boolean => {
    const configured =
      process.env.SW_AGENT_RUNTIME_METRICS_REPORTER_ACTIVE ??
      process.env.SW_AGENT_NODEJS_RUNTIME_METRICS_REPORTER_ACTIVE ??
      process.env.SW_AGENT_NVM_METRICS_REPORTER_ACTIVE ??
      process.env.SW_AGENT_NVM_JVM_REPORTER_ACTIVE;
    return configured?.toLowerCase() !== 'false';
  })(),
  runtimeMetricsCollectPeriod: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 1000))(
    Number.parseInt(
      process.env.SW_AGENT_RUNTIME_METRICS_COLLECT_PERIOD ??
        process.env.SW_AGENT_NODEJS_RUNTIME_METRICS_COLLECT_PERIOD ??
        process.env.SW_AGENT_NVM_METRICS_COLLECT_PERIOD ??
        process.env.SW_AGENT_NVM_JVM_METRICS_COLLECT_PERIOD ??
        '',
      10,
    ),
  ),
  runtimeMetricsReportPeriod: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 1000))(
    Number.parseInt(
      process.env.SW_AGENT_RUNTIME_METRICS_REPORT_PERIOD ??
        process.env.SW_AGENT_NODEJS_RUNTIME_METRICS_REPORT_PERIOD ??
        process.env.SW_AGENT_NVM_METRICS_REPORT_PERIOD ??
        process.env.SW_AGENT_NVM_JVM_METRICS_REPORT_PERIOD ??
        '',
      10,
    ),
  ),
  runtimeMetricsBufferSize: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 600))(
    Number.parseInt(
      process.env.SW_AGENT_RUNTIME_METRICS_BUFFER_SIZE ??
        process.env.SW_AGENT_NODEJS_RUNTIME_METRICS_BUFFER_SIZE ??
        process.env.SW_AGENT_NVM_METRICS_BUFFER_SIZE ??
        process.env.SW_AGENT_NVM_JVM_METRICS_BUFFER_SIZE ??
        '',
      10,
    ),
  ),
  runtimeMetricsMaxSnapshotsPerReport: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 1))(
    Number.parseInt(process.env.SW_AGENT_RUNTIME_METRICS_MAX_SNAPSHOTS_PER_REPORT ?? '', 10),
  ),
  runtimeMetricsHeapSpaceDetail: ((): boolean => {
    const configured = process.env.SW_AGENT_RUNTIME_METRICS_HEAP_SPACE_DETAIL;
    return configured?.toLowerCase() !== 'false';
  })(),
  grpcChannelCheckInterval: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 30))(
    Number.parseInt(process.env.SW_AGENT_GRPC_CHANNEL_CHECK_INTERVAL ?? '', 10),
  ),
  collectorHeartbeatPeriod: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 20))(
    Number.parseInt(process.env.SW_AGENT_COLLECTOR_HEARTBEAT_PERIOD ?? '', 10),
  ),
  forceReconnectionPeriod: ((n) => (Number.isSafeInteger(n) && n > 0 ? n : 1))(
    Number.parseInt(process.env.SW_AGENT_FORCE_RECONNECTION_PERIOD ?? '', 10),
  ),
  isResolveDnsPeriodically: process.env.SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY?.toLowerCase() === 'true',
};

export default _config;

/** Exported to applications; omits authorization token (B-4). */
/* eslint-disable no-undef -- Proxy is a standard ES6 global */
export const publicAgentConfig: Omit<AgentConfig, 'authorization'> = new Proxy(_config, {
  get(target, prop, receiver) {
    if (prop === 'authorization') {
      return undefined;
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
  set(target, prop, value, receiver) {
    if (prop === 'authorization') {
      return false;
    }
    return Reflect.set(target, prop, value, receiver);
  },
});

export function ignoreHttpMethodCheck(method: string): boolean {
  return Boolean(method.match(_config.reHttpIgnoreMethod));
}
