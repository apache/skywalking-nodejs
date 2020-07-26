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

import * as winston from 'winston';
import { Logger } from 'winston';

type LoggerLevelAware = Logger & {
  isDebugEnabled(): boolean;
  isInfoEnabled(): boolean;
};

export function createLogger(name: string): LoggerLevelAware {
  const loggingLevel = process.env.SW_AGENT_LOGGING_LEVEL || (process.env.NODE_ENV !== 'production' ? 'debug' : 'info');

  const logger = winston.createLogger({
    level: loggingLevel,
    format: winston.format.json(),
    defaultMeta: {
      file: name,
    },
  });
  if (process.env.NODE_ENV !== 'production' || process.env.SW_LOGGING_TARGET === 'console') {
    logger.add(
      new winston.transports.Console({
        format: winston.format.prettyPrint(),
      }),
    );
  } else {
    logger.add(
      new winston.transports.File({
        filename: 'skywalking.log',
      }),
    );
  }

  const isDebugEnabled = (): boolean => logger.levels[logger.level] >= logger.levels.debug;
  const isInfoEnabled = (): boolean => logger.levels[logger.level] >= logger.levels.info;

  return Object.assign(logger, {
    isDebugEnabled,
    isInfoEnabled,
  } as LoggerLevelAware);
}
