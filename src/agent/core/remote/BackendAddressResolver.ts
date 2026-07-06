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

import { promises as dnsPromises } from 'dns';
import net from 'net';
import { createLogger } from '../../../logging';

const logger = createLogger(__filename);

/** Cap DNS expansion to avoid unbounded memory on hostile or misconfigured resolvers. */
export const MAX_DNS_LOOKUP_RECORDS = 64;

/** Abort slow DNS lookups so channel checks do not stall the event loop. */
export const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/** Resolved gRPC target with optional TLS SNI hostname (H-2 per-entry mapping). */
export interface BackendTarget {
  target: string;
  /** Hostname for grpc.ssl_target_name_override when target is a resolved IP. */
  tlsServerName?: string;
}

export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim?: boolean },
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: DnsLookupFn = (hostname, options) =>
  dnsPromises.lookup(hostname, options) as ReturnType<DnsLookupFn>;

export async function lookupBackendHostRecords(
  hostname: string,
  lookup: DnsLookupFn = defaultLookup,
  timeoutMs: number = DNS_LOOKUP_TIMEOUT_MS,
): Promise<Array<{ address: string; family: number }>> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    const records = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('DNS lookup timeout')), timeoutMs);
        timeoutHandle.unref();
      }),
    ]);
    if (records.length > MAX_DNS_LOOKUP_RECORDS) {
      logger.warn('DNS returned %s records for %s; using first %s', records.length, hostname, MAX_DNS_LOOKUP_RECORDS);
      return records.slice(0, MAX_DNS_LOOKUP_RECORDS);
    }
    return records;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

/** Parse comma-separated backend entries (Java BACKEND_SERVICE split). */
export function parseStaticBackendAddresses(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter(isValidHostPortEntry);
}

function isValidHostPortEntry(entry: string): boolean {
  try {
    const { host, port } = splitHostPort(entry);
    const portNum = Number.parseInt(port, 10);
    return Boolean(host) && !Number.isNaN(portNum) && portNum > 0 && portNum <= 65535;
  } catch {
    logger.debug('Service address [%s] format error. Expected host:port', entry);
    return false;
  }
}

/** Split host:port, supporting bracketed IPv6 literals such as [::1]:11800. */
export function splitHostPort(entry: string): { host: string; port: string } {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new Error(`Invalid host:port entry: ${entry}`);
  }
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close < 0 || trimmed[close + 1] !== ':') {
      throw new Error(`Invalid host:port entry: ${entry}`);
    }
    return { host: trimmed.slice(1, close), port: trimmed.slice(close + 2) };
  }
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0) {
    throw new Error(`Invalid host:port entry: ${entry}`);
  }
  return { host: trimmed.slice(0, lastColon), port: trimmed.slice(lastColon + 1) };
}

/** Format host:port for grpc target strings; IPv6 hosts are bracketed. */
export function formatHostPort(host: string, port: string | number): string {
  const portText = String(port);
  if (net.isIPv6(host)) {
    return `[${host}]:${portText}`;
  }
  return `${host}:${portText}`;
}

export function isLiteralIp(host: string): boolean {
  return net.isIP(host) !== 0;
}

/**
 * Expand backend entries to targets (Java InetAddress.getAllByName).
 * When resolveDns=false, returns static entries only.
 * DNS-expanded IPs carry tlsServerName from the source hostname for grpc-js SNI.
 */
export async function expandBackendAddresses(
  entries: string[],
  resolveDns: boolean,
  lookup: DnsLookupFn = defaultLookup,
): Promise<BackendTarget[]> {
  const byTarget = new Map<string, BackendTarget>();

  const addTarget = (item: BackendTarget): void => {
    const existing = byTarget.get(item.target);
    if (!existing) {
      byTarget.set(item.target, item);
      return;
    }
    if (existing.tlsServerName && item.tlsServerName && existing.tlsServerName !== item.tlsServerName) {
      logger.warn(
        'Target %s resolves from multiple hostnames (%s vs %s); TLS SNI uses %s',
        item.target,
        existing.tlsServerName,
        item.tlsServerName,
        existing.tlsServerName,
      );
    }
  };

  for (const entry of entries) {
    if (!isValidHostPortEntry(entry)) {
      continue;
    }
    const { host, port } = splitHostPort(entry);

    if (!resolveDns || isLiteralIp(host)) {
      addTarget({ target: formatHostPort(host, port) });
      continue;
    }

    try {
      const records = await lookupBackendHostRecords(host, lookup);
      for (const record of records) {
        addTarget({
          target: formatHostPort(record.address, port),
          tlsServerName: isLiteralIp(record.address) ? host : undefined,
        });
      }
    } catch (error) {
      logger.error('Failed to resolve %s of backend service.', host, error);
    }
  }

  return Array.from(byTarget.values());
}

/**
 * Fallback TLS SNI when per-target tlsServerName is unavailable (legacy / static IP lists).
 * Prefer {@link BackendTarget.tlsServerName} from {@link expandBackendAddresses}.
 */

/** Count distinct non-IP hostnames in collectorAddress (comma-separated). */
export function countDistinctNonIpHostnames(raw: string): number {
  const hosts = new Set<string>();
  for (const entry of parseStaticBackendAddresses(raw)) {
    const { host } = splitHostPort(entry);
    if (host && !isLiteralIp(host)) {
      hosts.add(host.toLowerCase());
    }
  }
  return hosts.size;
}

let multiHostnameTlsWarned = false;

/** @deprecated Multi-hostname TLS SNI is handled per {@link BackendTarget}; kept for API compat. */
export function warnMultiHostnameTlsConstraint(_collectorAddress: string): void {
  // no-op: per-target tlsServerName mapping supersedes first-hostname-only SNI
}

/** @internal test hook */
export function resetMultiHostnameTlsWarnForTest(): void {
  multiHostnameTlsWarned = false;
}

export function deriveTlsServerNameForConnectHost(connectHost: string, collectorAddress: string): string | undefined {
  if (!isLiteralIp(connectHost)) {
    return undefined;
  }
  for (const entry of parseStaticBackendAddresses(collectorAddress)) {
    const { host } = splitHostPort(entry);
    if (host && !isLiteralIp(host)) {
      return host;
    }
  }
  return undefined;
}
