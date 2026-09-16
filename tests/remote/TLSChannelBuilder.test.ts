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

/* eslint-env jest */

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import config from '../../src/config/AgentConfig';
import TLSChannelBuilder from '../../src/agent/core/remote/TLSChannelBuilder';
import { ChannelBuildContext } from '../../src/agent/core/remote/ChannelBuilder';

describe('TLSChannelBuilder', () => {
  const originalSecure = config.secure;
  const originalTrustedCaPath = config.sslTrustedCaPath;
  const originalKeyPath = config.sslKeyPath;
  const originalCertChainPath = config.sslCertChainPath;
  const originalTargetNameOverride = config.sslTargetNameOverride;
  const credentials = {} as grpc.ChannelCredentials;
  let createSsl: jest.SpyInstance;
  const readFileSync = fs.readFileSync as jest.Mock;

  beforeEach(() => {
    config.secure = false;
    delete config.sslTrustedCaPath;
    delete config.sslKeyPath;
    delete config.sslCertChainPath;
    delete config.sslTargetNameOverride;
    createSsl = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue(credentials);
    readFileSync.mockReset();
  });

  afterEach(() => {
    config.secure = originalSecure;
    config.sslTrustedCaPath = originalTrustedCaPath;
    config.sslKeyPath = originalKeyPath;
    config.sslCertChainPath = originalCertChainPath;
    config.sslTargetNameOverride = originalTargetNameOverride;
    jest.restoreAllMocks();
  });

  function context(): ChannelBuildContext {
    return {
      credentials: {} as grpc.ChannelCredentials,
      options: {},
    };
  }

  it('leaves insecure credentials unchanged when TLS is disabled', () => {
    const input = context();

    expect(new TLSChannelBuilder().build(input)).toBe(input);
    expect(createSsl).not.toHaveBeenCalled();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('rejects TLS material when secure is disabled', () => {
    config.sslKeyPath = 'client.key';

    expect(() => new TLSChannelBuilder().build(context())).toThrow('secure=true');
    expect(createSsl).not.toHaveBeenCalled();
  });

  it('uses system trust when secure TLS has no custom CA', () => {
    config.secure = true;

    new TLSChannelBuilder().build(context());

    expect(createSsl).toHaveBeenCalledWith(undefined, undefined, undefined);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('loads a custom CA for one-way TLS', () => {
    config.secure = true;
    config.sslTrustedCaPath = 'certs/ca.crt';
    const ca = Buffer.from('ca');
    readFileSync.mockReturnValue(ca);

    new TLSChannelBuilder().build(context());

    expect(readFileSync).toHaveBeenCalledWith(path.resolve('certs/ca.crt'));
    expect(createSsl).toHaveBeenCalledWith(ca, undefined, undefined);
  });

  it('loads CA, client key, and client certificate chain for mTLS', () => {
    config.secure = true;
    config.sslTrustedCaPath = 'certs/ca.crt';
    config.sslKeyPath = 'certs/client.key';
    config.sslCertChainPath = 'certs/client.crt';
    const ca = Buffer.from('ca');
    const key = Buffer.from('key');
    const certChain = Buffer.from('cert-chain');
    readFileSync.mockImplementation((filePath: string) => {
      const files: Record<string, Buffer> = {
        [path.resolve('certs/ca.crt')]: ca,
        [path.resolve('certs/client.key')]: key,
        [path.resolve('certs/client.crt')]: certChain,
      };
      return files[filePath]!;
    });

    new TLSChannelBuilder().build(context());

    expect(createSsl).toHaveBeenCalledWith(ca, key, certChain);
    expect(readFileSync).toHaveBeenCalledTimes(3);
  });

  it('requires both client key and certificate chain for mTLS', () => {
    config.secure = true;
    config.sslKeyPath = 'certs/client.key';

    expect(() => new TLSChannelBuilder().build(context())).toThrow(
      'Both sslKeyPath and sslCertChainPath must be configured',
    );
    expect(readFileSync).not.toHaveBeenCalled();
    expect(createSsl).not.toHaveBeenCalled();
  });

  it('fails closed when configured certificate material cannot be read', () => {
    config.secure = true;
    config.sslKeyPath = 'certs/client.key';
    config.sslCertChainPath = 'certs/client.crt';
    readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(() => new TLSChannelBuilder().build(context())).toThrow('Failed to read the client private key');
    expect(createSsl).not.toHaveBeenCalled();
  });

  it('sets grpc.ssl_target_name_override when configured', () => {
    config.secure = true;
    config.sslTrustedCaPath = 'certs/ca.crt';
    config.sslTargetNameOverride = 'oap.svc.cluster.local';
    const ca = Buffer.from('ca');
    readFileSync.mockReturnValue(ca);

    const result = new TLSChannelBuilder().build(context());

    expect(result.options['grpc.ssl_target_name_override']).toBe('oap.svc.cluster.local');
    expect(result.options['grpc.default_authority']).toBe('oap.svc.cluster.local');
    expect(createSsl).toHaveBeenCalledWith(ca, undefined, undefined);
  });

  it('skips hostname override when not configured', () => {
    config.secure = true;

    const result = new TLSChannelBuilder().build(context());

    expect(result.options['grpc.ssl_target_name_override']).toBeUndefined();
    expect(result.options['grpc.default_authority']).toBeUndefined();
  });
});
