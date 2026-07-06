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
import os from 'os';
import path from 'path';
import { loadDecryptionKey, loadDecryptionKeyAsync } from '../../src/agent/core/util/PrivateKeyUtil';

function removeDir(dir: string): void {
  for (const entry of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, entry));
  }
  fs.rmdirSync(dir);
}

describe('PrivateKeyUtil (Java PrivateKeyUtil parity)', () => {
  it('returns PKCS#8 PEM bytes unchanged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-pkcs8-'));
    const keyPath = path.join(dir, 'client.pem');
    const pem = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n';
    fs.writeFileSync(keyPath, pem);
    expect(loadDecryptionKey(keyPath).toString('utf8')).toBe(pem);
    removeDir(dir);
  });

  it('loadDecryptionKeyAsync reads PKCS#8 PEM (L5)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-pkcs8-async-'));
    const keyPath = path.join(dir, 'client.pem');
    const pem = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n';
    fs.writeFileSync(keyPath, pem);
    await expect(loadDecryptionKeyAsync(keyPath)).resolves.toEqual(Buffer.from(pem, 'utf8'));
    removeDir(dir);
  });

  it('converts PKCS#1 RSA PEM to PKCS#8 PEM', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-pkcs1-'));
    const keyPath = path.join(dir, 'client-rsa.pem');
    const pkcs1Inner = Buffer.alloc(32, 0xab);
    const pkcs1Pem = `-----BEGIN RSA PRIVATE KEY-----\n${pkcs1Inner.toString(
      'base64',
    )}\n-----END RSA PRIVATE KEY-----\n`;
    fs.writeFileSync(keyPath, pkcs1Pem);

    const converted = loadDecryptionKey(keyPath).toString('utf8');
    expect(converted).toContain('-----BEGIN PRIVATE KEY-----');
    expect(converted).toContain('-----END PRIVATE KEY-----');
    expect(converted).not.toContain('RSA PRIVATE KEY');

    removeDir(dir);
  });
});
