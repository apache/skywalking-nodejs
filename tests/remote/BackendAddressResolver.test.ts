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
  parseStaticBackendAddresses,
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
});
