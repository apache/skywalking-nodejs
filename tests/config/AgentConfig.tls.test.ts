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

describe('AgentConfig TLS settings (Java agent.config parity)', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    jest.resetModules();
  });

  it('reads SW_AGENT_FORCE_TLS=true', () => {
    process.env.SW_AGENT_FORCE_TLS = 'true';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.forceTls).toBe(true);
  });

  it('reads SW_AGENT_SSL_TRUSTED_CA_PATH', () => {
    process.env.SW_AGENT_SSL_TRUSTED_CA_PATH = '/ca/ca.crt';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.sslTrustedCaPath).toBe('/ca/ca.crt');
  });

  it('reads SW_AGENT_SSL_CERT_CHAIN_PATH and SW_AGENT_SSL_KEY_PATH', () => {
    process.env.SW_AGENT_SSL_CERT_CHAIN_PATH = '/ca/client.crt';
    process.env.SW_AGENT_SSL_KEY_PATH = '/ca/client.key';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.sslCertChainPath).toBe('/ca/client.crt');
    expect(cfg.sslKeyPath).toBe('/ca/client.key');
  });

  it('defaults SW_AGENT_SSL_TRUSTED_CA_PATH to ca/ca.crt', () => {
    delete process.env.SW_AGENT_SSL_TRUSTED_CA_PATH;
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.sslTrustedCaPath).toBe('ca/ca.crt');
  });
  it('reads SW_AGENT_SECURE=true', () => {
    process.env.SW_AGENT_SECURE = 'true';
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.secure).toBe(true);
  });

  it('defaults SW_AGENT_SECURE to false', () => {
    delete process.env.SW_AGENT_SECURE;
    jest.resetModules();
    const cfg = require('../../src/config/AgentConfig').default;
    expect(cfg.secure).toBe(false);
  });
});
