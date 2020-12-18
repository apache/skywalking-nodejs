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

import * as grpc from 'grpc';
import { connectivityState } from 'grpc';

import * as packageInfo from '../../../../../package.json';
import { createLogger } from '../../../../logging';
import Client from './Client';
import { ManagementServiceClient } from '../../../../proto/management/Management_grpc_pb';
import AuthInterceptor from '../AuthInterceptor';
import { InstancePingPkg, InstanceProperties } from '../../../../proto/management/Management_pb';
import config from '../../../../config/AgentConfig';
import { KeyStringValuePair } from '../../../../proto/common/Common_pb';
import * as os from 'os';

const logger = createLogger(__filename);

class HeartbeatClient implements Client {
  heartbeatClient?: ManagementServiceClient;
  heartbeatTimer?: NodeJS.Timeout;

  get isConnected(): boolean {
    return this.heartbeatClient?.getChannel().getConnectivityState(true) === connectivityState.READY;
  }

  start() {
    this.heartbeatClient = new ManagementServiceClient(config.collectorAddress, grpc.credentials.createInsecure(), {
      interceptors: [AuthInterceptor],
    });

    if (this.heartbeatTimer) {
      logger.warn(`
        The heartbeat timer has already been scheduled,
        this may be a potential bug, please consider reporting
        this to ${packageInfo.bugs.url}
      `);
      return;
    }

    const keepAlivePkg = new InstancePingPkg()
    .setService(config.serviceName)
    .setServiceinstance(config.serviceInstance);

    const instanceProperties = new InstanceProperties()
    .setService(config.serviceName)
    .setServiceinstance(config.serviceInstance)
    .setPropertiesList([
      new KeyStringValuePair().setKey('language').setValue('NodeJS'),
      new KeyStringValuePair().setKey('OS Name').setValue(os.platform()),
      new KeyStringValuePair().setValue('hostname').setValue(os.hostname()),
      new KeyStringValuePair().setValue('Process No.').setValue(`${process.pid}`),
    ]);

    this.heartbeatTimer = setInterval(() => {
      this.heartbeatClient?.reportInstanceProperties(
        instanceProperties,

        (error, _) => {
          if (error) {
            logger.error('Failed to send heartbeat', error);
          }
        },
      );
      this.heartbeatClient?.keepAlive(
        keepAlivePkg,

        (error, _) => {
          if (error) {
            logger.error('Failed to send heartbeat', error);
          }
        },
      );
    }, 20000).unref();
  }
}

export default new HeartbeatClient();
