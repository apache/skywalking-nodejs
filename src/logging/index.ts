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

/**
 * Wraps a logger method so it emits at most once per `intervalMs`, no matter how often it is called.
 *
 * When the SkyWalking backend is unreachable the report/heartbeat loops fail on every tick. Logging each
 * failure with the full gRPC error (a multi-KB stack) lets the records accumulate in winston's internal
 * stream buffer faster than the transport drains them, eventually exhausting the heap. This collapses a
 * storm of identical failures into a single periodic line that carries the suppressed count, and reduces
 * an Error to its `code`/`message` so no stack is retained.
 */
export function throttled(
  logger: Logger,
  level: 'error' | 'warn' | 'info',
  intervalMs: number,
): (message: string, error?: unknown) => void {
  let lastLoggedAt = 0;
  let suppressed = 0;

  return (message, error) => {
    const now = Date.now();

    if (now - lastLoggedAt < intervalMs) {
      suppressed += 1;
      return;
    }

    const meta: Record<string, unknown> = {};

    if (suppressed > 0) {
      meta.suppressed = suppressed;
    }

    if (error != null) {
      meta.error = error instanceof Error ? error.message : error;
      const code = (error as { code?: unknown }).code;
      if (code !== undefined) {
        meta.code = code;
      }
    }

    lastLoggedAt = now;
    suppressed = 0;
    logger[level](message, meta);
  };
}
