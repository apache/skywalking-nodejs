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
import { createLogger } from '../../../logging';

const logger = createLogger(__filename);

const SW_STATIC_SCHEME = 'sw-static';

let swStaticResolverRegistered = false;

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

/**
 * Build a grpc-js channel target.
 * - One address: plain host:port (default dns: resolver — multi-IP + periodic re-resolve + natural TLS authority).
 * - Multiple: sw-static:/// list for pick_first across explicit backends (literal endpoints only;
 *   no DNS expansion / re-resolution of each name — weaker discovery than a single dns: target).
 */
export function buildNativeGrpcTarget(addresses: string[]): string {
  // Caller (openChannel) already requires a non-empty list.
  if (addresses.length === 1) {
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
      if (this.hasReturnedResult) {
        return;
      }
      this.hasReturnedResult = true;
      process.nextTick(() => {
        if (this.error) {
          this.listener(statusOrFromError(this.error), {}, null, '');
        } else {
          this.listener(statusOrFromValue(this.endpoints), {}, null, '');
        }
      });
    }

    destroy(): void {
      this.hasReturnedResult = false;
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
