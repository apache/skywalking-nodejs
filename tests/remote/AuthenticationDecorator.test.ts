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

import * as grpc from '@grpc/grpc-js';
import config from '../../src/config/AgentConfig';
import AuthenticationDecorator from '../../src/agent/core/remote/AuthenticationDecorator';

function runStartHook(interceptor: grpc.Interceptor, metadata: grpc.Metadata): void {
  const nextCall: grpc.NextCall = () =>
    ({
      start: () => {},
      sendMessage: () => {},
      halfClose: () => {},
      cancel: () => {},
      getPeer: () => 'test',
    } as unknown as grpc.InterceptingCall);

  const options = { method_definition: {} } as grpc.InterceptorOptions;
  interceptor(options, nextCall).start(metadata);
}

describe('AuthenticationDecorator (Java AuthenticationDecorator parity)', () => {
  const originalAuthorization = config.authorization;

  afterEach(() => {
    config.authorization = originalAuthorization;
  });

  it('adds Authentication header when SW_AGENT_AUTHENTICATION is configured', () => {
    config.authorization = 'test-token';
    const metadata = new grpc.Metadata();
    const setSpy = jest.spyOn(metadata, 'set');

    runStartHook(new AuthenticationDecorator().build(), metadata);

    expect(setSpy).toHaveBeenCalledWith('Authentication', 'test-token');
    setSpy.mockRestore();
  });

  it('does not add Authentication header when token is unset', () => {
    config.authorization = undefined;
    const metadata = new grpc.Metadata();
    const setSpy = jest.spyOn(metadata, 'set');

    runStartHook(new AuthenticationDecorator().build(), metadata);

    expect(setSpy).not.toHaveBeenCalledWith('Authentication', expect.anything());
    setSpy.mockRestore();
  });

  it('does not add Authentication header when token is empty', () => {
    config.authorization = '';
    const metadata = new grpc.Metadata();
    const setSpy = jest.spyOn(metadata, 'set');

    runStartHook(new AuthenticationDecorator().build(), metadata);

    expect(setSpy).not.toHaveBeenCalledWith('Authentication', expect.anything());
    setSpy.mockRestore();
  });
});
