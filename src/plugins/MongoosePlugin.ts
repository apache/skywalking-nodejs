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

import SwPlugin, { wrapCallback, wrapPromise } from '../core/SwPlugin';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import PluginInstaller from '../core/PluginInstaller';

class MongoosePlugin implements SwPlugin {
  readonly module = 'mongoose';
  readonly versions = '*';
  mongodbEnabled?: boolean;

  install(installer: PluginInstaller): void {
    const { Model } = installer.require?.('mongoose') ?? require('mongoose');

    this.interceptOperation(Model, 'aggregate');
    this.interceptOperation(Model, 'bulkWrite');
    this.interceptOperation(Model, 'cleanIndexes');
    this.interceptOperation(Model, 'count');
    this.interceptOperation(Model, 'countDocuments');
    this.interceptOperation(Model, 'create');
    this.interceptOperation(Model, 'createCollection');
    this.interceptOperation(Model, 'createIndexes');
    this.interceptOperation(Model, 'deleteMany');
    this.interceptOperation(Model, 'deleteOne');
    this.interceptOperation(Model, 'distinct');
    this.interceptOperation(Model, 'ensureIndexes');
    this.interceptOperation(Model, 'estimatedDocumentCount');
    this.interceptOperation(Model, 'exists');

    this.interceptOperation(Model, 'find');
    this.interceptOperation(Model, 'findById');
    this.interceptOperation(Model, 'findByIdAndDelete');
    this.interceptOperation(Model, 'findByIdAndRemove');
    this.interceptOperation(Model, 'findByIdAndUpdate');
    this.interceptOperation(Model, 'findOne');
    this.interceptOperation(Model, 'findOneAndDelete');
    this.interceptOperation(Model, 'findOneAndRemove');
    this.interceptOperation(Model, 'findOneAndReplace');
    this.interceptOperation(Model, 'findOneAndUpdate');

    this.interceptOperation(Model, 'geoSearch');
    this.interceptOperation(Model, 'insertMany');
    this.interceptOperation(Model, 'listIndexes');
    this.interceptOperation(Model, 'mapReduce');
    this.interceptOperation(Model, 'populate');
    this.interceptOperation(Model, 'remove');
    this.interceptOperation(Model, 'replaceOne');
    this.interceptOperation(Model, 'syncIndexes');
    this.interceptOperation(Model, 'update');
    this.interceptOperation(Model, 'updateMany');
    this.interceptOperation(Model, 'updateOne');
    this.interceptOperation(Model, 'validate');

    this.interceptOperation(Model.prototype, 'delete');
    this.interceptOperation(Model.prototype, 'deleteOne');
    this.interceptOperation(Model.prototype, 'remove');
    this.interceptOperation(Model.prototype, 'save');

    // TODO:
    //   discriminator?
    //   startSession?
    //   where?

    // NODO:
    //   hydrate
  }

  interceptOperation(Container: any, operation: string): void {
    const _original = Container[operation];

    if (!_original) return;

    Container[operation] = function () {
      let span = ContextManager.currentSpan;

      if ((span as any)?.mongooseInCall)
        // mongoose has called into itself internally
        return _original.apply(this, arguments);

      const host = `${this.db.host}:${this.db.port}`;
      span = ContextManager.current.newExitSpan('Mongoose/' + operation, Component.MONGOOSE, Component.MONGODB);

      span.start();

      try {
        span.component = Component.MONGOOSE;
        span.layer = SpanLayer.DATABASE; // mongodb may not actually be called so we set these here in case
        span.peer = host;

        span.tag(Tag.dbType('MongoDB'));
        span.tag(Tag.dbInstance(this.db.name));

        const hasCB = typeof arguments[arguments.length - 1] === 'function';

        if (hasCB) {
          const wrappedCallback = wrapCallback(span, arguments[arguments.length - 1], 0);

          arguments[arguments.length - 1] = function () {
            // in case of immediate synchronous callback from mongoose
            (span as any).mongooseInCall = false;
            wrappedCallback.apply(this, arguments as any);
          };
        }

        (span as any).mongooseInCall = true; // if mongoose calls into itself while executing this operation then ignore it
        let ret = _original.apply(this, arguments);
        (span as any).mongooseInCall = false;

        if (!hasCB) {
          if (ret && typeof ret.then === 'function') {
            // generic Promise check

            if (ret.constructor.name != 'Query') {
              ret = wrapPromise(span, ret);
            } else {
              // Mongoose Query object
              const chainMethods = ['select', 'sort', 'skip', 'limit', 'populate'];

              // Mongoose Query object
              const originalThen = ret.then;
              const originalExec = ret.exec;
              const originalLean = ret.lean;

              // Preserve the query chain methods using arrow functions to maintain context
              ret.then = (...args: any[]) => wrapPromise(span, originalThen.apply(ret, args));
              ret.exec = (...args: any[]) => wrapPromise(span, originalExec.apply(ret, args));
              ret.lean = (...args: any[]) => {
                const leanQuery = originalLean.apply(ret, args);
                // Preserve other chain methods on the lean result
                leanQuery.then = ret.then;
                leanQuery.exec = ret.exec;
                return leanQuery;
              };
              // Wrap other common query methods that might be chained
              chainMethods.forEach((method) => {
                if (ret[method]) {
                  const originalMethod = ret[method];
                  ret[method] = (...args: any[]) => {
                    const result = originalMethod.apply(ret, args);
                    result.then = ret.then;
                    result.exec = ret.exec;
                    result.lean = ret.lean;
                    return result;
                  };
                }
              });
            }
          } else {
            // no callback passed in and no Promise or Cursor returned, play it safe
            span.stop();

            return ret;
          }
        }

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
export default new MongoosePlugin();
