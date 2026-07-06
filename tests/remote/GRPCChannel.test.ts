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

const channelTargets: string[] = [];

jest.mock('@grpc/grpc-js', () => {
  const actual = jest.requireActual('@grpc/grpc-js');
  function Channel(this: { getConnectivityState: () => number; close: () => void }, target: string) {
    channelTargets.push(target);
    this.getConnectivityState = () => actual.connectivityState.IDLE;
    this.close = jest.fn();
  }
  return { ...actual, Channel };
});

import GRPCChannel from '../../src/agent/core/remote/GRPCChannel';
import StandardChannelBuilder from '../../src/agent/core/remote/StandardChannelBuilder';

describe('GRPCChannel', () => {
  beforeEach(() => {
    channelTargets.length = 0;
  });

  it('uses bracketed IPv6 target for grpc-js Channel constructor', () => {
    const channel = GRPCChannel.newBuilder('::1', 11800).addManagedChannelBuilder(new StandardChannelBuilder()).build();
    expect(channelTargets).toEqual(['[::1]:11800']);
    channel.shutdownNow();
  });

  it('uses plain host:port for IPv4 targets', () => {
    const channel = GRPCChannel.newBuilder('127.0.0.1', 11800)
      .addManagedChannelBuilder(new StandardChannelBuilder())
      .build();
    expect(channelTargets).toEqual(['127.0.0.1:11800']);
    channel.shutdownNow();
  });

  it('uses bracketed IPv6 target for full IPv6 literals', () => {
    const channel = GRPCChannel.newBuilder('2001:db8::1', 11800)
      .addManagedChannelBuilder(new StandardChannelBuilder())
      .build();
    expect(channelTargets).toEqual(['[2001:db8::1]:11800']);
    channel.shutdownNow();
  });
});
