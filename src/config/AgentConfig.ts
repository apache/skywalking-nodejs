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

export type AgentConfig = {
  serviceName?: string;
  serviceInstance?: string;
  collectorAddress?: string;
  secure?: boolean;
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
  awsLambdaFlush?: boolean;
  // the following is internal state computed from config values
  reDisablePlugins?: RegExp;
  reIgnoreOperation?: RegExp;
  reHttpIgnoreMethod?: RegExp;
};

export function finalizeConfig(config: AgentConfig): void {
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
  secure: process.env.SW_AGENT_SECURE?.toLowerCase() === 'true',
  authorization: process.env.SW_AGENT_AUTHENTICATION,
  maxBufferSize: Number.isSafeInteger(process.env.SW_AGENT_MAX_BUFFER_SIZE)
    ? Number.parseInt(process.env.SW_AGENT_MAX_BUFFER_SIZE as string, 10)
    : 1000,
  coldEndpoint: process.env.SW_COLD_ENDPOINT?.toLowerCase() === 'true',
  disablePlugins: process.env.SW_AGENT_DISABLE_PLUGINS || '',
  ignoreSuffix: process.env.SW_IGNORE_SUFFIX ?? '.jpg,.jpeg,.js,.css,.png,.bmp,.gif,.ico,.mp3,.mp4,.html,.svg',
  traceIgnorePath: process.env.SW_TRACE_IGNORE_PATH || '',
  httpIgnoreMethod: process.env.SW_HTTP_IGNORE_METHOD || '',
  sqlTraceParameters: (process.env.SW_SQL_TRACE_PARAMETERS || '').toLowerCase() === 'true',
  sqlParametersMaxLength: Math.trunc(Math.max(0, Number(process.env.SW_SQL_PARAMETERS_MAX_LENGTH))) || 512,
  mongoTraceParameters: (process.env.SW_MONGO_TRACE_PARAMETERS || '').toLowerCase() === 'true',
  mongoParametersMaxLength: Math.trunc(Math.max(0, Number(process.env.SW_MONGO_PARAMETERS_MAX_LENGTH))) || 512,
  awsLambdaFlush: (process.env.SW_AWSLAMBDA_FLUSH || 'true').toLowerCase() === 'true',
  reDisablePlugins: RegExp(''), // temporary placeholder so Typescript doesn't throw a fit
  reIgnoreOperation: RegExp(''),
  reHttpIgnoreMethod: RegExp(''),
};

export default _config;

export function ignoreHttpMethodCheck(method: string): boolean {
  return Boolean(method.match(_config.reHttpIgnoreMethod));
}
