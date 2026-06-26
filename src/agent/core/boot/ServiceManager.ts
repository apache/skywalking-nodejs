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

import config from '../../../config/AgentConfig';
import { createLogger } from '../../../logging';
import BootService from './BootService';
import MeterSender from '../meter/MeterSender';
import GRPCChannelManager from '../remote/GRPCChannelManager';
import ServiceManagementClient from '../remote/ServiceManagementClient';
import TraceSegmentServiceClient from '../remote/TraceSegmentServiceClient';

const logger = createLogger(__filename);

/** Service registry and boot orchestrator (Java {@code ServiceManager}). */
class ServiceManager {
  private static readonly instance = new ServiceManager();

  private bootedServices = new Map<new (...args: never[]) => BootService, BootService>();

  private booted = false;

  static get INSTANCE(): ServiceManager {
    return ServiceManager.instance;
  }

  boot(): void {
    if (this.booted) {
      return;
    }

    this.loadServices();
    const services = this.sortByPriority(true);

    for (const service of services) {
      try {
        service.prepare();
      } catch (error) {
        logger.error('ServiceManager prepare failed: %s', error);
      }
    }

    for (const service of services) {
      try {
        service.boot();
      } catch (error) {
        logger.error('ServiceManager boot failed: %s', error);
      }
    }

    for (const service of services) {
      try {
        service.onComplete();
      } catch (error) {
        logger.error('ServiceManager onComplete failed: %s', error);
      }
    }

    this.booted = true;
  }

  shutdown(): void {
    for (const service of this.sortByPriority(false)) {
      try {
        service.shutdown();
      } catch (error) {
        logger.error('ServiceManager shutdown failed: %s', error);
      }
    }
    this.bootedServices.clear();
    this.booted = false;
  }

  flush(): Promise<unknown> | null {
    const traceFlush = this.findService(TraceSegmentServiceClient)?.flush() ?? null;
    const meterSender = this.findService(MeterSender);
    const meterFlush = meterSender?.flush() ?? null;

    if (!traceFlush && !meterFlush) {
      return null;
    }
    if (!traceFlush) {
      return meterFlush;
    }
    if (!meterFlush) {
      return traceFlush;
    }

    return Promise.all([traceFlush, meterFlush]).then(() => null);
  }

  findService<T extends BootService>(serviceClass: new (...args: never[]) => T): T | undefined {
    return this.bootedServices.get(serviceClass) as T | undefined;
  }

  private register<T extends BootService>(serviceClass: new (...args: never[]) => T, service: T): void {
    this.bootedServices.set(serviceClass, service);
  }

  private loadServices(): void {
    this.register(GRPCChannelManager, new GRPCChannelManager());
    this.register(TraceSegmentServiceClient, new TraceSegmentServiceClient());
    this.register(ServiceManagementClient, new ServiceManagementClient());
    if (config.runtimeMetricsReporterActive) {
      this.register(MeterSender, new MeterSender());
    }
  }

  private sortByPriority(ascending: boolean): BootService[] {
    const services = Array.from(this.bootedServices.values());
    services.sort((left, right) =>
      ascending ? left.priority() - right.priority() : right.priority() - left.priority(),
    );
    return services;
  }
}

export default ServiceManager;
