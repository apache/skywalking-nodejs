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

function isGrpcNetworkError(error: unknown): boolean {
  const code = (error as grpc.ServiceError | undefined)?.code;

  return (
    code === grpc.status.UNAVAILABLE ||
    code === grpc.status.PERMISSION_DENIED ||
    code === grpc.status.UNAUTHENTICATED ||
    code === grpc.status.RESOURCE_EXHAUSTED ||
    code === grpc.status.UNKNOWN
  );
}

/**
 * Shared gRPC channel manager (Java GRPCChannelManager skeleton).
 * V1: single address; V2 reserved: multi-address failover via reportError().
 */
export default class GRPCChannelManager implements BootService {
  private managedChannel: GRPCChannel | null = null;
  private readonly listeners: GRPCChannelListener[] = [];
  private lastStatus: GRPCChannelStatus | null = null;
  private closed = false;

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

  /** Notify DISCONNECT on network errors so periodic work stops until grpc-js reconnects. */
  reportError(error: unknown): void {
    if (!isGrpcNetworkError(error)) {
      logger.debug('gRPC report error (ignored): %s', error);
      return;
    }

    logger.debug('gRPC network error, notify DISCONNECT: %s', error);
    this.notify(GRPCChannelStatus.DISCONNECT);
  }

  prepare(): void {}

  boot(): void {
    this.closed = false;
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
    this.closed = true;
    const managed = this.managedChannel;
    this.managedChannel = null;
    managed?.shutdownNow();
    this.notify(GRPCChannelStatus.DISCONNECT);
  }

  private watchConnectivityState(): void {
    const managed = this.managedChannel;
    if (this.closed || !managed) {
      return;
    }

    const channel = managed.getChannel();
    const currentState = channel.getConnectivityState(true);

    channel.watchConnectivityState(currentState, Infinity, (error) => {
      if (this.closed || this.managedChannel !== managed) {
        return;
      }

      if (error) {
        logger.debug('Channel connectivity watch stopped: %s', error.message);
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
