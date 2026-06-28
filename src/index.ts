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

import config, { AgentConfig, finalizeConfig, normalizeDeprecatedRuntimeMetricOptions } from './config/AgentConfig';
import ServiceManager from './agent/core/boot/ServiceManager';
import { createLogger } from './logging';
import PluginInstaller from './core/PluginInstaller';
import SpanContext from './trace/context/SpanContext';

const logger = createLogger(__filename);

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

    Object.assign(config, normalizeDeprecatedRuntimeMetricOptions(options));
    finalizeConfig(config);

    logger.debug('Starting SkyWalking agent');

    new PluginInstaller().install();

    ServiceManager.INSTANCE.boot();
    this.started = true;
  }

  flush(): Promise<any> | null {
    if (!this.started) {
      logger.warn('Trying to flush() SkyWalking agent which is not started.');
      return null;
    }

    const spanContextFlush = SpanContext.flush();
    if (!spanContextFlush) {
      return ServiceManager.INSTANCE.flush();
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
    if (!this.started) {
      logger.warn('Trying to destroy() SkyWalking agent which is not started.');
      return;
    }

    logger.info('Destroying SkyWalking agent and cleaning up resources');
    ServiceManager.INSTANCE.shutdown();
    this.started = false;
  }
}

export default new Agent();
export { default as config } from './config/AgentConfig';
export { default as ContextManager } from './trace/context/ContextManager';
export { default as AzureHttpTriggerPlugin } from './azure/AzureHttpTriggerPlugin';
export { default as AWSLambdaTriggerPlugin } from './aws/AWSLambdaTriggerPlugin';
export { default as AWSLambdaGatewayAPIHTTP } from './aws/AWSLambdaGatewayAPIHTTP';
export { default as AWSLambdaGatewayAPIREST } from './aws/AWSLambdaGatewayAPIREST';
