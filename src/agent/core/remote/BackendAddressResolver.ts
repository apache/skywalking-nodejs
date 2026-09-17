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

import * as dns from 'dns';
import * as net from 'net';
import * as grpc from '@grpc/grpc-js';
import { createLogger, throttled } from '../../../logging';

const logger = createLogger(__filename);
const logDnsLookupEmpty = throttled(logger, 'error', 30_000);
const logDnsLookupFailed = throttled(logger, 'error', 30_000);

const SW_STATIC_SCHEME = 'sw-static';

let swStaticResolverRegistered = false;

/** Lookup returning all A/AAAA records (injectable for tests). */
export type DnsLookupAll = (hostname: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const defaultDnsLookupAll: DnsLookupAll = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/** Per-hostname DNS lookup deadline (ms). Hung lookups fail open to the next name / tick. */
export const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/**
 * In-flight getaddrinfo cannot be cancelled after the wait timeout. Deduplicate by
 * (lookup, hostname) so periodic ticks reuse the same pending query instead of
 * stacking libc/thread-pool work under slow DNS.
 */
const inflightLookups = new WeakMap<
  DnsLookupAll,
  Map<string, Promise<ReadonlyArray<{ address: string; family: number }>>>
>();

function inflightMapFor(
  lookup: DnsLookupAll,
): Map<string, Promise<ReadonlyArray<{ address: string; family: number }>>> {
  let map = inflightLookups.get(lookup);
  if (!map) {
    map = new Map();
    inflightLookups.set(lookup, map);
  }
  return map;
}

async function lookupWithTimeout(
  hostname: string,
  lookup: DnsLookupAll,
  timeoutMs: number = DNS_LOOKUP_TIMEOUT_MS,
): Promise<ReadonlyArray<{ address: string; family: number }>> {
  const inflight = inflightMapFor(lookup);
  let lookupPromise = inflight.get(hostname);
  if (!lookupPromise) {
    lookupPromise = lookup(hostname);
    inflight.set(hostname, lookupPromise);
    // Keep a rejection handler so a late failure after timeout does not surface as
    // an unhandledRejection; drop the map entry once the underlying query settles.
    void lookupPromise
      .finally(() => {
        if (inflight.get(hostname) === lookupPromise) {
          inflight.delete(hostname);
        }
      })
      .catch(() => undefined);
  }

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      lookupPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`DNS lookup timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Parse one host:port via grpc.experimental.splitHostPort.
 * Returns normalized host:port or null when invalid (logged at error).
 */
export function tryParseHostPort(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = grpc.experimental.splitHostPort(trimmed);
  if (!parsed?.host || parsed.port == null) {
    logger.error(`Invalid collector address: ${entry}`);
    return null;
  }
  if (parsed.port <= 0 || parsed.port > 65535) {
    logger.error(`Invalid collector address (bad port): ${entry}`);
    return null;
  }
  const host = parsed.host.includes(':') ? `[${parsed.host}]` : parsed.host;
  return `${host}:${parsed.port}`;
}

/** Parse comma-separated backend host:port entries. Invalid entries are logged and dropped. */
export function parseStaticBackendAddresses(raw: string): string[] {
  const result: string[] = [];
  for (const part of raw.split(',')) {
    const normalized = tryParseHostPort(part);
    if (normalized) {
      result.push(normalized);
    }
  }
  return result;
}

/** True when host is an IPv4/IPv6 literal (optional brackets for v6). */
export function isIpLiteral(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return net.isIP(trimmed.slice(1, -1)) !== 0;
  }
  return net.isIP(trimmed) !== 0;
}

function formatHostPort(host: string, port: number): string {
  const normalized = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${normalized}:${port}`;
}

/**
 * Whether multi-backend DNS expand + periodic re-resolve should run.
 * Single-address targets use grpc-js dns:; all-IP lists need no lookup.
 */
export function shouldExpandBackendDns(addresses: string[]): boolean {
  if (addresses.length <= 1) {
    return false;
  }
  for (const entry of addresses) {
    const parsed = grpc.experimental.splitHostPort(entry);
    if (parsed?.host && !isIpLiteral(parsed.host)) {
      return true;
    }
  }
  return false;
}

/**
 * Expand hostnames to all A/AAAA addresses (IPs kept as-is). Failed names are
 * logged and skipped; returns [] addresses when nothing resolved.
 * `hadLookupFailure` is true when at least one hostname threw/timed out or
 * returned no A/AAAA.
 *
 * Pass `previousByConfigured` so a failed name keeps its last successful
 * endpoints — callers can dial a stable merged set instead of shrinking on
 * partial DNS outages (and still pick up IP changes from names that resolved).
 */
export type ExpandBackendResult = {
  addresses: string[];
  hadLookupFailure: boolean;
  /** Per configured host:port → endpoints after this expand (includes kept previous). */
  byConfigured: Map<string, string[]>;
};

export type ExpandBackendOptions = {
  lookup?: DnsLookupAll;
  previousByConfigured?: ReadonlyMap<string, readonly string[]>;
};

export async function expandBackendAddresses(
  addresses: string[],
  lookupOrOptions: DnsLookupAll | ExpandBackendOptions = defaultDnsLookupAll,
): Promise<ExpandBackendResult> {
  let lookup: DnsLookupAll = defaultDnsLookupAll;
  let previousByConfigured: ReadonlyMap<string, readonly string[]> = new Map();
  if (typeof lookupOrOptions === 'function') {
    lookup = lookupOrOptions;
  } else {
    lookup = lookupOrOptions.lookup ?? defaultDnsLookupAll;
    previousByConfigured = lookupOrOptions.previousByConfigured ?? new Map();
  }

  const byConfigured = new Map<string, string[]>();
  const expanded: string[] = [];
  const seen = new Set<string>();
  let hadLookupFailure = false;

  const appendUnique = (endpoints: readonly string[]) => {
    for (const endpoint of endpoints) {
      if (!seen.has(endpoint)) {
        seen.add(endpoint);
        expanded.push(endpoint);
      }
    }
  };

  for (const entry of addresses) {
    const parsed = grpc.experimental.splitHostPort(entry);
    if (!parsed?.host || parsed.port == null) {
      continue;
    }
    const { host, port } = parsed;

    if (isIpLiteral(host)) {
      const normalized = formatHostPort(host.startsWith('[') ? host.slice(1, -1) : host, port);
      byConfigured.set(entry, [normalized]);
      appendUnique([normalized]);
      continue;
    }

    try {
      const records = await lookupWithTimeout(host, lookup);
      if (!records.length) {
        // Same as throw/timeout: incomplete expand must not drop prior endpoints.
        hadLookupFailure = true;
        logDnsLookupEmpty(`DNS lookup for backend [${host}] returned no addresses`);
        const previous = previousByConfigured.get(entry);
        if (previous?.length) {
          byConfigured.set(entry, [...previous]);
          appendUnique(previous);
        }
        continue;
      }
      const endpoints: string[] = [];
      for (const record of records) {
        endpoints.push(formatHostPort(record.address, port));
      }
      byConfigured.set(entry, endpoints);
      appendUnique(endpoints);
    } catch (error) {
      hadLookupFailure = true;
      logDnsLookupFailed(`Failed to resolve backend [${host}]`, error);
      const previous = previousByConfigured.get(entry);
      if (previous?.length) {
        byConfigured.set(entry, [...previous]);
        appendUnique(previous);
      }
    }
  }

  return { addresses: expanded, hadLookupFailure, byConfigured };
}

/** True when both lists contain the same host:port values (order-independent). */
export function sameAddressSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) {
      return false;
    }
  }
  return true;
}

/**
 * First non-IP hostname in the configured list — used after expanding backends to IP
 * literals (e.g. `10.0.0.1:11800,oap-b.svc:11800`).
 *
 * `authority` keeps host:port for HTTP/2 `:authority` (proxies may match on port).
 * `serverName` is hostname-only for TLS SNI / ssl_target_name_override.
 */
export type DnsAuthority = {
  authority: string;
  serverName: string;
};

export function firstHostnameAuthority(addresses: string[]): DnsAuthority | undefined {
  for (const entry of addresses) {
    const parsed = grpc.experimental.splitHostPort(entry);
    if (parsed?.host && parsed.port != null && !isIpLiteral(parsed.host)) {
      return {
        authority: formatHostPort(parsed.host, parsed.port),
        serverName: parsed.host,
      };
    }
  }
  return undefined;
}

/**
 * Build a grpc-js channel target.
 * - One address: plain host:port (default dns: resolver — multi-IP + periodic re-resolve + natural TLS authority),
 *   unless forceStatic is set (DNS-expanded IP lists always use sw-static, even for a single IP).
 * - Multiple: sw-static:/// list for pick_first across explicit backends.
 */
export function buildNativeGrpcTarget(addresses: string[], options: { forceStatic?: boolean } = {}): string {
  // Caller (openChannel) already requires a non-empty list.
  if (addresses.length === 1 && !options.forceStatic) {
    return addresses[0]!;
  }
  ensureSwStaticResolverRegistered();
  return `${SW_STATIC_SCHEME}:///${addresses.join(',')}`;
}

function ensureSwStaticResolverRegistered(): void {
  if (swStaticResolverRegistered) {
    return;
  }
  const { registerResolver, statusOrFromValue, statusOrFromError, splitHostPort: grpcSplit } = grpc.experimental;

  /**
   * Static multi-address resolver for comma-separated backends.
   * Mirrors grpc-js resolver-ip.js (static endpoint list, no DNS expansion).
   */
  class SwStaticResolver {
    private readonly listener: grpc.experimental.ResolverListener;
    private readonly endpoints: grpc.experimental.Endpoint[];
    private readonly error: { code: number; details: string; metadata: grpc.Metadata } | null;
    private hasReturnedResult = false;
    private destroyed = false;

    constructor(
      target: grpc.experimental.GrpcUri,
      listener: grpc.experimental.ResolverListener,
      _channelOptions: grpc.ChannelOptions,
    ) {
      this.listener = listener;
      this.endpoints = [];
      this.error = null;

      if (target.scheme !== SW_STATIC_SCHEME) {
        this.error = {
          code: grpc.status.UNAVAILABLE,
          details: `Unrecognized scheme ${target.scheme} in sw-static resolver`,
          metadata: new grpc.Metadata(),
        };
        return;
      }

      const pathList = target.path
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      const endpoints: grpc.experimental.Endpoint[] = [];
      for (const path of pathList) {
        const hp = grpcSplit(path);
        if (!hp?.host || hp.port == null) {
          this.error = {
            code: grpc.status.UNAVAILABLE,
            details: `Failed to parse sw-static address ${path}`,
            metadata: new grpc.Metadata(),
          };
          return;
        }
        endpoints.push({ addresses: [{ host: hp.host, port: hp.port }] });
      }
      this.endpoints = endpoints;
    }

    updateResolution(): void {
      // Channel.close() calls destroy() then may still invoke updateResolution; ignore both.
      if (this.destroyed || this.hasReturnedResult) {
        return;
      }
      this.hasReturnedResult = true;
      process.nextTick(() => {
        // Drop results scheduled before destroy — otherwise grpc-js reconnects after close
        // (boot→immediate shutdown race) while the manager has already dropped the channel.
        if (this.destroyed) {
          return;
        }
        if (this.error) {
          this.listener(statusOrFromError(this.error), {}, null, '');
        } else {
          this.listener(statusOrFromValue(this.endpoints), {}, null, '');
        }
      });
    }

    destroy(): void {
      this.destroyed = true;
    }

    static getDefaultAuthority(target: grpc.experimental.GrpcUri): string {
      const first = target.path.split(',')[0]?.trim();
      if (!first) {
        throw new Error('sw-static target path must contain at least one host:port');
      }
      return first;
    }
  }

  registerResolver(SW_STATIC_SCHEME, SwStaticResolver);
  swStaticResolverRegistered = true;
}
