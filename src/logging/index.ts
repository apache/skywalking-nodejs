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
  _isDebugEnabled: boolean;
  _isInfoEnabled: boolean;
};

export function createLogger(name: string): LoggerLevelAware {
  const loggingLevel = (process.env.SW_AGENT_LOGGING_LEVEL || 'error').toLowerCase();

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

  const loggerLevel = logger.levels[logger.level];
  const _isDebugEnabled = loggerLevel >= logger.levels.debug;
  const _isInfoEnabled = loggerLevel >= logger.levels.info;

  Object.assign(logger, {
    _isDebugEnabled,
    _isInfoEnabled,
  });

  const nop = (): void => {
    /* a cookie for the linter */
  };

  if (loggerLevel < logger.levels.debug)
    // we do this because logger still seems to stringify anything sent to it even if it is below the logging level, costing performance
    (logger as any).debug = nop;

  if (loggerLevel < logger.levels.info) (logger as any).info = nop;

  if (loggerLevel < logger.levels.warn) (logger as any).warn = nop;

  return logger as LoggerLevelAware;
}
