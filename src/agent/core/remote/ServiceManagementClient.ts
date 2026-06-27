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

import * as grpc from '@grpc/grpc-js';
import * as os from 'os';
import * as packageInfo from '../../../../package.json';
import config from '../../../config/AgentConfig';
import { createLogger, throttled } from '../../../logging';
import BootService from '../boot/BootService';
import ServiceManager from '../boot/ServiceManager';
import { ManagementServiceClient } from '../../../proto/management/Management_grpc_pb';
import { InstancePingPkg, InstanceProperties } from '../../../proto/management/Management_pb';
import { KeyStringValuePair } from '../../../proto/common/Common_pb';
import GRPCChannelManager from './GRPCChannelManager';
import { GRPCChannelListener } from './GRPCChannelListener';
import { GRPCChannelStatus } from './GRPCChannelStatus';

const logger = createLogger(__filename);
const logHeartbeatError = throttled(logger, 'error', 30000);

export default class ServiceManagementClient implements BootService, GRPCChannelListener {
  private status = GRPCChannelStatus.DISCONNECT;
  private managementServiceClient?: ManagementServiceClient;
  private heartbeatTimer?: NodeJS.Timeout;
  private keepAlivePkg?: InstancePingPkg;
  private instanceProperties?: InstanceProperties;

  prepare(): void {
    ServiceManager.INSTANCE.findService(GRPCChannelManager)!.addChannelListener(this);
  }

  boot(): void {
    if (this.heartbeatTimer) {
      logger.warn(`
        The heartbeat timer has already been scheduled,
        this may be a potential bug, please consider reporting
        this to ${packageInfo.bugs.url}
      `);
      return;
    }

    this.keepAlivePkg = new InstancePingPkg().setService(config.serviceName).setServiceinstance(config.serviceInstance);

    this.instanceProperties = new InstanceProperties()
      .setService(config.serviceName)
      .setServiceinstance(config.serviceInstance)
      .setPropertiesList([
        new KeyStringValuePair().setKey('language').setValue('NodeJS'),
        new KeyStringValuePair().setKey('OS Name').setValue(os.platform()),
        new KeyStringValuePair().setKey('hostname').setValue(os.hostname()),
        new KeyStringValuePair().setKey('Process No.').setValue(`${process.pid}`),
      ]);

    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 20000).unref();
  }

  onComplete(): void {}

  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.managementServiceClient = undefined;
    logger.info('ServiceManagementClient destroyed and resources cleaned up');
  }

  priority(): number {
    return 0;
  }

  statusChanged(status: GRPCChannelStatus): void {
    this.status = status;
    this.managementServiceClient = status === GRPCChannelStatus.CONNECTED ? this.createManagementClient() : undefined;
  }

  private sendHeartbeat(): void {
    if (this.status !== GRPCChannelStatus.CONNECTED || !this.managementServiceClient) {
      return;
    }

    const options = { deadline: Date.now() + config.traceTimeout };

    this.managementServiceClient.reportInstanceProperties(
      this.instanceProperties!,
      new grpc.Metadata(),
      options,
      (error) => {
        if (error) {
          logHeartbeatError('Failed to send heartbeat', error);
          ServiceManager.INSTANCE.findService(GRPCChannelManager)!.reportError(error);
        }
      },
    );
    this.managementServiceClient.keepAlive(this.keepAlivePkg!, new grpc.Metadata(), options, (error) => {
      if (error) {
        logHeartbeatError('Failed to send heartbeat', error);
        ServiceManager.INSTANCE.findService(GRPCChannelManager)!.reportError(error);
      }
    });
  }

  private createManagementClient(): ManagementServiceClient {
    const channelManager = ServiceManager.INSTANCE.findService(GRPCChannelManager)!;
    return new ManagementServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      channelManager.getClientOptions(),
    );
  }

  flush(): Promise<unknown> | null {
    logger.warn('ServiceManagementClient does not need flush().');
    return null;
  }
}
