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

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
jest.mock('../../src/logging', () => ({
  createLogger: jest.fn(() => ({
    error: mockLoggerError,
    debug: jest.fn(),
    warn: mockLoggerWarn,
    info: jest.fn(),
  })),
}));

import {
  countDistinctNonIpHostnames,
  DnsLookupFn,
  BackendTarget,
  expandBackendAddresses,
  deriveTlsServerNameForConnectHost,
  formatHostPort,
  isLiteralIp,
  parseStaticBackendAddresses,
  splitHostPort,
} from '../../src/agent/core/remote/BackendAddressResolver';

describe('BackendAddressResolver (Java InetAddress.getAllByName parity)', () => {
  beforeEach(() => {
    mockLoggerError.mockClear();
  });

  it('logs ERROR when DNS lookup fails (Java LOGGER.error)', async () => {
    const lookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expandBackendAddresses(['missing.local:11800'], true, lookup);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Failed to resolve %s of backend service.',
      'missing.local',
      expect.any(Error),
    );
  });

  it('parses comma-separated static backend addresses', () => {
    expect(parseStaticBackendAddresses('127.0.0.1:11800, 10.0.0.2:11800')).toEqual([
      '127.0.0.1:11800',
      '10.0.0.2:11800',
    ]);
  });

  it('filters invalid host:port entries', () => {
    expect(parseStaticBackendAddresses('bad-entry,127.0.0.1:11800')).toEqual(['127.0.0.1:11800']);
  });

  it('parses bracketed IPv6 static backend addresses', () => {
    expect(parseStaticBackendAddresses('[::1]:11800')).toEqual(['[::1]:11800']);
    expect(splitHostPort('[::1]:11800')).toEqual({ host: '::1', port: '11800' });
    expect(formatHostPort('::1', 11800)).toBe('[::1]:11800');
  });

  it('detects literal IP addresses', () => {
    expect(isLiteralIp('127.0.0.1')).toBe(true);
    expect(isLiteralIp('::1')).toBe(true);
    expect(isLiteralIp('oap.local')).toBe(false);
  });

  it('returns static entries when DNS resolve is disabled', async () => {
    const lookup = jest.fn();
    const result = await expandBackendAddresses(['127.0.0.1:11800'], false, lookup);
    expect(result).toEqual([{ target: '127.0.0.1:11800' }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not DNS lookup literal IP when resolveDns is true', async () => {
    const lookup = jest.fn();
    const result = await expandBackendAddresses(['127.0.0.1:11800'], true, lookup);
    expect(result).toEqual([{ target: '127.0.0.1:11800' }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('expands hostname to multiple ip:port targets (Java getAllByName)', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '10.0.1.1', family: 4 },
      { address: '10.0.1.2', family: 4 },
    ]);
    const result = await expandBackendAddresses(['fake-oap.local:11800'], true, lookup);
    expect(lookup).toHaveBeenCalledWith('fake-oap.local', { all: true, verbatim: true });
    expect(result).toEqual([
      { target: '10.0.1.1:11800', tlsServerName: 'fake-oap.local' },
      { target: '10.0.1.2:11800', tlsServerName: 'fake-oap.local' },
    ]);
  });

  it('includes IPv6 addresses from DNS lookup', async () => {
    const lookup = jest.fn().mockResolvedValue([{ address: '2001:db8::1', family: 6 }]);
    const result = await expandBackendAddresses(['v6-host.local:11800'], true, lookup);
    expect(result).toEqual([{ target: '[2001:db8::1]:11800', tlsServerName: 'v6-host.local' }]);
  });

  it('merges multiple comma-separated hostnames via DNS', async () => {
    const lookup = jest
      .fn()
      .mockResolvedValueOnce([{ address: '10.0.1.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.1.2', family: 4 }]);
    const result = await expandBackendAddresses(['a.local:11800', 'b.local:11800'], true, lookup);
    expect(result).toEqual([
      { target: '10.0.1.1:11800', tlsServerName: 'a.local' },
      { target: '10.0.1.2:11800', tlsServerName: 'b.local' },
    ]);
  });

  it('deduplicates identical ip:port from multiple hostnames (Java distinct)', async () => {
    const lookup = jest
      .fn()
      .mockResolvedValueOnce([{ address: '10.0.1.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.1.1', family: 4 }]);
    const result = await expandBackendAddresses(['a.local:11800', 'b.local:11800'], true, lookup);
    expect(result).toEqual([{ target: '10.0.1.1:11800', tlsServerName: 'a.local' }]);
  });

  it('skips DNS lookup failures without throwing', async () => {
    const lookup = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const result = await expandBackendAddresses(['missing.local:11800'], true, lookup);
    expect(result).toEqual([]);
  });

  it('returns partial results when one hostname fails and another succeeds', async () => {
    const lookup = jest
      .fn()
      .mockRejectedValueOnce(new Error('ENOTFOUND'))
      .mockResolvedValueOnce([{ address: '10.0.1.2', family: 4 }]);
    const result = await expandBackendAddresses(['missing.local:11800', 'good.local:11800'], true, lookup);
    expect(result).toEqual([{ target: '10.0.1.2:11800', tlsServerName: 'good.local' }]);
  });

  it('returns IPv6-only targets when DNS has no A records', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '2001:db8::a', family: 6 },
      { address: '2001:db8::b', family: 6 },
    ]);
    const result = await expandBackendAddresses(['v6-only.local:11800'], true, lookup);
    expect(result).toEqual([
      { target: '[2001:db8::a]:11800', tlsServerName: 'v6-only.local' },
      { target: '[2001:db8::b]:11800', tlsServerName: 'v6-only.local' },
    ]);
  });

  it('caps DNS A record count (L4)', async () => {
    const many = Array.from({ length: 100 }, (_, index) => ({
      address: `10.0.${Math.floor(index / 256)}.${index % 256}`,
      family: 4,
    }));
    const lookup = jest.fn().mockResolvedValue(many);
    const result = await expandBackendAddresses(['big.local:11800'], true, lookup);
    expect(result.length).toBe(64);
    expect(result[0]?.tlsServerName).toBe('big.local');
  });

  it('times out slow DNS lookup without blocking (L4)', async () => {
    jest.useFakeTimers();
    const lookup: DnsLookupFn = jest.fn(() => new Promise(() => {}));
    const promise = expandBackendAddresses(['slow.local:11800'], true, lookup);
    await Promise.resolve();
    jest.advanceTimersByTime(5_001);
    await expect(promise).resolves.toEqual([]);
    jest.useRealTimers();
  });

  it('derives TLS server name from collector hostname when connect host is IP', () => {
    expect(deriveTlsServerNameForConnectHost('10.0.0.1', 'oap:11800')).toBe('oap');
    expect(deriveTlsServerNameForConnectHost('10.0.0.1', 'oap:11800,backup:11800')).toBeUndefined();
  });

  it('does not derive TLS server name when connect host is already a hostname', () => {
    expect(deriveTlsServerNameForConnectHost('oap', 'oap:11800')).toBeUndefined();
  });

  it('does not derive TLS server name when collector address is IP-only', () => {
    expect(deriveTlsServerNameForConnectHost('10.0.0.2', '127.0.0.1:11800')).toBeUndefined();
  });
  it('counts distinct non-IP hostnames in collectorAddress', () => {
    expect(countDistinctNonIpHostnames('oap:11800')).toBe(1);
    expect(countDistinctNonIpHostnames('oap:11800,backup:11800')).toBe(2);
    expect(countDistinctNonIpHostnames('10.0.0.1:11800,10.0.0.2:11800')).toBe(0);
  });

  it('assigns per-hostname tlsServerName when multiple hostnames expand via DNS', async () => {
    const lookup = jest
      .fn()
      .mockResolvedValueOnce([{ address: '10.0.1.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.1.2', family: 4 }]);
    const result: BackendTarget[] = await expandBackendAddresses(['oap-a:11800', 'oap-b:11800'], true, lookup);
    expect(result).toEqual([
      { target: '10.0.1.1:11800', tlsServerName: 'oap-a' },
      { target: '10.0.1.2:11800', tlsServerName: 'oap-b' },
    ]);
  });
});
