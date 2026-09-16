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

import * as fs from 'fs';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import { ChannelOptions } from '@grpc/grpc-js';
import config from '../../../config/AgentConfig';
import { createLogger } from '../../../logging';
import ChannelBuilder, { ChannelBuildContext } from './ChannelBuilder';

const logger = createLogger(__filename);

function configuredPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : undefined;
}

function readCertificateFile(filePath: string, description: string): Buffer {
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${description} at [${filePath}]: ${message}`);
  }
}

/**
 * Build TLS or mTLS credentials from the agent configuration.
 * Client authentication is enabled only when both the private key and cert chain are configured.
 */
export default class TLSChannelBuilder implements ChannelBuilder {
  build(context: ChannelBuildContext): ChannelBuildContext {
    const trustedCaPath = configuredPath(config.sslTrustedCaPath);
    const keyPath = configuredPath(config.sslKeyPath);
    const certChainPath = configuredPath(config.sslCertChainPath);
    const hasTlsMaterial = trustedCaPath || keyPath || certChainPath;

    if (!config.secure) {
      if (hasTlsMaterial) {
        throw new Error('TLS certificate configuration requires secure=true');
      }
      return context;
    }

    if (Boolean(keyPath) !== Boolean(certChainPath)) {
      throw new Error('Both sslKeyPath and sslCertChainPath must be configured to enable mTLS');
    }

    const rootCerts = trustedCaPath ? readCertificateFile(trustedCaPath, 'the trusted CA certificate') : undefined;
    const privateKey = keyPath ? readCertificateFile(keyPath, 'the client private key') : undefined;
    const certChain = certChainPath ? readCertificateFile(certChainPath, 'the client certificate chain') : undefined;

    const credentials = grpc.credentials.createSsl(rootCerts, privateKey, certChain);

    logger.debug(
      `gRPC TLS credentials built: ca=${trustedCaPath ?? '(system)'} key=${keyPath ?? '(none)'} cert=${
        certChainPath ?? '(none)'
      }`,
    );

    const sslTargetNameOverride = config.sslTargetNameOverride?.trim();
    const extraOptions: ChannelOptions = {};
    if (sslTargetNameOverride) {
      extraOptions['grpc.ssl_target_name_override'] = sslTargetNameOverride;
      extraOptions['grpc.default_authority'] = sslTargetNameOverride;
      logger.debug(`gRPC TLS hostname override set to [${sslTargetNameOverride}]`);
    }

    return {
      ...context,
      credentials,
      options: { ...context.options, ...extraOptions },
    };
  }
}
