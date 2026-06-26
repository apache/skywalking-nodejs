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
import { ClientOptions } from '@grpc/grpc-js';
import config from '../../../config/AgentConfig';
import { createLogger } from '../../../logging';
import AgentIDDecorator from './AgentIDDecorator';
import AuthenticationDecorator from './AuthenticationDecorator';
import GRPCChannel from './GRPCChannel';
import { GRPCChannelListener } from './GRPCChannelListener';
import { GRPCChannelStatus } from './GRPCChannelStatus';
import BootService from '../boot/BootService';
import StandardChannelBuilder from './StandardChannelBuilder';
import TLSChannelBuilder from './TLSChannelBuilder';

const logger = createLogger(__filename);

/**
 * Shared gRPC channel manager (Java GRPCChannelManager skeleton).
 * V1: single address; V2 reserved: multi-address failover via reportError().
 */
export default class GRPCChannelManager implements BootService {
  private managedChannel: GRPCChannel | null = null;
  private readonly listeners: GRPCChannelListener[] = [];
  private lastStatus: GRPCChannelStatus | null = null;

  /** V1: first address when comma-separated; V2: failover selection. */
  resolveAddress(): string {
    const raw = config.collectorAddress ?? '';
    const first = raw.split(',')[0]?.trim();
    if (!first) {
      throw new Error('collectorAddress is not configured');
    }
    return first;
  }

  getChannel(): grpc.Channel {
    return this.managedChannel!.getChannel();
  }

  getClientOptions(): ClientOptions {
    return this.managedChannel!.getClientOptions();
  }

  isConnected(): boolean {
    return this.managedChannel?.isConnected(true) ?? false;
  }

  addChannelListener(listener: GRPCChannelListener): void {
    this.listeners.push(listener);
    if (this.lastStatus !== null) {
      listener.statusChanged(this.lastStatus);
    }
  }

  priority(): number {
    return Number.MAX_SAFE_INTEGER;
  }

  /** V2 hook: network errors may trigger address failover. */
  reportError(error: unknown): void {
    logger.debug('gRPC report error (multi-address failover reserved for V2): %s', error);
  }

  prepare(): void {}

  boot(): void {
    const address = this.resolveAddress();
    const [host, portText] = address.split(':');
    const port = Number.parseInt(portText, 10);

    if (!host || Number.isNaN(port)) {
      throw new Error(`Invalid collector address: ${address}`);
    }

    this.managedChannel = GRPCChannel.newBuilder(host, port)
      .addManagedChannelBuilder(new StandardChannelBuilder())
      .addManagedChannelBuilder(new TLSChannelBuilder())
      .addChannelDecorator(new AgentIDDecorator())
      .addChannelDecorator(new AuthenticationDecorator())
      .build();

    this.watchConnectivityState();
  }

  onComplete(): void {}

  shutdown(): void {
    this.managedChannel?.shutdownNow();
    this.managedChannel = null;
  }

  private watchConnectivityState(): void {
    const channel = this.getChannel();
    const currentState = channel.getConnectivityState(true);
    channel.watchConnectivityState(currentState, Infinity, (error) => {
      if (error) {
        logger.debug('Channel connectivity watch error: %s', error.message);
        return;
      }

      const ready = channel.getConnectivityState(false) === grpc.connectivityState.READY;
      this.notify(ready ? GRPCChannelStatus.CONNECTED : GRPCChannelStatus.DISCONNECT);
      this.watchConnectivityState();
    });
  }

  private notify(status: GRPCChannelStatus): void {
    if (this.lastStatus === status) {
      return;
    }
    this.lastStatus = status;
    for (const listener of this.listeners) {
      try {
        listener.statusChanged(status);
      } catch (err) {
        logger.error('GRPCChannelListener failed: %s', err);
      }
    }
  }
}
