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

import PluginInstaller from './PluginInstaller';
import Span from '../trace/span/Span';

export default interface SwPlugin {
  readonly module: string;
  readonly versions: string;

  install(installer: PluginInstaller): void;
}

export const wrapEmit = (span: Span, ee: any, doError: boolean = true, stop: any = NaN) => {
  // stop = NaN because NaN !== NaN
  const stopIsFunc = typeof stop === 'function';
  const _emit = ee.emit;

  Object.defineProperty(ee, 'emit', {
    configurable: true,
    writable: true,
    value: function (this: any): any {
      const event = arguments[0];

      span.resync();

      try {
        if (doError && event === 'error') span.error(arguments[1]);

        return _emit.apply(this, arguments);
      } catch (err) {
        span.error(err);

        throw err;
      } finally {
        if (stopIsFunc ? stop(event) : event === stop) span.stop();
        else span.async();
      }
    },
  });
};

export const wrapCallback = (span: Span, callback: any, idxError: any = false) => {
  return function (this: any) {
    if (idxError !== false && arguments[idxError]) span.error(arguments[idxError]);

    span.stop();

    return callback.apply(this, arguments);
  };
};

export const wrapPromise = (span: Span, promise: any) => {
  return promise.then(
    (res: any) => {
      span.stop();

      return res;
    },

    (err: any) => {
      span.error(err);
      span.stop();

      return Promise.reject(err);
    },
  );
};
