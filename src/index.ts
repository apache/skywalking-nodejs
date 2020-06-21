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

import config, { AgentConfig } from '@/config/AgentConfig';
import GrpcProtocol from '@/agent/protocol/grpc/GrpcProtocol';
import { createLogger } from '@/logging';
import Protocol from '@/agent/protocol/Protocol';
import PluginInstaller from '@/core/PluginInstaller';

const logger = createLogger(__filename);

class Agent {
  started = false;
  protocol: Protocol = new GrpcProtocol();

  start(options: AgentConfig = {}): void {
    Object.assign(config, options);

    if (this.started) {
      throw new Error('SkyWalking agent is already started and can only be started once.');
    }
    logger.debug('Starting SkyWalking agent');

    this.started = true;

    PluginInstaller.install();

    this.protocol.heartbeat();
    this.protocol.report();
  }
}

export default new Agent();
