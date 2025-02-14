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
import { ServerResponse } from 'http';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { ContextCarrier } from '../trace/context/ContextCarrier';
import DummySpan from '../trace/span/DummySpan';
import { ignoreHttpMethodCheck } from '../config/AgentConfig';
import PluginInstaller from '../core/PluginInstaller';
import HttpPlugin from './HttpPlugin';
import { Request } from 'express';

class ExpressPlugin implements SwPlugin {
  readonly module = 'express';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    this.interceptServerRequest(installer);
  }

  private interceptServerRequest(installer: PluginInstaller) {
    let router;

    try {
      // Express 4.x and older versions
      router = installer.require?.('express/lib/router') ?? require('express/lib/router');
    } catch (error) {
      try {
        // Express 5+ (uses dynamic import)
        const express = require('express');
        router = express.Router ? express.Router() : null;
      } catch (err) {
        console.error('⚠️ SkyWalking: Failed to load Express router - Express may not be installed.');
        return;
      }
    }

    if (!router) {
      console.warn('⚠️ SkyWalking: Unable to determine Express structure. Instrumentation is disabled.');
      return;
    }

    const _handle = router.handle;

    router.handle = function (req: Request, res: ServerResponse, next: any) {
      const carrier = ContextCarrier.from((req as any).headers || {});
      const reqMethod = req.method ?? 'GET';
      const operation = reqMethod + ':' + (req.originalUrl || req.url || '/').replace(/\?.*/g, '');
      const span = ignoreHttpMethodCheck(reqMethod)
        ? DummySpan.create()
        : ContextManager.current.newEntrySpan(operation, carrier, [Component.HTTP_SERVER, Component.EXPRESS]);

      span.component = Component.EXPRESS;

      if (span.depth) {
        // If inherited from HTTP, just change the component ID and let HTTP handle it
        return _handle.apply(this, arguments);
      }

      return HttpPlugin.wrapHttpResponse(span, req, res, () => {
        // If HTTP plugin is disabled, we use this mechanism anyway
        try {
          return _handle.call(this, req, res, (err: Error) => {
            span.error(err);
            next.call(this, err);
          });
        } finally {
          // req.protocol might only be available after calling _handle()
          span.tag(
            Tag.httpURL(
              ((req as any).protocol ? (req as any).protocol + '://' : '') + (req.headers.host || '') + req.url,
            ),
          );
        }
      });
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new ExpressPlugin();
