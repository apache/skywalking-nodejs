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

import PluginInstaller from '../core/PluginInstaller';
import SwPlugin, { wrapPromise } from '../core/SwPlugin';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import Tag from '../Tag';
import { Component } from '../trace/Component';
import ContextManager from '../trace/context/ContextManager';

class IORedisPlugin implements SwPlugin {
	readonly module = 'ioredis';
	readonly versions = '*';

	install(installer: PluginInstaller): void {
		const Redis = installer.require('ioredis');

		this.interceptOperation(Redis, 'sendCommand');
	}

	interceptOperation(Cls: any, operation: string): void {
		const _original = Cls.prototype[operation];

		if (!_original)
			return;

		Cls.prototype[operation] = function (...args: any[]) {
			const command = args[0];
			const host = `${this.options.host}:${this.options.port}`;
			const span = ContextManager.current.newExitSpan(`redis/${command?.name}`, Component.REDIS);

			span.start();
			span.component = Component.REDIS;
			span.layer = SpanLayer.CACHE;
			span.peer = host;
			span.tag(Tag.dbType('Redis'));
			span.tag(Tag.dbInstance(`${this.condition.select}`));

			try {
				const ret = wrapPromise(span, _original.apply(this, args));
				span.async();
				return ret;

			} catch (err) {
				span.error(err);
				span.stop();

				throw err;
			}
		}
	}
}

export default new IORedisPlugin();