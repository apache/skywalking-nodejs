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

import Tag from '../Tag';
import Span from '../trace/span/Span';
import PluginInstaller from '../core/PluginInstaller';

let _AWS: any = null;
let _runTo: any, _send: any, _promise: any;

// XXX: Special versions of wrapCallback() and wrapPromise() which allows wrapping successful callback. This is used
// when an Exit span is converted to an Entry span on success of getting SQS messages. It does some extra stuff which is
// harmless in this context because it comes from a specialized fork of agent.

const wrapCallback = (span: Span, callback: any, idxError: any = false, state?: any) => {
  return function (this: any, ...args: any[]) {
    if (state) {
      if (state.stopped)
        // don't proc span stuff if span already stopped
        return callback.apply(this, args);

      if (!state.noStop) {
        state.stopped = true;

        if (state.timeouts) {
          for (const timeout of state.timeouts) clearTimeout(timeout);
        }
      }
    }

    span.resync();

    let ret;
    let isErrorOrPostCall = idxError !== false && args[idxError];

    try {
      if (isErrorOrPostCall) span.error(args[idxError]);
      else if (state?.beforeCB) {
        isErrorOrPostCall = true;
        span = state.beforeCB.call(this, span, ...args);
        isErrorOrPostCall = false;

        return callback.apply(this, args);
      } else isErrorOrPostCall = true;
    } catch (err) {
      span.error(err);

      throw err;
    } finally {
      if (!state?.noStop) span.stop();
      else span.async();

      if (isErrorOrPostCall) ret = callback.apply(this, args);
    }

    return ret;
  };
};

const wrapPromise = (span: Span, promise: any, state?: any, initialized?: boolean) => {
  if (!initialized) {
    state = { ...(state || {}), stopped: 0, thend: 0, catched: 0, timeouts: [] };

    promise = promise.then(
      // make sure span ends even if there is no user .then(), .catch() or .finally()
      (res: any) => {
        state.timeouts.push(
          setTimeout(() => {
            if (!state.stopped++) {
              span.stop();
            }
          }),
        );

        return res;
      },

      (err: any) => {
        state.timeouts.push(
          setTimeout(() => {
            if (!state.stopped++) {
              span.error(err);
              span.stop();
            }
          }),
        );

        return Promise.reject(err);
      },
    );
  }

  const _then = promise.then;
  const _catch = promise.catch;

  Object.defineProperty(promise, 'then', {
    configurable: true,
    writable: true,
    value: function (this: any, ...args: any[]): any {
      if (args[0] && !state.thend++) args[0] = wrapCallback(span, args[0], false, state);
      if (args[1] && !state.catched++) args[1] = wrapCallback(span, args[1], 0, state);

      const _promise = _then.apply(this, args);

      if (state.thend && state.catched) return _promise;
      else return wrapPromise(span, _promise, state, true);
    },
  });

  Object.defineProperty(promise, 'catch', {
    configurable: true,
    writable: true,
    value: function (this: any, err: any): any {
      if (!state.catched++) err = wrapCallback(span, err, 0, state);

      const _promise = _catch.call(this, err);

      if (state.thend && state.catched) return _promise;
      else return wrapPromise(span, _promise, state, true);
    },
  });

  return promise;
};

export function getAWS(installer: PluginInstaller): any {
  if (!_AWS) {
    _AWS = installer.require?.('aws-sdk') ?? require('aws-sdk');
    _runTo = _AWS.Request.prototype.runTo;
    _send = _AWS.Request.prototype.send;
    _promise = _AWS.Request.prototype.promise;
  }

  return _AWS;
}

export const execute = (
  span: Span,
  _this: any,
  func: any,
  params: any,
  callback: any,
  hostTag?: string | null,
  beforeCB?: (this: any, span: Span, ...args: any[]) => Span,
) => {
  span.start();
  const state = beforeCB ? { beforeCB } : null;

  try {
    if (callback) callback = wrapCallback(span, callback, 0, state);

    const req = func.call(_this, params, callback);

    if (hostTag) span.tag((Tag[hostTag as keyof typeof Tag] as any)(req.httpRequest?.endpoint?.href));
    else if (!span.peer && hostTag !== null) span.peer = req.httpRequest?.endpoint?.href;
    // span.peer = `${req.httpRequest?.endpoint?.hostname ?? '???'}:${req.httpRequest?.endpoint?.port ?? '???'}`;

    if (!callback) {
      req.send = function (send_callback: any) {
        if (send_callback) send_callback = callback = wrapCallback(span, send_callback, 0, state);

        _send.call(this, send_callback);
      };

      req.promise = function () {
        let ret = _promise.apply(this, arguments);

        if (!callback) {
          // we check just in case a .send() was done, which shouldn't be done but users...
          callback = true;
          ret = wrapPromise(
            span,
            ret,
            // convert from Promise.then(res) success args to aws-sdk2 callback(err, res) success args
            beforeCB ? { beforeCB: (span: Span, res: any) => beforeCB(span, null, res) } : null,
          );
        }

        return ret;
      };

      req.on('complete', function (res: any) {
        if (!callback) {
          // we check again because .send() might have introduced a callback
          const block = span.resync();

          if (res.error) span.error(res.error);

          span.stop();
        }
      });
    }

    req.runTo = function () {
      // we need to resync for this so that the http client picks up our exit span and sees that it inherits from it and doesn't do a whole new span
      span.resync();

      try {
        _runTo.apply(this, arguments);
      } finally {
        span.async();
      }
    };

    span.async();

    return req;
  } catch (e) {
    span.error(e);
    span.stop();

    throw e;
  }
};
