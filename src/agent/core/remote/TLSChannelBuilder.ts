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
import config from '../../../config/AgentConfig';
import { createLogger } from '../../../logging';
import ChannelBuilder, { ChannelBuildContext } from './ChannelBuilder';
import { deriveTlsServerNameForConnectHost } from './BackendAddressResolver';
import { getTlsMaterials, isCaFileAvailableFromPreload } from './TlsMaterialCache';

const logger = createLogger(__filename);

/** {@code SW_AGENT_FORCE_TLS} or {@code SW_AGENT_SECURE} (Node extension of Java force_tls). */
function isTlsRequiredByConfig(): boolean {
  return Boolean(config.forceTls || config.secure);
}

/**
 * Java {@code TLSChannelBuilder}: {@code FORCE_TLS || caFileExists} enables TLS negotiation.
 * CA presence comes from async {@link preloadTlsMaterials} (no sync stat on the event loop).
 */
function shouldUseTls(): boolean {
  return isTlsRequiredByConfig() || Boolean(getTlsMaterials()?.rootCerts) || isCaFileAvailableFromPreload();
}

export function isTlsEnabled(): boolean {
  return shouldUseTls();
}

/**
 * If only ca.crt exists, start TLS. If cert, key and ca files exist, enable mTLS.
 * Aligned with Java {@code TLSChannelBuilder}. TLS files must be preloaded via
 * {@link preloadTlsMaterials} before channel build when a CA file is present.
 */
export default class TLSChannelBuilder implements ChannelBuilder {
  build(context: ChannelBuildContext): ChannelBuildContext {
    if (!shouldUseTls()) {
      return context;
    }

    const materials = getTlsMaterials();
    const rootCerts = materials?.rootCerts ?? null;
    const privateKey = materials?.privateKey ?? null;
    const certChain = materials?.certChain ?? null;

    let credentials: grpc.ChannelCredentials;

    if (rootCerts) {
      if (Boolean(config.sslCertChainPath) && Boolean(config.sslKeyPath)) {
        if (!privateKey || !certChain) {
          logger.error('mTLS configured but client cert or key material is unavailable; refusing channel build.');
          throw new Error('mTLS material unavailable');
        }
        credentials = grpc.credentials.createSsl(rootCerts, privateKey, certChain);
      } else {
        credentials = grpc.credentials.createSsl(rootCerts, privateKey, certChain);
      }
    } else if (isTlsRequiredByConfig()) {
      logger.warn(
        'TLS enabled without trusted CA file (SW_AGENT_FORCE_TLS); using system trust store (Java force_tls parity).',
      );
      credentials = grpc.credentials.createSsl();
    } else {
      logger.error('TLS required but trusted CA material is unavailable; refusing insecure channel.');
      throw new Error('TLS material unavailable');
    }

    const options: grpc.ChannelOptions = { ...context.options };
    const tlsServerName =
      context.tlsServerName ??
      (context.connectHost
        ? deriveTlsServerNameForConnectHost(context.connectHost, config.collectorAddress ?? '')
        : undefined);
    if (tlsServerName) {
      options['grpc.ssl_target_name_override'] = tlsServerName;
    }

    return {
      ...context,
      credentials,
      options,
    };
  }
}

export { preloadTlsMaterials } from './TlsMaterialCache';
