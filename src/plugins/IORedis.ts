import PluginInstaller from 'core/PluginInstaller';
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
			const span = ContextManager.current.newExitSpan(`redis/${command?.name}`, host, Component.REDIS);

			span.start();
			span.component = Component.REDIS;
			span.layer = SpanLayer.CACHE;
			span.peer = host;
			span.tag(Tag.cacheType('Redis'));
			span.tag(Tag.cacheInstance(`${this.condition.select}`));

			const ret = wrapPromise(span, _original.apply(this, args));
			span.async();
			return ret;
		}
	}
}

export default new IORedisPlugin();