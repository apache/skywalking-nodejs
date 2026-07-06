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

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import * as grpc from '@grpc/grpc-js';
import { getAgentPackagePath } from '../../src/agent/core/boot/AgentPackagePath';
import config from '../../src/config/AgentConfig';
import TLSChannelBuilder from '../../src/agent/core/remote/TLSChannelBuilder';
import StandardChannelBuilder from '../../src/agent/core/remote/StandardChannelBuilder';
import { clearTlsMaterialCacheForTest, preloadTlsMaterials } from '../../src/agent/core/remote/TlsMaterialCache';

describe('TLSChannelBuilder (Java TLSChannelBuilder parity)', () => {
  const original = {
    secure: config.secure,
    forceTls: config.forceTls,
    sslTrustedCaPath: config.sslTrustedCaPath,
    sslCertChainPath: config.sslCertChainPath,
    sslKeyPath: config.sslKeyPath,
    collectorAddress: config.collectorAddress,
  };
  const baseContext = {
    credentials: grpc.credentials.createInsecure(),
    options: {},
  };

  beforeEach(() => {
    clearTlsMaterialCacheForTest();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    config.secure = original.secure;
    config.forceTls = original.forceTls;
    config.sslTrustedCaPath = original.sslTrustedCaPath;
    config.sslCertChainPath = original.sslCertChainPath;
    config.sslKeyPath = original.sslKeyPath;
    config.collectorAddress = original.collectorAddress;
    clearTlsMaterialCacheForTest();
    jest.restoreAllMocks();
  });

  async function mockCaFileAndPreload(caPath: string, ca: Buffer, extra?: Record<string, Buffer>): Promise<void> {
    const fileContents: Record<string, Buffer> = { [caPath]: ca, ...(extra ?? {}) };
    jest.spyOn(fsPromises, 'lstat').mockImplementation(async (target) => {
      const filePath = String(target);
      if (fileContents[filePath]) {
        return { isFile: () => true, isSymbolicLink: () => false, mode: 0o600, size: 64 } as fs.Stats;
      }
      throw new Error('ENOENT');
    });
    jest.spyOn(fsPromises, 'realpath').mockImplementation(async (target) => String(target));
    jest.spyOn(fsPromises, 'open').mockImplementation(async (target) => {
      const filePath = String(target);
      const content = fileContents[filePath];
      if (!content) {
        throw new Error(`unexpected open ${filePath}`);
      }
      return {
        readFile: async () => content,
        close: async () => undefined,
      } as unknown as fsPromises.FileHandle;
    });
    await preloadTlsMaterials();
  }

  it('throws when mTLS paths are configured but key material is missing', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.sslCertChainPath = '/ca/client.crt';
    config.sslKeyPath = '/ca/client.key';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));

    expect(() => new TLSChannelBuilder().build({ ...baseContext })).toThrow('mTLS material unavailable');
  });

  it('throws when mTLS paths are configured but key material is missing', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.sslCertChainPath = '/ca/client.crt';
    config.sslKeyPath = '/ca/client.key';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));

    expect(() => new TLSChannelBuilder().build({ ...baseContext })).toThrow('mTLS material unavailable');
  });

  it('throws when mTLS paths are configured but key material is missing', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.sslCertChainPath = '/ca/client.crt';
    config.sslKeyPath = '/ca/client.key';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));

    expect(() => new TLSChannelBuilder().build({ ...baseContext })).toThrow('mTLS material unavailable');
  });

  it('uses TLS without CA verification when SW_AGENT_SECURE is true but CA file is missing (Java force_tls parity)', () => {
    config.secure = true;
    config.forceTls = false;
    config.sslTrustedCaPath = '';
    const sslCredentials = {} as grpc.ChannelCredentials;
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue(sslCredentials);

    const result = new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith();
    expect(result.credentials).toBe(sslCredentials);
  });

  it('uses system trust store when SW_AGENT_FORCE_TLS is true but CA file is missing (Java force_tls parity)', () => {
    config.secure = false;
    config.forceTls = true;
    config.sslTrustedCaPath = 'ca/ca.crt';
    jest.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const sslCredentials = {} as grpc.ChannelCredentials;
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue(sslCredentials);

    const result = new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith();
    expect(result.credentials).toBe(sslCredentials);
  });

  it('loads trusted CA from relative ca/ca.crt under agent package (Java default layout)', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    const ca = Buffer.from('TEST-CA');
    const caPath = path.join(getAgentPackagePath(), 'ca/ca.crt');
    await mockCaFileAndPreload(caPath, ca);
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, null, null);
  });

  it('loads trusted CA from absolute SW_AGENT_SSL_TRUSTED_CA_PATH', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = '/ca/ca.crt';
    const ca = Buffer.from('TEST-CA');
    await mockCaFileAndPreload('/ca/ca.crt', ca);
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, null, null);
  });

  it('loads private key via PrivateKeyUtil.loadDecryptionKey for mTLS', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.sslCertChainPath = '/ca/client.crt';
    config.sslKeyPath = '/ca/client.pem';
    const ca = Buffer.from('CA');
    const cert = Buffer.from('CERT');
    const key = Buffer.from('KEY-PEM');
    await mockCaFileAndPreload('/ca/ca.crt', ca, {
      '/ca/client.crt': cert,
      '/ca/client.pem': key,
    });
    const sslCredentials = {} as grpc.ChannelCredentials;
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue(sslCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, key, cert);
  });

  it('enables mTLS when cert chain and key files exist under agent package', async () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = 'ca/client.crt';
    config.sslKeyPath = 'ca/client.key';
    const ca = Buffer.from('CA');
    const cert = Buffer.from('CERT');
    const key = Buffer.from('KEY');
    const root = getAgentPackagePath();
    await mockCaFileAndPreload(path.join(root, 'ca/ca.crt'), ca, {
      [path.join(root, 'ca/client.crt')]: cert,
      [path.join(root, 'ca/client.key')]: key,
    });
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith(ca, key, cert);
  });

  it('keeps insecure credentials when TLS is not enabled and default ca file is absent', () => {
    config.secure = false;
    config.forceTls = false;
    config.sslTrustedCaPath = 'ca/ca.crt';
    jest.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl');
    const insecure = grpc.credentials.createInsecure();

    const result = new TLSChannelBuilder().build({ credentials: insecure, options: {} });

    expect(createSslSpy).not.toHaveBeenCalled();
    expect(result.credentials).toBe(insecure);
  });

  it('sets grpc.ssl_target_name_override when connecting to resolved IP under TLS', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.collectorAddress = 'oap:11800';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build({
      ...baseContext,
      connectHost: '10.0.0.1',
    });

    expect(result.options['grpc.ssl_target_name_override']).toBe('oap');
  });

  it('does not set grpc.ssl_target_name_override when connect host is hostname', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.collectorAddress = 'oap:11800';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build({
      ...baseContext,
      connectHost: 'oap',
    });

    expect(result.options['grpc.ssl_target_name_override']).toBeUndefined();
  });

  it('context.tlsServerName takes precedence over deriveTlsServerNameForConnectHost', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.collectorAddress = 'first:11800,second:11800';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build({
      ...baseContext,
      connectHost: '10.0.0.1',
      tlsServerName: 'second',
    });

    expect(result.options['grpc.ssl_target_name_override']).toBe('second');
  });

  it('uses TLS without CA verification when FORCE_TLS is set and preload found no CA file (Java parity)', async () => {
    config.secure = false;
    config.forceTls = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    jest.spyOn(fsPromises, 'stat').mockRejectedValue(new Error('ENOENT'));
    jest.spyOn(fsPromises, 'readFile').mockRejectedValue(new Error('ENOENT'));
    await preloadTlsMaterials();
    const sslCredentials = {} as grpc.ChannelCredentials;
    const createSslSpy = jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue(sslCredentials);

    const result = new TLSChannelBuilder().build({ ...baseContext });

    expect(createSslSpy).toHaveBeenCalledWith();
    expect(result.credentials).toBe(sslCredentials);
  });

  it('StandardChannelBuilder preserves connectHost for TLS SNI override chain', async () => {
    config.secure = true;
    config.sslTrustedCaPath = '/ca/ca.crt';
    config.collectorAddress = 'oap:11800';
    await mockCaFileAndPreload('/ca/ca.crt', Buffer.from('TEST-CA'));
    jest.spyOn(grpc.credentials, 'createSsl').mockReturnValue({} as grpc.ChannelCredentials);

    const result = new TLSChannelBuilder().build(
      new StandardChannelBuilder().build({
        ...baseContext,
        connectHost: '10.0.0.1',
      }),
    );

    expect(result.options['grpc.ssl_target_name_override']).toBe('oap');
  });
});
