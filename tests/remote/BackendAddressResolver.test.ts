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

import {
  buildNativeGrpcTarget,
  expandBackendAddresses,
  firstHostnameAuthority,
  isIpLiteral,
  parseStaticBackendAddresses,
  sameAddressSet,
  shouldExpandBackendDns,
  tryParseHostPort,
} from '../../src/agent/core/remote/BackendAddressResolver';

describe('BackendAddressResolver (comma-separated static backends)', () => {
  it('parses comma-separated host:port entries', () => {
    expect(parseStaticBackendAddresses('a:11800, b:11800 ,c:11800')).toEqual(['a:11800', 'b:11800', 'c:11800']);
  });

  it('drops invalid entries', () => {
    expect(parseStaticBackendAddresses('good:11800,bad,also-bad:xyz,:9')).toEqual(['good:11800']);
  });

  it('supports bracketed IPv6 literals', () => {
    expect(parseStaticBackendAddresses('[::1]:11800, [2001:db8::1]:11800')).toEqual([
      '[::1]:11800',
      '[2001:db8::1]:11800',
    ]);
    expect(tryParseHostPort('[::1]:11800')).toBe('[::1]:11800');
  });

  it('rejects unbracketed IPv6 host:port', () => {
    expect(tryParseHostPort('2001:db8::1:11800')).toBeNull();
    expect(parseStaticBackendAddresses('2001:db8::1:11800,good:11800')).toEqual(['good:11800']);
  });

  it('buildNativeGrpcTarget uses plain host:port for a single address', () => {
    expect(buildNativeGrpcTarget(['oap.example.com:11800'])).toBe('oap.example.com:11800');
    expect(buildNativeGrpcTarget(['10.0.0.1:11800'])).toBe('10.0.0.1:11800');
  });

  it('buildNativeGrpcTarget uses sw-static for multiple addresses', () => {
    expect(buildNativeGrpcTarget(['10.0.0.1:11800', '10.0.0.2:11800'])).toBe(
      'sw-static:///10.0.0.1:11800,10.0.0.2:11800',
    );
    expect(buildNativeGrpcTarget(['collector-a:19876', 'collector-b:19876'])).toBe(
      'sw-static:///collector-a:19876,collector-b:19876',
    );
  });

  it('buildNativeGrpcTarget can force sw-static for a single expanded IP', () => {
    expect(buildNativeGrpcTarget(['10.0.0.1:11800'], { forceStatic: true })).toBe('sw-static:///10.0.0.1:11800');
  });

  it('detects IP literals', () => {
    expect(isIpLiteral('10.0.0.1')).toBe(true);
    expect(isIpLiteral('::1')).toBe(true);
    expect(isIpLiteral('[2001:db8::1]')).toBe(true);
    expect(isIpLiteral('oap.example.com')).toBe(false);
  });

  it('shouldExpandBackendDns only for multi-address lists with hostnames', () => {
    expect(shouldExpandBackendDns(['oap.example.com:11800'])).toBe(false);
    expect(shouldExpandBackendDns(['10.0.0.1:11800', '10.0.0.2:11800'])).toBe(false);
    expect(shouldExpandBackendDns(['oap-a:11800', 'oap-b:11800'])).toBe(true);
    expect(shouldExpandBackendDns(['oap-a:11800', '10.0.0.2:11800'])).toBe(true);
  });

  it('sameAddressSet compares order-independently', () => {
    expect(sameAddressSet(['a:1', 'b:1'], ['b:1', 'a:1'])).toBe(true);
    expect(sameAddressSet(['a:1'], ['a:1', 'b:1'])).toBe(false);
  });

  it('firstHostnameAuthority returns the first non-IP host in the list', () => {
    expect(firstHostnameAuthority(['oap-a.svc:11800', 'oap-b.svc:11800'])).toBe('oap-a.svc');
    expect(firstHostnameAuthority(['10.0.0.1:11800', 'oap-b.svc:11800'])).toBe('oap-b.svc');
    expect(firstHostnameAuthority(['10.0.0.1:11800', '10.0.0.2:11800'])).toBeUndefined();
  });

  it('expandBackendAddresses keeps IPs and expands hostnames via lookup', async () => {
    const lookup = jest.fn(async (hostname: string) => {
      if (hostname === 'oap-a') {
        return [
          { address: '10.0.0.1', family: 4 },
          { address: '10.0.0.2', family: 4 },
        ];
      }
      if (hostname === 'oap-b') {
        return [{ address: '2001:db8::1', family: 6 }];
      }
      return [];
    });

    const result = await expandBackendAddresses(['oap-a:11800', '10.0.0.9:11800', 'oap-b:11800'], lookup);
    expect(result.addresses).toEqual(['10.0.0.1:11800', '10.0.0.2:11800', '10.0.0.9:11800', '[2001:db8::1]:11800']);
    expect(result.hadLookupFailure).toBe(false);
    expect(result.byConfigured.get('oap-a:11800')).toEqual(['10.0.0.1:11800', '10.0.0.2:11800']);
    expect(result.byConfigured.get('10.0.0.9:11800')).toEqual(['10.0.0.9:11800']);
    expect(result.byConfigured.get('oap-b:11800')).toEqual(['[2001:db8::1]:11800']);
    expect(lookup).toHaveBeenCalledWith('oap-a');
    expect(lookup).toHaveBeenCalledWith('oap-b');
  });

  it('expandBackendAddresses treats empty A/AAAA results as lookup failure', async () => {
    const lookup = jest.fn(async (hostname: string) => {
      if (hostname === 'oap-a') {
        return [{ address: '10.0.0.1', family: 4 }];
      }
      return [];
    });

    const result = await expandBackendAddresses(['oap-a:11800', 'oap-b:11800'], lookup);
    expect(result.addresses).toEqual(['10.0.0.1:11800']);
    expect(result.hadLookupFailure).toBe(true);
    expect(result.byConfigured.get('oap-a:11800')).toEqual(['10.0.0.1:11800']);
    expect(result.byConfigured.has('oap-b:11800')).toBe(false);
  });

  it('expandBackendAddresses keeps previous endpoints for names that fail this tick', async () => {
    const lookup = jest.fn(async (hostname: string) => {
      if (hostname === 'oap-a') {
        return [{ address: '10.0.0.9', family: 4 }];
      }
      throw new Error('ENOTFOUND');
    });
    const previous = new Map<string, string[]>([
      ['oap-a:11800', ['10.0.0.1:11800']],
      ['oap-b:11800', ['10.0.0.2:11800']],
    ]);

    const result = await expandBackendAddresses(['oap-a:11800', 'oap-b:11800'], {
      lookup,
      previousByConfigured: previous,
    });
    expect(result.hadLookupFailure).toBe(true);
    expect(result.addresses).toEqual(['10.0.0.9:11800', '10.0.0.2:11800']);
    expect(result.byConfigured.get('oap-a:11800')).toEqual(['10.0.0.9:11800']);
    expect(result.byConfigured.get('oap-b:11800')).toEqual(['10.0.0.2:11800']);
  });

  it('expandBackendAddresses times out a hung lookup and continues', async () => {
    const lookup = jest.fn(
      () =>
        new Promise<Array<{ address: string; family: number }>>(() => {
          /* never resolves */
        }),
    );
    const started = Date.now();
    const result = await expandBackendAddresses(['hung:11800', '10.0.0.9:11800'], lookup);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(result.addresses).toEqual(['10.0.0.9:11800']);
    expect(result.hadLookupFailure).toBe(true);
    expect(lookup).toHaveBeenCalledWith('hung');
  }, 20000);

  it('does not surface unhandledRejection when lookup fails after timeout', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    let rejectLookup: (error: Error) => void = () => undefined;
    const lookup = jest.fn(
      () =>
        new Promise<Array<{ address: string; family: number }>>((_, reject) => {
          rejectLookup = reject;
        }),
    );

    const result = await expandBackendAddresses(['late-fail:11800'], lookup);
    expect(result.addresses).toEqual([]);
    expect(result.hadLookupFailure).toBe(true);

    rejectLookup(new Error('late ENOTFOUND'));
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  }, 20000);
});
