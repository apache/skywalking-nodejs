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
import { createLogger } from '../logging';
import PluginInstaller from '../core/PluginInstaller';

const logger = createLogger(__filename);

class AxiosPlugin implements SwPlugin {
  readonly module = 'axios';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    if (logger.isDebugEnabled()) {
      logger.debug('installing axios plugin');
    }

    this.interceptClientRequest(installer);
  }

  private interceptClientRequest(installer: PluginInstaller): void {
    const defaults = installer.require('axios/lib/defaults');
    const defaultAdapter = defaults.adapter;  // this will be http adapter

    defaults.adapter = (config: any) => {
      const { host, pathname: operation } = new URL(config.url);  // TODO: this may throw invalid URL
      const span = ContextManager.current.newExitSpan(operation, host).start();

      try {
        span.component = Component.AXIOS;
        span.layer = SpanLayer.HTTP;
        span.peer = host;
        span.tag(Tag.httpURL(host + operation));

        span.inject().items.forEach((item) => {
          config.headers[item.key] = item.value;
        });

        const copyStatusAndStop = (response: any) => {
          if (response) {
            if (response.status) {
              span.tag(Tag.httpStatusCode(response.status));
              if (response.status >= 400) {
                span.errored = true;
              }
            }

            if (response.statusText) {
              span.tag(Tag.httpStatusMsg(response.statusText));
            }
          }

          span.stop();
        };

        return defaultAdapter(config).then(
          (response: any) => {
            copyStatusAndStop(response);

            return response;
          },

          (error: any) => {
            span.error(error);
            copyStatusAndStop(error.response);

            return Promise.reject(error);
          }
        );

      } catch (e) {
        span.error(e);
        span.stop();

        throw e;
      }
    }
  }
}

// noinspection JSUnusedGlobalSymbols
export default new AxiosPlugin();
