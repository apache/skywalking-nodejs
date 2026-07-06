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

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import config from '../../../config/AgentConfig';
import { getAgentPackagePath, isPathInsideAgentRoot, resolveAgentPath } from '../boot/AgentPackagePath';
import path from 'path';
import { loadDecryptionKeyFromBuffer } from '../util/PrivateKeyUtil';
import { createLogger } from '../../../logging';

const logger = createLogger(__filename);

/** Max TLS PEM/CA file size (256 KiB) to limit memory DoS. */
const MAX_TLS_MATERIAL_BYTES = 256 * 1024;

export type TlsMaterialSnapshot = {
  rootCerts: Buffer | null;
  privateKey: Buffer | null;
  certChain: Buffer | null;
};

/** Last preload result consumed by {@code TLSChannelBuilder.build()} in the same rebuild. */
let cachedSnapshot: TlsMaterialSnapshot | null = null;

/** Whether the trusted CA file existed on the last {@link preloadTlsMaterials} call. */
let caFileExistsOnLastPreload = false;

/** Read a regular file; reject symlinks (B-1 path traversal via link). */
async function readRegularFileBytes(
  filePath: string,
  options: { mustStayUnderAgentRoot?: boolean; requirePrivateKeyMode?: boolean } = {},
): Promise<Buffer | null> {
  try {
    const lstat = await fsPromises.lstat(filePath);
    if (lstat.isSymbolicLink()) {
      logger.warn('TLS path [%s] is a symbolic link; refusing to load', filePath);
      return null;
    }
    if (!lstat.isFile()) {
      return null;
    }
    if (lstat.size > MAX_TLS_MATERIAL_BYTES) {
      logger.warn('TLS path [%s] exceeds max size %d bytes; refusing to load', filePath, MAX_TLS_MATERIAL_BYTES);
      return null;
    }
    if (options.requirePrivateKeyMode && (lstat.mode & 0o077) !== 0) {
      logger.warn(
        'Private key [%s] is group/world accessible (mode %o); refusing to load',
        filePath,
        lstat.mode & 0o777,
      );
      return null;
    }
    const realPath = await fsPromises.realpath(filePath);
    if (options.mustStayUnderAgentRoot && !isPathInsideAgentRoot(realPath)) {
      logger.warn('TLS path [%s] resolves outside agent package [%s]; refusing to load', filePath, realPath);
      return null;
    }
    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const handle = await fsPromises.open(filePath, openFlags);
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function isRegularFilePath(filePath: string): Promise<boolean> {
  try {
    const lstat = await fsPromises.lstat(filePath);
    return lstat.isFile() && !lstat.isSymbolicLink();
  } catch {
    return false;
  }
}

function resolveConfiguredPath(configuredPath: string | undefined): string | undefined {
  if (!configuredPath) {
    return undefined;
  }
  try {
    return resolveAgentPath(configuredPath);
  } catch (error) {
    logger.error('Invalid TLS path [%s]: %s', configuredPath, error);
    return undefined;
  }
}

async function readFileIfExists(configuredPath: string | undefined): Promise<Buffer | null> {
  const filePath = resolveConfiguredPath(configuredPath);
  if (!filePath) {
    return null;
  }
  const mustStay = !path.isAbsolute((configuredPath ?? '').trim());
  return readRegularFileBytes(filePath, { mustStayUnderAgentRoot: mustStay });
}

async function readPrivateKeyIfExists(configuredPath: string | undefined): Promise<Buffer | null> {
  const filePath = resolveConfiguredPath(configuredPath);
  if (!filePath) {
    return null;
  }
  const mustStay = !path.isAbsolute((configuredPath ?? '').trim());
  const keyBytes = await readRegularFileBytes(filePath, {
    mustStayUnderAgentRoot: mustStay,
    requirePrivateKeyMode: true,
  });
  if (!keyBytes) {
    return null;
  }
  try {
    return loadDecryptionKeyFromBuffer(keyBytes);
  } catch {
    return null;
  }
}

/**
 * Async-load TLS files before channel rebuild (Java {@code TLSChannelBuilder} reads on every build).
 * Reloads from disk on each call so rotated certificates are picked up after failover/reconnect.
 */
async function probeCaFileExists(): Promise<boolean> {
  const filePath = resolveConfiguredPath(config.sslTrustedCaPath);
  if (!filePath) {
    return false;
  }
  if (!(await isRegularFilePath(filePath))) {
    return false;
  }
  if (!path.isAbsolute((config.sslTrustedCaPath ?? '').trim())) {
    try {
      const realPath = await fsPromises.realpath(filePath);
      return isPathInsideAgentRoot(realPath);
    } catch {
      return false;
    }
  }
  return true;
}

export async function preloadTlsMaterials(): Promise<TlsMaterialSnapshot> {
  caFileExistsOnLastPreload = await probeCaFileExists();
  const rootCerts = await readFileIfExists(config.sslTrustedCaPath);
  let privateKey = await readPrivateKeyIfExists(config.sslKeyPath);
  let certChain = await readFileIfExists(config.sslCertChainPath);

  const certPathSet = Boolean(config.sslCertChainPath);
  const keyPathSet = Boolean(config.sslKeyPath);
  if (certPathSet && keyPathSet && (!privateKey || !certChain)) {
    privateKey = null;
    certChain = null;
  } else if (certPathSet !== keyPathSet) {
    privateKey = null;
    certChain = null;
  }

  cachedSnapshot = { rootCerts, privateKey, certChain };
  return cachedSnapshot;
}

export function getTlsMaterials(): TlsMaterialSnapshot | null {
  return cachedSnapshot;
}

/** Whether trusted CA file existed during the last preload (replaces sync stat in TLSChannelBuilder). */
export function isCaFileAvailableFromPreload(): boolean {
  return caFileExistsOnLastPreload;
}

/** @internal test hook — reset preload cache between tests. */
function zeroSensitiveBuffers(snapshot: TlsMaterialSnapshot | null): void {
  if (!snapshot) {
    return;
  }
  if (snapshot.privateKey) {
    snapshot.privateKey.fill(0);
  }
}

/** Java reads TLS from disk on each channel rebuild; clear cached key material on agent shutdown. */
export function clearTlsMaterialCacheOnShutdown(): void {
  zeroSensitiveBuffers(cachedSnapshot);
  cachedSnapshot = null;
  caFileExistsOnLastPreload = false;
}

/** @internal test hook */
export function clearTlsMaterialCacheForTest(): void {
  clearTlsMaterialCacheOnShutdown();
}
