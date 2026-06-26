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
import { ClientOptions, connectivityState } from '@grpc/grpc-js';
import ChannelBuilder, { ChannelBuildContext } from './ChannelBuilder';
import ChannelDecorator from './ChannelDecorator';

export default class GRPCChannel {
  private readonly originChannel: grpc.Channel;
  private readonly interceptors: grpc.Interceptor[];

  private constructor(host: string, port: number, channelBuilders: ChannelBuilder[], decorators: ChannelDecorator[]) {
    let context: ChannelBuildContext = {
      credentials: grpc.credentials.createInsecure(),
      options: {},
    };

    for (const builder of channelBuilders) {
      context = builder.build(context);
    }

    this.originChannel = new grpc.Channel(`${host}:${port}`, context.credentials, context.options);
    this.interceptors = decorators.map((decorator) => decorator.build());
  }

  static create(
    host: string,
    port: number,
    channelBuilders: ChannelBuilder[],
    decorators: ChannelDecorator[],
  ): GRPCChannel {
    return new GRPCChannel(host, port, channelBuilders, decorators);
  }

  static newBuilder(host: string, port: number): GRPCChannelBuilder {
    return new GRPCChannelBuilder(host, port);
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

  shutdownNow(): void {
    this.originChannel.close();
  }
}

class GRPCChannelBuilder {
  private readonly host: string;
  private readonly port: number;
  private readonly channelBuilders: ChannelBuilder[] = [];
  private readonly decorators: ChannelDecorator[] = [];

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  addManagedChannelBuilder(builder: ChannelBuilder): this {
    this.channelBuilders.push(builder);
    return this;
  }

  addChannelDecorator(decorator: ChannelDecorator): this {
    this.decorators.push(decorator);
    return this;
  }

  build(): GRPCChannel {
    return GRPCChannel.create(this.host, this.port, this.channelBuilders, this.decorators);
  }
}
