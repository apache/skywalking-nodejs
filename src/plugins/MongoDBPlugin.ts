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

import SwPlugin, {wrapPromise} from '../core/SwPlugin';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import ExitSpan from '../trace/span/ExitSpan';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import PluginInstaller from '../core/PluginInstaller';
import agentConfig from '../config/AgentConfig';

class MongoDBPlugin implements SwPlugin {
  readonly module = 'mongodb';
  readonly versions = '*';

  Cursor: any;

  // Experimental method to determine proper end time of cursor DB operation, we stop the span when the cursor is closed.
  // Problematic because other exit spans may be created during processing, for this reason we do not .resync() this
  // span to the span list until it is closed. If the cursor is never closed then the span will not be sent.

  maybeHookCursor(span: any, cursor: any): boolean {
    if (!(cursor instanceof this.Cursor))
      return false;

    cursor.on('error', (err: any) => {
      span.error(err);
    });

    cursor.on('close', () => {
      span.stop();
    });

    return true;
  }

  install(installer: PluginInstaller): void {
    const plugin     = this;
    const Collection = installer.require('mongodb/lib/collection');
    this.Cursor      = installer.require('mongodb/lib/cursor');

    const wrapCallback = (span: any, args: any[], idx: number): boolean => {
      const callback = args.length > idx && typeof args[idx = args.length - 1] === 'function' ? args[idx] : null;

      if (!callback)
        return false;

      args[idx] = function(this: any) {  // arguments = [error: any, result: any]
        if (arguments[0])
          span.error(arguments[0]);

        if (arguments[0] || !plugin.maybeHookCursor(span, arguments[1]))
          span.stop();

        return callback.apply(this, arguments);
      }

      return true;
    };

    const stringify = (params: any) => {
      if (params === undefined)
        return '';

      let str = JSON.stringify(params);

      if (str.length > agentConfig.mongoParametersMaxLength)
        str = str.slice(0, agentConfig.mongoParametersMaxLength) + ' ...';

      return str;
    }

    const insertFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [doc(s), options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}()`));

      if (agentConfig.mongoTraceParameters)
        span.tag(Tag.dbMongoParameters(stringify(args[0])));

      return wrapCallback(span, args, 1);
    };

    const deleteFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [filter, options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${stringify(args[0])})`));

      return wrapCallback(span, args, 1);
    };

    const updateFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [filter, update, options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${stringify(args[0])})`));

      if (agentConfig.mongoTraceParameters)
        span.tag(Tag.dbMongoParameters(stringify(args[1])));

      return wrapCallback(span, args, 2);
    };

    const findOneFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [query, options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${typeof args[0] !== 'function' ? stringify(args[0]) : ''})`));

      return wrapCallback(span, args, 0);
    };

    const findAndRemoveFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [query, sort, options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${stringify(args[0])}${typeof args[1] !== 'function' && args[1] !== undefined ? ', ' + stringify(args[1]) : ''})`));

      return wrapCallback(span, args, 1);
    };

    const findAndModifyFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [query, sort, doc, options, callback]
      let params = stringify(args[0]);

      if (typeof args[1] !== 'function' && args[1] !== undefined) {
        params += ', ' + stringify(args[1]);

        if (typeof args[2] !== 'function' && args[2] !== undefined) {
          if (agentConfig.mongoTraceParameters)
            span.tag(Tag.dbMongoParameters(stringify(args[2])));
        }
      }

      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${params})`));

      return wrapCallback(span, args, 1);
    };

    const mapReduceFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [map, reduce, options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${args[0]}, ${args[1]})`));

      return wrapCallback(span, args, 2);
    };

    const dropFunc = function(this: any, operation: string, span: any, args: any[]): boolean {  // args = [options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}()`));

      return wrapCallback(span, args, 0);
    };

    this.interceptOperation(Collection, 'insert', insertFunc);
    this.interceptOperation(Collection, 'insertOne', insertFunc);
    this.interceptOperation(Collection, 'insertMany', insertFunc);
    this.interceptOperation(Collection, 'save', insertFunc);
    this.interceptOperation(Collection, 'deleteOne', deleteFunc);
    this.interceptOperation(Collection, 'deleteMany', deleteFunc);
    this.interceptOperation(Collection, 'remove', deleteFunc);
    this.interceptOperation(Collection, 'removeOne', deleteFunc);
    this.interceptOperation(Collection, 'removeMany', deleteFunc);
    this.interceptOperation(Collection, 'update', updateFunc);
    this.interceptOperation(Collection, 'updateOne', updateFunc);
    this.interceptOperation(Collection, 'updateMany', updateFunc);
    this.interceptOperation(Collection, 'replaceOne', updateFunc);
    this.interceptOperation(Collection, 'find', findOneFunc);  // cursor
    this.interceptOperation(Collection, 'findOne', findOneFunc);
    this.interceptOperation(Collection, 'findOneAndDelete', deleteFunc);
    this.interceptOperation(Collection, 'findOneAndReplace', updateFunc);
    this.interceptOperation(Collection, 'findOneAndUpdate', updateFunc);
    this.interceptOperation(Collection, 'findAndRemove', findAndRemoveFunc);
    this.interceptOperation(Collection, 'findAndModify', findAndModifyFunc);

    this.interceptOperation(Collection, 'bulkWrite', insertFunc);
    this.interceptOperation(Collection, 'mapReduce', mapReduceFunc);
    this.interceptOperation(Collection, 'aggregate', deleteFunc);  // cursor
    this.interceptOperation(Collection, 'distinct', findAndRemoveFunc);
    this.interceptOperation(Collection, 'count', findOneFunc);
    this.interceptOperation(Collection, 'estimatedDocumentCount', dropFunc);
    this.interceptOperation(Collection, 'countDocuments', findOneFunc);

    this.interceptOperation(Collection, 'createIndex', deleteFunc);
    this.interceptOperation(Collection, 'createIndexes', deleteFunc);
    this.interceptOperation(Collection, 'ensureIndex', deleteFunc);
    this.interceptOperation(Collection, 'dropIndex', deleteFunc);
    this.interceptOperation(Collection, 'dropIndexes', dropFunc);
    this.interceptOperation(Collection, 'dropAllIndexes', dropFunc);
    this.interceptOperation(Collection, 'reIndex', dropFunc);

    this.interceptOperation(Collection, 'indexes', dropFunc);
    this.interceptOperation(Collection, 'indexExists', deleteFunc);
    this.interceptOperation(Collection, 'indexInformation', dropFunc);
    this.interceptOperation(Collection, 'listIndexes', dropFunc);  // cursor

    this.interceptOperation(Collection, 'rename', deleteFunc);
    this.interceptOperation(Collection, 'drop', dropFunc);

    // TODO?

    //   stats
    //   options
    //   isCapped
    //   initializeUnorderedBulkOp
    //   initializeOrderedBulkOp
    //   watch

    //   DB functions

    // NODO:

    //   group
    //   parallelCollectionScan
    //   geoHaystackSearch
  }

  interceptOperation(Collection: any, operation: string, operationFunc: any): void {
    const plugin    = this;
    const _original = Collection.prototype[operation];

    if (!_original)
        return;

    Collection.prototype[operation] = function(...args: any[]) {
      const spans = ContextManager.spans;
      let   span = spans[spans.length - 1];

      if (span && span.component === Component.MONGODB && span instanceof ExitSpan)  // mongodb has called into itself internally
        return _original.apply(this, args);

      let ret: any;
      let host: string;

      try {
        host = this.s.db.serverConfig.s.options.servers.map((s: any) => `${s.host}:${s.port}`).join(',');  // will this work for non-NativeTopology?
      } catch {
        host = '???';
      }

      span = ContextManager.current.newExitSpan('MongoDB/' + operation, host, Component.MONGODB).start();

      try {
        span.component = Component.MONGODB;
        span.layer = SpanLayer.DATABASE;
        span.peer = host;

        span.tag(Tag.dbType('MongoDB'));
        span.tag(Tag.dbInstance(`${this.s.namespace.db}`));

        const hasCB = operationFunc.call(this, operation, span, args);

        ret = _original.apply(this, args);

        if (!hasCB) {
          if (plugin.maybeHookCursor(span, ret)) {
            // NOOP

          } else if (ret && typeof ret.then === 'function') {  // generic Promise check
            ret = wrapPromise(span, ret);

          } else {  // no callback passed in and no Promise or Cursor returned, play it safe
            span.stop();

            return ret;
          }
        }

      } catch (e) {
        span.error(e);
        span.stop();

        throw e;
      }

      span.async();

      return ret;
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new MongoDBPlugin();
