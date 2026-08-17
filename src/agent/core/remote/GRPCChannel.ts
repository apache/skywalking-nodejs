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

import * as grpc from '@grpc/grpc-js';
import { ClientOptions, connectivityState, ChannelOptions } from '@grpc/grpc-js';
import ChannelBuilder, { ChannelBuildContext } from './ChannelBuilder';
import ChannelDecorator from './ChannelDecorator';

export default class GRPCChannel {
  private readonly originChannel: grpc.Channel;
  private readonly interceptors: grpc.Interceptor[];

  /**
   * Builders must spread `context.options` when they replace the options object
   * so native channel options (keepalive / service_config) are preserved.
   * `extraOptions` are merged exactly once into the initial context.
   */
  private constructor(
    target: string,
    channelBuilders: ChannelBuilder[],
    decorators: ChannelDecorator[],
    extraOptions: ChannelOptions,
  ) {
    let context: ChannelBuildContext = {
      credentials: grpc.credentials.createInsecure(),
      options: { ...extraOptions },
    };

    for (const builder of channelBuilders) {
      context = builder.build(context);
    }

    this.originChannel = new grpc.Channel(target, context.credentials, context.options);
    this.interceptors = decorators.map((decorator) => decorator.build());
  }

  static create(
    target: string,
    channelBuilders: ChannelBuilder[],
    decorators: ChannelDecorator[],
    extraOptions: ChannelOptions = {},
  ): GRPCChannel {
    return new GRPCChannel(target, channelBuilders, decorators, extraOptions);
  }

  static newBuilder(target: string): GRPCChannelBuilder {
    return new GRPCChannelBuilder(target);
  }

  getChannel(): grpc.Channel {
    return this.originChannel;
  }

  getClientOptions(): ClientOptions {
    return {
      channelOverride: this.originChannel,
      interceptors: this.interceptors,
    };
  }

  isConnected(requestConnection = false): boolean {
    return this.originChannel.getConnectivityState(requestConnection) === connectivityState.READY;
  }

  getConnectivityState(requestConnection = false): connectivityState {
    return this.originChannel.getConnectivityState(requestConnection);
  }

  shutdownNow(): void {
    this.originChannel.close();
  }
}

class GRPCChannelBuilder {
  private readonly target: string;
  private readonly channelBuilders: ChannelBuilder[] = [];
  private readonly decorators: ChannelDecorator[] = [];
  private extraOptions: ChannelOptions = {};

  constructor(target: string) {
    this.target = target;
  }

  addManagedChannelBuilder(builder: ChannelBuilder): this {
    this.channelBuilders.push(builder);
    return this;
  }

  addChannelDecorator(decorator: ChannelDecorator): this {
    this.decorators.push(decorator);
    return this;
  }

  withChannelOptions(options: ChannelOptions): this {
    this.extraOptions = { ...this.extraOptions, ...options };
    return this;
  }

  build(): GRPCChannel {
    return GRPCChannel.create(this.target, this.channelBuilders, this.decorators, this.extraOptions);
  }
}
