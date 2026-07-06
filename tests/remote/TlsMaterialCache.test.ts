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
import path from 'path';
import config from '../../src/config/AgentConfig';
import { getAgentPackagePath } from '../../src/agent/core/boot/AgentPackagePath';
import {
  clearTlsMaterialCacheForTest,
  clearTlsMaterialCacheOnShutdown,
  getTlsMaterials,
  preloadTlsMaterials,
} from '../../src/agent/core/remote/TlsMaterialCache';

describe('TlsMaterialCache', () => {
  const original = {
    sslTrustedCaPath: config.sslTrustedCaPath,
    sslCertChainPath: config.sslCertChainPath,
    sslKeyPath: config.sslKeyPath,
  };

  function mockRegularTlsFileIO(readFileImpl?: jest.Mock): void {
    jest
      .spyOn(fs.promises, 'lstat')
      .mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, mode: 0o600, size: 64 } as fs.Stats);
    jest.spyOn(fs.promises, 'realpath').mockImplementation(async (target) => String(target));
    const fileHandle = {
      readFile: readFileImpl ?? jest.fn().mockResolvedValue(Buffer.from('CA')),
      close: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(fs.promises, 'open').mockResolvedValue(fileHandle as unknown as fs.promises.FileHandle);
  }

  beforeEach(() => {
    clearTlsMaterialCacheForTest();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    config.sslTrustedCaPath = original.sslTrustedCaPath;
    config.sslCertChainPath = original.sslCertChainPath;
    config.sslKeyPath = original.sslKeyPath;
    clearTlsMaterialCacheForTest();
  });

  it('reloads CA bytes on each preload call (Java channel rebuild parity)', async () => {
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';
    const caPath = path.join(getAgentPackagePath(), 'ca/ca.crt');
    const first = Buffer.from('CA-1');
    const second = Buffer.from('CA-2');
    const fileHandle = { readFile: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
    mockRegularTlsFileIO(fileHandle.readFile);
    fileHandle.readFile.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const firstLoad = await preloadTlsMaterials();
    const secondLoad = await preloadTlsMaterials();

    expect(firstLoad.rootCerts).toEqual(first);
    expect(secondLoad.rootCerts).toEqual(second);
    expect(String(caPath)).toBeTruthy();
  });

  it('clearTlsMaterialCacheOnShutdown clears cached snapshot (Java shutdown parity)', async () => {
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';
    mockRegularTlsFileIO();

    await preloadTlsMaterials();
    expect(getTlsMaterials()).not.toBeNull();

    clearTlsMaterialCacheOnShutdown();
    expect(getTlsMaterials()).toBeNull();
  });

  it('rejects symbolic link TLS paths (B-1)', async () => {
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';
    jest.spyOn(fs.promises, 'lstat').mockResolvedValue({ isFile: () => false, isSymbolicLink: () => true } as fs.Stats);
    const openSpy = jest.spyOn(fs.promises, 'open');

    const materials = await preloadTlsMaterials();

    expect(materials.rootCerts).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('rejects TLS file when realpath resolves outside agent package (hardlink, H-1)', async () => {
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';
    jest
      .spyOn(fs.promises, 'lstat')
      .mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, mode: 0o600, size: 64 } as fs.Stats);
    jest.spyOn(fs.promises, 'realpath').mockResolvedValue('/etc/passwd');
    const openSpy = jest.spyOn(fs.promises, 'open');

    const materials = await preloadTlsMaterials();

    expect(materials.rootCerts).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('rejects TLS file when realpath resolves outside agent package (hardlink, H-1)', async () => {
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';
    jest
      .spyOn(fs.promises, 'lstat')
      .mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, mode: 0o600, size: 64 } as fs.Stats);
    jest.spyOn(fs.promises, 'realpath').mockResolvedValue('/etc/passwd');
    const openSpy = jest.spyOn(fs.promises, 'open');

    const materials = await preloadTlsMaterials();

    expect(materials.rootCerts).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('rejects TLS file when realpath resolves outside agent package (hardlink, H-1)', async () => {
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';
    jest
      .spyOn(fs.promises, 'lstat')
      .mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, mode: 0o600, size: 64 } as fs.Stats);
    jest.spyOn(fs.promises, 'realpath').mockResolvedValue('/etc/passwd');
    const openSpy = jest.spyOn(fs.promises, 'open');

    const materials = await preloadTlsMaterials();

    expect(materials.rootCerts).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('rejects TLS file exceeding max size (SEC-11)', async () => {
    config.sslTrustedCaPath = 'ca/ca.crt';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';
    jest.spyOn(fs.promises, 'lstat').mockResolvedValue({
      isFile: () => true,
      isSymbolicLink: () => false,
      mode: 0o600,
      size: 512 * 1024,
    } as fs.Stats);
    const openSpy = jest.spyOn(fs.promises, 'open');

    const materials = await preloadTlsMaterials();

    expect(materials.rootCerts).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('returns null CA material for path traversal without throwing', async () => {
    config.sslTrustedCaPath = '../../../etc/passwd';
    config.sslCertChainPath = '';
    config.sslKeyPath = '';

    const materials = await preloadTlsMaterials();

    expect(materials.rootCerts).toBeNull();
  });
});
