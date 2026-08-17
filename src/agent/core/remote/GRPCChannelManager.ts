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
import { ClientOptions, ChannelOptions, ChannelCredentials } from '@grpc/grpc-js';
import config from '../../../config/AgentConfig';
import { createLogger, throttled } from '../../../logging';
import AgentIDDecorator from './AgentIDDecorator';
import AuthenticationDecorator from './AuthenticationDecorator';
import { buildNativeGrpcTarget, parseStaticBackendAddresses } from './BackendAddressResolver';
import GRPCChannel from './GRPCChannel';
import { GRPCChannelListener } from './GRPCChannelListener';
import { GRPCChannelStatus } from './GRPCChannelStatus';
import BootService from '../boot/BootService';
import StandardChannelBuilder from './StandardChannelBuilder';
import TLSChannelBuilder from './TLSChannelBuilder';

const logger = createLogger(__filename);
const logAuthRejected = throttled(logger, 'error', 30000);
const logChannelDisconnected = throttled(logger, 'error', 30000);
const logChannelRecovered = throttled(logger, 'warn', 30000);

/** Placeholder authority — ignored when channelOverride is set (grpc-js client.js). */
const STUB_AUTHORITY = 'skywalking-backend';

function isGrpcAuthError(error: unknown): boolean {
  const code = (error as grpc.ServiceError | undefined)?.code;
  return code === grpc.status.PERMISSION_DENIED || code === grpc.status.UNAUTHENTICATED;
}

function isGrpcNetworkError(error: unknown): boolean {
  const code = (error as grpc.ServiceError | undefined)?.code;
  if (isGrpcAuthError(error)) {
    return false;
  }
  return (
    code === grpc.status.UNAVAILABLE ||
    code === grpc.status.RESOURCE_EXHAUSTED ||
    code === grpc.status.UNKNOWN ||
    code === grpc.status.DEADLINE_EXCEEDED
  );
}

function nativeChannelOptions(): ChannelOptions {
  // No gRPC keepalive: stock OAP (grpc-java) rejects frequent idle pings with GOAWAY
  // ENHANCE_YOUR_CALM. Agent traffic (trace/heartbeat/metrics) provides liveness.
  //
  // Agent→OAP via HTTP proxy is not supported. Disable grpc-js proxy interception
  // uniformly (including single-address dns: targets that grpc-js could otherwise
  // proxy) so host-app http_proxy/https_proxy cannot affect the agent channel —
  // multi-address targets are also broken under HTTP CONNECT (proxy sees the
  // unresolved comma list).
  return {
    'grpc.enable_http_proxy': 0,
    'grpc.initial_reconnect_backoff_ms': 1_000,
    'grpc.max_reconnect_backoff_ms': 30_000,
    'grpc.service_config': JSON.stringify({
      // shuffleAddressList: distribute agents across backends without rewriting the
      // target string (keeps channel authority / SNI stable under TLS).
      loadBalancingConfig: [{ pick_first: { shuffleAddressList: true } }],
      // Retry only unary idempotent reportInstanceProperties. Client-streaming
      // collect (trace/meter) must not retry — grpc-js replays the write buffer and
      // OAP does not dedupe segments. keepAlive is covered by the next 20s tick.
      // FQDN matches Management.proto (skywalking.v3), not ManagementCompat.
      methodConfig: [
        {
          name: [{ service: 'skywalking.v3.ManagementService', method: 'reportInstanceProperties' }],
          retryPolicy: {
            maxAttempts: 3,
            initialBackoff: '1s',
            maxBackoff: '10s',
            backoffMultiplier: 2,
            retryableStatusCodes: ['UNAVAILABLE'],
          },
        },
      ],
    }),
  };
}

/**
 * Shared gRPC channel manager using grpc-js native multi-address failover
 * (pick_first + reconnect backoff + service-config retry). Opens one channel at boot.
 */
export default class GRPCChannelManager implements BootService {
  private managedChannel: GRPCChannel | null = null;
  private readonly listeners: GRPCChannelListener[] = [];
  private lastStatus: GRPCChannelStatus | null = null;
  private lastConnectivityState: grpc.connectivityState | null = null;
  private closed = false;
  private grpcServers: string[] = [];

  getClientOptions(): ClientOptions {
    if (!this.managedChannel) {
      throw new Error('gRPC channel is not available');
    }
    return this.managedChannel.getClientOptions();
  }

  /**
   * Construct a generated gRPC client bound to the shared channel.
   * Address/credentials are placeholders — transport uses channelOverride.
   */
  createClient<TClient>(
    ClientCtor: new (address: string, credentials: ChannelCredentials, options?: ClientOptions) => TClient,
  ): TClient {
    return new ClientCtor(STUB_AUTHORITY, grpc.credentials.createInsecure(), this.getClientOptions());
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

  /**
   * Auth failures: throttled error only (same token across cluster backends).
   * Network errors on READY: leave to grpc-js retry / pick_first.
   * DEADLINE_EXCEEDED on a READY channel is intentionally not treated as failover —
   * failover targets unreachable backends, not slow/overloaded RPCs on a live connection.
   */
  reportError(error: unknown): void {
    if (this.closed) {
      return;
    }

    if (isGrpcAuthError(error)) {
      logAuthRejected('gRPC authentication rejected by OAP; check SW_AGENT_AUTHENTICATION configuration', error);
      return;
    }

    if (!isGrpcNetworkError(error)) {
      logger.debug(`gRPC report error (ignored): ${error}`);
      return;
    }

    const managed = this.managedChannel;
    if (!managed) {
      this.notify(GRPCChannelStatus.DISCONNECT);
      return;
    }

    if (managed.isConnected(false)) {
      // Includes DEADLINE_EXCEEDED while READY — do not tear down / rotate (see method doc).
      logger.debug(`gRPC network error but channel still READY (native reconnect/retry): ${error}`);
      return;
    }

    logger.debug(`gRPC network error with non-READY channel: ${error}`);
    this.notify(GRPCChannelStatus.DISCONNECT);
  }

  prepare(): void {}

  boot(): void {
    this.closed = false;
    this.lastConnectivityState = null;
    const parsed = parseStaticBackendAddresses(config.collectorAddress ?? '');
    if (parsed.length === 0) {
      logger.error('Collector server addresses are not set.');
      logger.error('Agent will not uplink any data.');
      this.notify(GRPCChannelStatus.DISCONNECT);
      return;
    }
    // Keep config order in the target so channel authority / SNI stay stable.
    // Endpoint pick order is shuffled by pick_first.shuffleAddressList in service_config.
    this.grpcServers = [...parsed];
    this.openChannel(this.grpcServers);
  }

  onComplete(): void {}

  shutdown(): void {
    this.closed = true;
    const managed = this.managedChannel;
    this.managedChannel = null;
    managed?.shutdownNow();
    this.notify(GRPCChannelStatus.DISCONNECT);
    this.listeners.length = 0;
    this.grpcServers = [];
    this.lastConnectivityState = null;
  }

  private openChannel(addresses: string[]): void {
    if (this.closed || addresses.length === 0) {
      return;
    }

    let target: string;
    try {
      target = buildNativeGrpcTarget(addresses);
    } catch (error) {
      logger.error(`Failed to build gRPC target: ${error}`);
      this.notify(GRPCChannelStatus.DISCONNECT);
      return;
    }

    let built: GRPCChannel;
    try {
      built = GRPCChannel.newBuilder(target)
        .withChannelOptions(nativeChannelOptions())
        .addManagedChannelBuilder(new StandardChannelBuilder())
        .addManagedChannelBuilder(new TLSChannelBuilder())
        .addChannelDecorator(new AgentIDDecorator())
        .addChannelDecorator(new AuthenticationDecorator())
        .build();
    } catch (error) {
      logger.error(`Failed to build gRPC channel for target [${target}]: ${error}`);
      this.notify(GRPCChannelStatus.DISCONNECT);
      return;
    }

    const previous = this.managedChannel;
    this.managedChannel = built;
    // Defensive: boot() opens once today (ServiceManager.booted), but close any prior
    // channel if openChannel is ever invoked again.
    previous?.shutdownNow();
    this.watchConnectivityState();
    // watchConnectivityState already requested a connection; do not request again.
    this.notifyCurrentConnectivityState(false);
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
        logger.debug(`Channel connectivity watch stopped: ${error.message}`);
        return;
      }
      this.notifyCurrentConnectivityState(false);
      this.watchConnectivityState();
    });
  }

  private notifyCurrentConnectivityState(requestConnection: boolean): void {
    const managed = this.managedChannel;
    if (this.closed || !managed) {
      return;
    }
    const state = managed.getConnectivityState(requestConnection);
    const previousConnectivity = this.lastConnectivityState;
    this.lastConnectivityState = state;

    if (state === grpc.connectivityState.READY) {
      this.notify(GRPCChannelStatus.CONNECTED);
      return;
    }
    // Handshake in progress — do not treat as disconnect.
    if (state === grpc.connectivityState.CONNECTING) {
      return;
    }
    // READY→IDLE is grpc-js's normal path after the active connection drops.
    if (state === grpc.connectivityState.IDLE) {
      if (previousConnectivity === grpc.connectivityState.READY) {
        this.notify(GRPCChannelStatus.DISCONNECT);
      }
      return;
    }
    this.notify(GRPCChannelStatus.DISCONNECT);
  }

  private notify(status: GRPCChannelStatus): void {
    if (this.lastStatus === status) {
      return;
    }
    const previous = this.lastStatus;
    this.lastStatus = status;
    this.logStatusTransition(status, previous);

    for (const listener of this.listeners) {
      try {
        listener.statusChanged(status);
      } catch (err) {
        logger.error(`GRPCChannelListener failed: ${err}`);
      }
    }
  }

  /** Error-level connectivity logs; skipped on deliberate shutdown (closed). Throttled. */
  private logStatusTransition(status: GRPCChannelStatus, previous: GRPCChannelStatus | null): void {
    if (this.closed) {
      return;
    }
    const backends = this.grpcServers.join(',') || config.collectorAddress || '';
    if (status === GRPCChannelStatus.DISCONNECT) {
      if (previous === GRPCChannelStatus.CONNECTED) {
        logChannelDisconnected(
          `gRPC channel disconnected from backends [${backends}]; reconnecting with exponential backoff`,
        );
      } else {
        logChannelDisconnected(
          `gRPC channel not connected to backends [${backends}]; connecting with exponential backoff`,
        );
      }
    } else if (status === GRPCChannelStatus.CONNECTED && previous === GRPCChannelStatus.DISCONNECT) {
      logChannelRecovered(`gRPC channel recovered; connected to backends [${backends}]`);
    }
  }
}
