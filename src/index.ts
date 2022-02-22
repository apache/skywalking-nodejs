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

import config, { AgentConfig, finalizeConfig } from './config/AgentConfig';
import Protocol from './agent/protocol/Protocol';
import GrpcProtocol from './agent/protocol/grpc/GrpcProtocol';
import { createLogger } from './logging';
import PluginInstaller from './core/PluginInstaller';

const logger = createLogger(__filename);

class Agent {
  private started = false;
  private protocol: Protocol | null = null;

  start(options: AgentConfig = {}): void {
    if (process.env.SW_DISABLE === 'true') {
      logger.info('SkyWalking agent is disabled by `SW_DISABLE=true`');
      return;
    }

    if (this.started) {
      logger.warn('SkyWalking agent started more than once, subsequent options to start ignored.');
      return;
    }

    Object.assign(config, options);
    finalizeConfig(config);

    logger.debug('Starting SkyWalking agent');

    new PluginInstaller().install();

    this.protocol = new GrpcProtocol().heartbeat().report();
    this.started = true;
  }

  flush(): Promise<any> | null {
    if (this.protocol === null) {
      logger.warn('Trying to flush() SkyWalking agent which is not started.');
      return null;
    }

    return this.protocol.flush();
  }
}

export default new Agent();
export { default as ContextManager } from './trace/context/ContextManager';
export { default as AzureHttpTriggerPlugin } from './azure/AzureHttpTriggerPlugin';
export { default as AWSLambdaTriggerPlugin } from './aws/AWSLambdaTriggerPlugin';
export { default as AWSLambdaGatewayAPIHTTP } from './aws/AWSLambdaGatewayAPIHTTP';
export { default as AWSLambdaGatewayAPIREST } from './aws/AWSLambdaGatewayAPIREST';
