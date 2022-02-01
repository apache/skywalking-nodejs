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

import SwPlugin from '../core/SwPlugin';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { ContextCarrier } from '../trace/context/ContextCarrier';
import PluginInstaller from '../core/PluginInstaller';

class AMQPLibPlugin implements SwPlugin {
  readonly module = 'amqplib';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    const { BaseChannel } = installer.require('amqplib/lib/channel');

    this.interceptProducer(BaseChannel);
    this.interceptConsumer(BaseChannel);
  }

  interceptProducer(BaseChannel: any): void {
    const _sendMessage = BaseChannel.prototype.sendMessage;

    BaseChannel.prototype.sendMessage = function (fields: any, properties: any, content: any) {
      const topic = fields.exchange || '';
      const queue = fields.routingKey || '';
      const peer = `${this.connection.stream.remoteAddress}:${this.connection.stream.remotePort}`;
      const span = ContextManager.current.newExitSpan(
        'RabbitMQ/' + topic + '/' + queue + '/Producer',
        Component.RABBITMQ_PRODUCER,
      );

      span.start();

      try {
        span.inject().items.forEach((item) => {
          fields.headers[item.key] = item.value;
        });

        span.component = Component.RABBITMQ_PRODUCER;
        span.layer = SpanLayer.MQ;
        span.peer = peer;

        span.tag(Tag.mqBroker((this.connection.stream.constructor.name === 'Socket' ? 'amqp://' : 'amqps://') + peer));

        if (topic) span.tag(Tag.mqTopic(topic));

        if (queue) span.tag(Tag.mqQueue(queue));

        const ret = _sendMessage.call(this, fields, properties, content);

        span.stop();

        return ret;
      } catch (e) {
        span.error(e);
        span.stop();

        throw e;
      }
    };
  }

  interceptConsumer(BaseChannel: any): void {
    const _dispatchMessage = BaseChannel.prototype.dispatchMessage;

    BaseChannel.prototype.dispatchMessage = function (fields: any, message: any) {
      const topic = message?.fields?.exchange || '';
      const queue = message?.fields?.routingKey || '';
      const carrier = ContextCarrier.from(message?.properties?.headers || {});
      const span = ContextManager.current.newEntrySpan('RabbitMQ/' + topic + '/' + queue + '/Consumer', carrier);

      span.start();

      try {
        span.component = Component.RABBITMQ_CONSUMER;
        span.layer = SpanLayer.MQ;
        span.peer = `${this.connection.stream.remoteAddress}:${this.connection.stream.remotePort}`;

        span.tag(
          Tag.mqBroker((this.connection.stream.constructor.name === 'Socket' ? 'amqp://' : 'amqps://') + span.peer),
        );

        if (topic) span.tag(Tag.mqTopic(topic));

        if (queue) span.tag(Tag.mqQueue(queue));

        if (message === null) span.log('Cancel', true);

        const ret = _dispatchMessage.call(this, fields, message);

        span.stop();

        return ret;
      } catch (e) {
        span.error(e);
        span.stop();

        throw e;
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AMQPLibPlugin();
