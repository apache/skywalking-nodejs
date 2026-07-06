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

/* eslint-env node, es2020 */

import agentConfig, {
  AgentConfig,
  finalizeConfig,
  normalizeDeprecatedRuntimeMetricOptions,
  publicAgentConfig,
} from './config/AgentConfig';
import ServiceManager from './agent/core/boot/ServiceManager';
import { createLogger } from './logging';
import PluginInstaller from './core/PluginInstaller';
import SpanContext from './trace/context/SpanContext';

const logger = createLogger(__filename);

let bootstrapPromise: Promise<void> | null = null;

/** Resolves when plugin install and ServiceManager.boot() complete. */
export function whenReady(): Promise<void> {
  return bootstrapPromise ?? Promise.resolve();
}

class Agent {
  private started = false;

  start(options: AgentConfig = {}): void {
    if (process.env.SW_DISABLE === 'true') {
      logger.info('SkyWalking agent is disabled by `SW_DISABLE=true`');
      return;
    }

    if (this.started) {
      logger.warn('SkyWalking agent started more than once, subsequent options to start ignored.');
      return;
    }

    const normalizedOptions = normalizeDeprecatedRuntimeMetricOptions(options);
    Object.assign(agentConfig, normalizedOptions);
    finalizeConfig(agentConfig, normalizedOptions);

    logger.debug('Starting SkyWalking agent');

    try {
      new PluginInstaller().install();
      ServiceManager.INSTANCE.boot();
      this.started = true;
      bootstrapPromise = Promise.resolve();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      bootstrapPromise = Promise.reject(err);
      // Avoid unhandledRejection crashing the host when whenReady() is never awaited.
      bootstrapPromise.catch(() => {});
      logger.error('SkyWalking agent bootstrap failed: %s', err);
    }
  }

  flush(): Promise<unknown | null> {
    if (!this.started) {
      logger.warn('Trying to flush() SkyWalking agent which is not started.');
      return Promise.resolve(null);
    }

    const spanContextFlush = SpanContext.flush();
    if (!spanContextFlush) {
      return ServiceManager.INSTANCE.flush() ?? Promise.resolve(null);
    }

    return new Promise((resolve) => {
      spanContextFlush.then(() => {
        const serviceFlush = ServiceManager.INSTANCE.flush();
        if (!serviceFlush) resolve(null);
        else serviceFlush.then(() => resolve(null));
      });
    });
  }

  destroy(): void {
    if (this.started) {
      logger.info('Destroying SkyWalking agent and cleaning up resources');
      ServiceManager.INSTANCE.shutdown();
      this.started = false;
    }
    bootstrapPromise = null;
  }
}

export default new Agent();
/** Agent config without SW_AGENT_AUTHENTICATION (B-4). Internal code uses AgentConfig default export. */
export { publicAgentConfig as config };
export { default as ContextManager } from './trace/context/ContextManager';
export { default as AzureHttpTriggerPlugin } from './azure/AzureHttpTriggerPlugin';
export { default as AWSLambdaTriggerPlugin } from './aws/AWSLambdaTriggerPlugin';
export { default as AWSLambdaGatewayAPIHTTP } from './aws/AWSLambdaGatewayAPIHTTP';
export { default as AWSLambdaGatewayAPIREST } from './aws/AWSLambdaGatewayAPIREST';
