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
import {
  buildNativeGrpcTarget,
  DnsAuthority,
  expandBackendAddresses,
  firstHostnameAuthority,
  parseStaticBackendAddresses,
  sameAddressSet,
  shouldExpandBackendDns,
} from './BackendAddressResolver';
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
const logDnsExpandEmpty = throttled(logger, 'error', 30000);
const logDnsExpandIncomplete = throttled(logger, 'warn', 30000);

/** Aligns with Java collector.grpc_channel_check_interval default (seconds → ms). */
const DEFAULT_DNS_RE_RESOLVE_INTERVAL_MS = 30_000;

/** Node timers use a signed 32-bit ms delay; larger values overflow to 1ms. */
const MAX_DNS_RE_RESOLVE_INTERVAL_MS = 2 ** 31 - 1;

/**
 * Override via SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS, or the Java-aligned
 * SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL (seconds). Positive integers only;
 * values that overflow the Node timer limit fall back to the default.
 */
export function dnsReResolveIntervalMs(): number {
  const raw =
    process.env.SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS ?? process.env.SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL;
  if (raw == null || raw === '') {
    return DEFAULT_DNS_RE_RESOLVE_INTERVAL_MS;
  }
  const trimmed = raw.trim();
  // Require the whole value to be a positive decimal integer (rejects 1.5, 1e3, 10junk).
  if (!/^\d+$/.test(trimmed)) {
    return DEFAULT_DNS_RE_RESOLVE_INTERVAL_MS;
  }
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return DEFAULT_DNS_RE_RESOLVE_INTERVAL_MS;
  }
  const ms = seconds * 1000;
  if (!Number.isSafeInteger(ms) || ms > MAX_DNS_RE_RESOLVE_INTERVAL_MS) {
    return DEFAULT_DNS_RE_RESOLVE_INTERVAL_MS;
  }
  return ms;
}

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

function nativeChannelOptions(dnsAuthority?: DnsAuthority): ChannelOptions {
  // No gRPC keepalive: stock OAP (grpc-java) rejects frequent idle pings with GOAWAY
  // ENHANCE_YOUR_CALM. Agent traffic (trace/heartbeat/metrics) provides liveness.
  //
  // Agent→OAP via HTTP proxy is not supported. Disable grpc-js proxy interception
  // uniformly (including single-address dns: targets that grpc-js could otherwise
  // proxy) so host-app http_proxy/https_proxy cannot affect the agent channel —
  // multi-address targets are also broken under HTTP CONNECT (proxy sees the
  // unresolved comma list).
  const options: ChannelOptions = {
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

  // After DNS expand, endpoints are IP literals. Preserve HTTP/2 :authority as host:port
  // (plaintext and TLS) so virtual-host proxies that match on port still route correctly.
  // TLS SNI uses hostname-only. Operator sslTargetNameOverride (TLSChannelBuilder) wins
  // for both when set under secure=true; a TLS-only override must not skip plaintext authority.
  const override = config.sslTargetNameOverride?.trim();
  if (dnsAuthority) {
    if (config.secure) {
      if (!override) {
        options['grpc.default_authority'] = dnsAuthority.authority;
        options['grpc.ssl_target_name_override'] = dnsAuthority.serverName;
      }
    } else {
      options['grpc.default_authority'] = dnsAuthority.authority;
    }
  }

  return options;
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
  /** Configured host:port list (pre-DNS expand), used for logs and re-resolve. */
  private configuredServers: string[] = [];
  /** Addresses currently used to dial (may be expanded IPs). */
  private grpcServers: string[] = [];
  /**
   * Last successful (or kept) endpoints per configured host:port — used so a
   * partial DNS failure does not drop other names' prior IPs from the dial set.
   */
  private lastResolvedByConfigured = new Map<string, string[]>();
  private dnsRefreshTimer: NodeJS.Timeout | null = null;
  /** Guard overlapping ticks — matches Java single-thread scheduleAtFixedRate (no concurrent run). */
  private dnsRefreshInFlight = false;
  /**
   * After a failed open/rebuild while a prior channel may still be usable, retry open on the
   * next tick even if the resolved address set is unchanged.
   */
  private dnsOpenNeedsRetry = false;
  /** HTTP/2 authority + TLS SNI when dialing DNS-expanded IP endpoints. */
  private dnsAuthority: DnsAuthority | undefined;
  /** True while dialing addresses produced by expandBackendAddresses (always sw-static). */
  private dialingExpandedAddresses = false;
  /** Skip status transition logs for intentional DISCONNECT→CONNECTED during DNS rebuild. */
  private suppressDnsRebuildStatusLog = false;
  /** How many DNS expand/refresh cycles have completed (including empty results). */
  private dnsRefreshCount = 0;

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

  /** Resolved dial targets after DNS expand (IPs), or configured literals when not expanding. */
  getResolvedBackends(): string[] {
    return [...this.grpcServers];
  }

  /** Completed DNS expand/refresh cycles (initial + periodic). For e2e / diagnostics. */
  getDnsRefreshCount(): number {
    return this.dnsRefreshCount;
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
    this.stopDnsRefreshTimer();
    this.dnsAuthority = undefined;
    this.dnsRefreshInFlight = false;
    this.dnsOpenNeedsRetry = false;
    this.dialingExpandedAddresses = false;
    this.suppressDnsRebuildStatusLog = false;
    this.dnsRefreshCount = 0;
    this.lastResolvedByConfigured = new Map();

    const parsed = parseStaticBackendAddresses(config.collectorAddress ?? '');
    if (parsed.length === 0) {
      logger.error('Collector server addresses are not set.');
      logger.error('Agent will not uplink any data.');
      this.configuredServers = [];
      this.grpcServers = [];
      this.notify(GRPCChannelStatus.DISCONNECT);
      return;
    }

    // Keep config order so channel authority / SNI stay stable when not expanding.
    // Endpoint pick order is shuffled by pick_first.shuffleAddressList in service_config.
    this.configuredServers = [...parsed];
    this.grpcServers = [...parsed];

    if (config.isResolveDnsPeriodically && shouldExpandBackendDns(parsed)) {
      this.dnsAuthority = firstHostnameAuthority(parsed);
      // Start the timer immediately so a hung initial lookup cannot block later retries.
      this.startDnsRefreshTimer();
      void this.refreshResolvedBackends(true).catch((error) => {
        logger.error(`Initial DNS expand failed: ${error}`);
      });
      return;
    }

    this.openChannel(parsed);
  }

  onComplete(): void {}

  shutdown(): void {
    this.closed = true;
    this.stopDnsRefreshTimer();
    const managed = this.managedChannel;
    this.managedChannel = null;
    managed?.shutdownNow();
    this.notify(GRPCChannelStatus.DISCONNECT);
    this.listeners.length = 0;
    this.configuredServers = [];
    this.grpcServers = [];
    this.lastResolvedByConfigured = new Map();
    this.dnsAuthority = undefined;
    this.dialingExpandedAddresses = false;
    this.dnsOpenNeedsRetry = false;
    this.suppressDnsRebuildStatusLog = false;
    this.dnsRefreshCount = 0;
    this.lastConnectivityState = null;
  }

  private startDnsRefreshTimer(): void {
    this.stopDnsRefreshTimer();
    this.dnsRefreshTimer = setInterval(() => {
      void this.refreshResolvedBackends(false).catch((error) => {
        logger.error(`Periodic DNS re-resolve failed: ${error}`);
      });
    }, dnsReResolveIntervalMs());
    this.dnsRefreshTimer.unref();
  }

  private stopDnsRefreshTimer(): void {
    if (this.dnsRefreshTimer) {
      clearInterval(this.dnsRefreshTimer);
      this.dnsRefreshTimer = null;
    }
  }

  /**
   * Expand configured hostnames to IP endpoints. Opens or rebuilds the channel when
   * forceOpen is set or the resolved set changed. Empty resolve keeps the previous channel.
   *
   * Failed names keep their last successful endpoints (merged dial set) so a partial DNS
   * outage neither shrinks a healthy channel nor blocks recovery when another name's IPs
   * change while the channel is down. Overlapping timer ticks are skipped (same as Java
   * GRPCChannelManager's single-thread scheduleAtFixedRate). Unlike Java, re-resolve runs
   * while the channel is connected so multi-name backends can pick up DNS changes without
   * waiting for a disconnect.
   */
  private async refreshResolvedBackends(forceOpen: boolean): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.dnsRefreshInFlight) {
      return;
    }
    this.dnsRefreshInFlight = true;
    try {
      const {
        addresses: expanded,
        hadLookupFailure,
        byConfigured,
      } = await expandBackendAddresses(this.configuredServers, { previousByConfigured: this.lastResolvedByConfigured });
      this.lastResolvedByConfigured = byConfigured;
      this.dnsRefreshCount += 1;
      if (this.closed) {
        return;
      }
      if (expanded.length === 0) {
        if (this.managedChannel) {
          logDnsExpandEmpty(
            `DNS expand produced no backends for [${this.configuredServers.join(',')}]; keeping previous channel`,
          );
        } else {
          logDnsExpandEmpty(
            `DNS expand produced no backends for [${this.configuredServers.join(',')}]; channel not opened`,
          );
          if (forceOpen) {
            this.notify(GRPCChannelStatus.DISCONNECT);
          }
        }
        return;
      }
      if (hadLookupFailure) {
        logDnsExpandIncomplete(
          `DNS expand incomplete for [${this.configuredServers.join(
            ',',
          )}]; using last-known endpoints for unresolved names`,
        );
      }
      // Retry open when the previous build failed even if the address set is unchanged.
      if (!forceOpen && this.managedChannel && sameAddressSet(expanded, this.grpcServers) && !this.dnsOpenNeedsRetry) {
        logger.debug('Periodic DNS re-resolve: backend address set unchanged');
        return;
      }
      if (!forceOpen && this.managedChannel && !this.dnsOpenNeedsRetry) {
        logger.info(
          `Periodic DNS re-resolve: backend set changed [${this.grpcServers.join(',')}] -> [${expanded.join(
            ',',
          )}]; rebuilding channel`,
        );
      }
      this.dialingExpandedAddresses = true;
      if (this.openChannel(expanded)) {
        this.grpcServers = expanded;
        this.dnsOpenNeedsRetry = false;
      } else {
        this.dnsOpenNeedsRetry = true;
      }
    } finally {
      this.dnsRefreshInFlight = false;
    }
  }

  /** @returns true when a channel was installed. */
  private openChannel(addresses: string[]): boolean {
    if (this.closed || addresses.length === 0) {
      return false;
    }

    let target: string;
    try {
      target = buildNativeGrpcTarget(addresses, { forceStatic: this.dialingExpandedAddresses });
    } catch (error) {
      logger.error(`Failed to build gRPC target: ${error}`);
      // Keep a working prior channel; only disconnect when nothing is installed.
      if (!this.managedChannel) {
        this.notify(GRPCChannelStatus.DISCONNECT);
      }
      return false;
    }

    let built: GRPCChannel;
    try {
      built = GRPCChannel.newBuilder(target)
        .withChannelOptions(nativeChannelOptions(this.dnsAuthority))
        .addManagedChannelBuilder(new StandardChannelBuilder())
        .addManagedChannelBuilder(new TLSChannelBuilder())
        .addChannelDecorator(new AgentIDDecorator())
        .addChannelDecorator(new AuthenticationDecorator())
        .build();
    } catch (error) {
      logger.error(`Failed to build gRPC channel for target [${target}]: ${error}`);
      if (!this.managedChannel) {
        this.notify(GRPCChannelStatus.DISCONNECT);
      }
      return false;
    }

    // Shutdown may have completed while builders ran (TLS file I/O).
    if (this.closed) {
      built.shutdownNow();
      return false;
    }

    const previous = this.managedChannel;
    this.managedChannel = built;
    // Close any prior channel when openChannel is invoked again (DNS rebuild).
    previous?.shutdownNow();
    if (previous) {
      // statusChanged is deduped on CONNECTED→CONNECTED. After replacing the underlying
      // grpc.Channel, force DISCONNECT so Trace/Meter/Management recreate stubs on the next
      // CONNECTED (otherwise they keep channelOverride on the shut-down channel).
      this.lastConnectivityState = null;
      if (this.lastStatus === GRPCChannelStatus.CONNECTED) {
        // Quiet until CONNECTED is published (may be async via watch — do not clear here).
        this.suppressDnsRebuildStatusLog = true;
        try {
          this.notify(GRPCChannelStatus.DISCONNECT);
        } catch (error) {
          this.suppressDnsRebuildStatusLog = false;
          throw error;
        }
      } else if (this.lastStatus === GRPCChannelStatus.DISCONNECT) {
        // Already DISCONNECT (e.g. prior rebuild still CONNECTING). Keep the quiet window so
        // a later TRANSIENT_FAILURE can emit logDnsRebuildFailedToConnect instead of a
        // deduped no-op notify(DISCONNECT).
        this.suppressDnsRebuildStatusLog = true;
      } else {
        this.suppressDnsRebuildStatusLog = false;
      }
    } else {
      this.suppressDnsRebuildStatusLog = false;
    }
    this.watchConnectivityState();
    // watchConnectivityState already requested a connection; do not request again.
    this.notifyCurrentConnectivityState(false);
    // Shutdown may have raced after install — do not report success / commit grpcServers.
    if (this.closed || this.managedChannel !== built) {
      this.suppressDnsRebuildStatusLog = false;
      if (this.managedChannel === built) {
        this.managedChannel = null;
        built.shutdownNow();
      }
      return false;
    }
    return true;
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
    // Handshake in progress — do not treat as disconnect; keep rebuild quiet window.
    if (state === grpc.connectivityState.CONNECTING) {
      return;
    }
    // Rebuild quiet window ends if the new channel leaves CONNECTING without READY
    // (IDLE / TRANSIENT_FAILURE / SHUTDOWN). The intentional rebuild already set
    // lastStatus=DISCONNECT with logs suppressed; notify(DISCONNECT) would no-op, so
    // emit the real outage diagnostic here.
    if (this.suppressDnsRebuildStatusLog) {
      this.suppressDnsRebuildStatusLog = false;
      if (this.lastStatus === GRPCChannelStatus.DISCONNECT) {
        this.logDnsRebuildFailedToConnect();
      }
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
    // End the DNS-rebuild quiet window once CONNECTED is delivered (sync or via watch).
    if (this.suppressDnsRebuildStatusLog && status === GRPCChannelStatus.CONNECTED) {
      this.suppressDnsRebuildStatusLog = false;
    }

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
    if (this.suppressDnsRebuildStatusLog) {
      return;
    }
    const backends = this.configuredServers.join(',') || this.grpcServers.join(',') || config.collectorAddress || '';
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

  /** Outage log when a DNS rebuild replacement never becomes READY (status already DISCONNECT). */
  private logDnsRebuildFailedToConnect(): void {
    if (this.closed) {
      return;
    }
    const backends = this.configuredServers.join(',') || this.grpcServers.join(',') || config.collectorAddress || '';
    logChannelDisconnected(
      `gRPC channel not connected to backends [${backends}] after DNS rebuild; connecting with exponential backoff`,
    );
  }
}
