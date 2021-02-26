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
  authorization?: string;
  maxBufferSize?: number;
  ignoreSuffix?: string;
  traceIgnorePath?: string;
  sql_parameters_max_length?: number;
  // the following is internal state computed from config values
  reIgnoreOperation?: RegExp;
};

export function finalizeConfig(config: AgentConfig): void {
  const escapeRegExp = (s: string) => s.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");

  const ignoreSuffix =`^.+(?:${config.ignoreSuffix!.split(',').map((s) => escapeRegExp(s.trim())).join('|')})$`;
  const ignorePath = '^(?:' + config.traceIgnorePath!.split(',').map(
    (s1) => s1.trim().split('**').map(
      (s2) => s2.split('*').map(
        (s3) => s3.split('?').map(escapeRegExp).join('[^/]')  // replaces "?"
      ).join('[^/]*')                                         // replaces "*"
    ).join('(?:(?:[^/]+\.)*[^/]+)?')                          // replaces "**"
  ).join('|') + ')$';                                         // replaces ","

  config.reIgnoreOperation = RegExp(`${ignoreSuffix}|${ignorePath}`);
}

export default {
  serviceName: process.env.SW_AGENT_NAME || 'your-nodejs-service',
  serviceInstance:
    process.env.SW_AGENT_INSTANCE ||
    ((): string => {
      return os.hostname();
    })(),
  collectorAddress: process.env.SW_AGENT_COLLECTOR_BACKEND_SERVICES || '127.0.0.1:11800',
  authorization: process.env.SW_AGENT_AUTHENTICATION,
  maxBufferSize: Number.isSafeInteger(process.env.SW_AGENT_MAX_BUFFER_SIZE) ?
    Number.parseInt(process.env.SW_AGENT_MAX_BUFFER_SIZE as string, 10) : 1000,
  ignoreSuffix: process.env.SW_IGNORE_SUFFIX ?? '.jpg,.jpeg,.js,.css,.png,.bmp,.gif,.ico,.mp3,.mp4,.html,.svg',
  traceIgnorePath: process.env.SW_TRACE_IGNORE_PATH || '',
  sql_parameters_max_length: Math.trunc(Math.max(0, Number(process.env.SW_SQL_SQL_PARAMETERS_MAX_LENGTH))) || 512,
  reIgnoreOperation: RegExp(''),  // temporary placeholder so Typescript doesn't throw a fit
};
