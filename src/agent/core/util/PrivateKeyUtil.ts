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

const PKCS_1_PEM_HEADER = '-----BEGIN RSA PRIVATE KEY-----';
const PKCS_1_PEM_FOOTER = '-----END RSA PRIVATE KEY-----';
const PKCS_8_PEM_HEADER = '-----BEGIN PRIVATE KEY-----';
const PKCS_8_PEM_FOOTER = '-----END PRIVATE KEY-----';

/**
 * Load a RSA private key from PEM bytes (PKCS#1 or PKCS#8).
 * Aligned with Java {@code PrivateKeyUtil.loadDecryptionKey}.
 */
export function loadDecryptionKeyFromBuffer(keyDataBytes: Buffer): Buffer {
  let keyDataString = keyDataBytes.toString('utf8');

  if (keyDataString.includes(PKCS_1_PEM_HEADER)) {
    keyDataString = keyDataString.replace(PKCS_1_PEM_HEADER, '');
    keyDataString = keyDataString.replace(PKCS_1_PEM_FOOTER, '');
    keyDataString = keyDataString.replace(/\n/g, '');
    const pkcs1Bytes = Buffer.from(keyDataString, 'base64');
    return readPkcs1PrivateKey(pkcs1Bytes);
  }

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

/** Convert raw PKCS#1 bytes into PKCS#8 PEM (Java readPkcs1PrivateKey). */
function readPkcs1PrivateKey(pkcs1Bytes: Buffer): Buffer {
  const pkcs1Length = pkcs1Bytes.length;
  const totalLength = pkcs1Length + 22;
  const pkcs8Header = Buffer.from([
    0x30,
    0x82,
    (totalLength >> 8) & 0xff,
    totalLength & 0xff,
    0x02,
    0x01,
    0x00,
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00,
    0x04,
    0x82,
    (pkcs1Length >> 8) & 0xff,
    pkcs1Length & 0xff,
  ]);
  const der = Buffer.concat([pkcs8Header, pkcs1Bytes]);
  const pemBody = der.toString('base64');
  const pem = `${PKCS_8_PEM_HEADER}\n${pemBody}\n${PKCS_8_PEM_FOOTER}\n`;
  return Buffer.from(pem, 'utf8');
}
