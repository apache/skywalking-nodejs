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
import { URL } from 'url';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import DummySpan from '../trace/span/DummySpan';
import { ignoreHttpMethodCheck } from '../config/AgentConfig';
import PluginInstaller from '../core/PluginInstaller';
import * as fs from 'fs';
import * as path from 'path';

class AxiosPlugin implements SwPlugin {
  readonly module = 'axios';
  readonly versions = '*';

  getVersion(installer: PluginInstaller): string {
    // TODO: this method will not work in a bundle
    try {
      const indexPath = installer.resolve(this.module);
      const dirname = indexPath.slice(
        0,
        indexPath.lastIndexOf(`${path.sep}node_modules${path.sep}axios${path.sep}`) + 20,
      );
      const packageJsonStr = fs.readFileSync(`${dirname}package.json`, { encoding: 'utf-8' });
      const pkg = JSON.parse(packageJsonStr);
      return pkg.version;
    } catch {
      return '';
    }
  }

  install(installer: PluginInstaller): void {
    this.interceptClientRequest(installer);
  }

  private interceptClientRequest(installer: PluginInstaller): void {
    const axios = installer.require?.('axios') ?? require('axios');
    const Axios = axios.Axios;
    const _request = Axios.prototype.request;

    Axios.prototype.request = axios.request = function (url?: any, config?: any) {
      if (typeof url === 'string') config = config ? { ...config, url } : { url };
      else config = url ? { ...url } : {};

      const { origin, host, pathname: operation } = new URL(config.url, config.baseURL ?? this.defaults?.baseURL);
      const method = (config.method || 'GET').toUpperCase();
      const span = ignoreHttpMethodCheck(method)
        ? DummySpan.create()
        : ContextManager.current.newExitSpan(operation, Component.AXIOS, Component.HTTP);

      span.start();

      try {
        config.headers = config.headers ? { ...config.headers } : {};

        span.component = Component.AXIOS;
        span.layer = SpanLayer.HTTP;
        span.peer = host;

        span.tag(Tag.httpURL(origin + operation));
        span.tag(Tag.httpMethod(method));

        span.inject().items.forEach((item) => (config.headers[item.key] = item.value));

        const copyStatus = (response: any) => {
          if (response) {
            if (response.status) {
              span.tag(Tag.httpStatusCode(response.status));

              if (response.status >= 400) span.errored = true;
            }

            if (response.statusText) span.tag(Tag.httpStatusMsg(response.statusText));
          }
        };

        const ret = _request.call(this, config).then(
          (res: any) => {
            copyStatus(res);
            span.stop();

            return res;
          },

          (err: any) => {
            copyStatus(err.response);
            span.error(err);
            span.stop();

            return Promise.reject(err);
          },
        );

        span.async();

        return ret;
      } catch (err) {
        span.error(err);
        span.stop();

        throw err;
      }
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AxiosPlugin();
