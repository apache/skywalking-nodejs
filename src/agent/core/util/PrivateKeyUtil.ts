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

/**
 * Load a RSA private key from PEM bytes (PKCS#1 or PKCS#8).
 * Aligned with Java {@code PrivateKeyUtil.loadDecryptionKey}.
 */
export function loadDecryptionKeyFromBuffer(keyDataBytes: Buffer): Buffer {
  // Node tls.createSecureContext accepts PKCS#1 PEM directly; no Java-style ASN.1 re-wrap needed.
  return keyDataBytes;
}

/**
 * Load a RSA private key from a file (PEM PKCS#1 or PKCS#8).
 * Aligned with Java {@code PrivateKeyUtil.loadDecryptionKey}.
 */
/** Preferred for runtime TLS loading (non-blocking). */
export async function loadDecryptionKeyAsync(keyFilePath: string): Promise<Buffer> {
  return loadDecryptionKeyFromBuffer(await fsPromises.readFile(keyFilePath));
}

/** Synchronous loader retained for unit tests and legacy callers. */
export function loadDecryptionKey(keyFilePath: string): Buffer {
  return loadDecryptionKeyFromBuffer(fs.readFileSync(keyFilePath));
}
