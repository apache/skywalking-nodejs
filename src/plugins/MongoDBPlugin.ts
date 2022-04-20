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

import SwPlugin, { wrapEmit, wrapPromise } from '../core/SwPlugin';
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import PluginInstaller from '../core/PluginInstaller';
import agentConfig from '../config/AgentConfig';

class MongoDBPlugin implements SwPlugin {
  readonly module = 'mongodb';
  readonly versions = '*';

  Collection: any;
  Cursor: any;
  Db: any;

  hookCursorMaybe(span: any, cursor: any): boolean {
    if (!(cursor instanceof this.Cursor)) return false;

    wrapEmit(span, cursor, true, 'close');

    return true;
  }

  install(installer: PluginInstaller): void {
    const plugin = this;
    this.Collection = installer.require('mongodb/lib/collection');
    if (this.Collection.Collection) {
      this.Collection = this.Collection.Collection;
    }
    try {
      this.Cursor = installer.require('mongodb/lib/cursor/abstract_cursor').AbstractCursor;
    } catch (e) {
      this.Cursor = installer.require('mongodb/lib/cursor');
    }
    this.Db = installer.require('mongodb/lib/db');
    if (this.Db.Db) {
      this.Db = this.Db.Db;
    }

    const wrapCallbackWithCursorMaybe = (span: any, args: any[], idx: number): boolean => {
      const callback = args.length > idx && typeof args[(idx = args.length - 1)] === 'function' ? args[idx] : null;

      if (!callback) return false;

      args[idx] = function (this: any) {
        // arguments = [error: any, result: any]
        span.mongodbInCall = false; // we do this because some operations may call callback immediately which would not create a new span for any operations in that callback (db.collection())

        if (arguments[0]) span.error(arguments[0]);

        if (arguments[0] || !plugin.hookCursorMaybe(span, arguments[1])) span.stop();

        return callback.apply(this, arguments);
      };

      return true;
    };

    const stringify = (params: any) => {
      if (params === undefined) return '';
      else if (typeof params === 'function') return `${params}`;

      let str = JSON.stringify(params);

      if (str.length > agentConfig.mongoParametersMaxLength)
        str = str.slice(0, agentConfig.mongoParametersMaxLength) + ' ...';

      return str;
    };

    const collInsertFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [doc(s), options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}()`));

      if (agentConfig.mongoTraceParameters) span.tag(Tag.dbMongoParameters(stringify(args[0])));

      return wrapCallbackWithCursorMaybe(span, args, 1);
    };

    const collDeleteFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [filter, options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${stringify(args[0])})`));

      return wrapCallbackWithCursorMaybe(span, args, 1);
    };

    const collUpdateFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [filter, update, options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${stringify(args[0])})`));

      if (agentConfig.mongoTraceParameters) span.tag(Tag.dbMongoParameters(stringify(args[1])));

      return wrapCallbackWithCursorMaybe(span, args, 2);
    };

    const collFindOneFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [query, options, callback]
      span.tag(
        Tag.dbStatement(
          `${this.s.namespace.collection}.${operation}(${typeof args[0] !== 'function' ? stringify(args[0]) : ''})`,
        ),
      );

      return wrapCallbackWithCursorMaybe(span, args, 0);
    };

    const collFindAndRemoveFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [query, sort, options, callback]
      span.tag(
        Tag.dbStatement(
          `${this.s.namespace.collection}.${operation}(${stringify(args[0])}${
            typeof args[1] !== 'function' && args[1] !== undefined ? ', ' + stringify(args[1]) : ''
          })`,
        ),
      );

      return wrapCallbackWithCursorMaybe(span, args, 1);
    };

    const collFindAndModifyFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [query, sort, doc, options, callback]
      let params = stringify(args[0]);

      if (typeof args[1] !== 'function' && args[1] !== undefined) {
        params += ', ' + stringify(args[1]);

        if (typeof args[2] !== 'function' && args[2] !== undefined) {
          if (agentConfig.mongoTraceParameters) span.tag(Tag.dbMongoParameters(stringify(args[2])));
        }
      }

      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${params})`));

      return wrapCallbackWithCursorMaybe(span, args, 1);
    };

    const collMapReduceFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [map, reduce, options, callback]
      span.tag(
        Tag.dbStatement(`${this.s.namespace.collection}.${operation}(${stringify(args[0])}, ${stringify(args[1])})`),
      );

      return wrapCallbackWithCursorMaybe(span, args, 2);
    };

    const collDropFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [options, callback]
      span.tag(Tag.dbStatement(`${this.s.namespace.collection}.${operation}()`));

      return wrapCallbackWithCursorMaybe(span, args, 0);
    };

    const dbAddUserFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [username, password, options, callback]
      span.tag(Tag.dbStatement(`${operation}(${stringify(args[0])})`));

      return wrapCallbackWithCursorMaybe(span, args, 2);
    };

    const dbRemoveUserFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [username, options, callback]
      span.tag(Tag.dbStatement(`${operation}(${stringify(args[0])})`));

      return wrapCallbackWithCursorMaybe(span, args, 1);
    };

    const dbRenameCollectionFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [fromCollection, toCollection, options, callback]
      span.tag(Tag.dbStatement(`${operation}(${stringify(args[0])}, ${stringify(args[1])})`));

      return wrapCallbackWithCursorMaybe(span, args, 2);
    };

    const dbCollectionsFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [options, callback]
      span.tag(Tag.dbStatement(`${operation}()`));

      return wrapCallbackWithCursorMaybe(span, args, 0);
    };

    const dbEvalFunc = function (this: any, operation: string, span: any, args: any[]): boolean {
      // args = [code, parameters, options, callback]
      span.tag(
        Tag.dbStatement(
          `${operation}(${stringify(args[0])}${
            typeof args[1] !== 'function' && args[1] !== undefined ? ', ' + stringify(args[1]) : ''
          })`,
        ),
      );

      return wrapCallbackWithCursorMaybe(span, args, 1);
    };

    this.interceptOperation(this.Collection, 'insert', collInsertFunc);
    this.interceptOperation(this.Collection, 'insertOne', collInsertFunc);
    this.interceptOperation(this.Collection, 'insertMany', collInsertFunc);
    this.interceptOperation(this.Collection, 'save', collInsertFunc);
    this.interceptOperation(this.Collection, 'deleteOne', collDeleteFunc);
    this.interceptOperation(this.Collection, 'deleteMany', collDeleteFunc);
    this.interceptOperation(this.Collection, 'remove', collDeleteFunc);
    this.interceptOperation(this.Collection, 'removeOne', collDeleteFunc);
    this.interceptOperation(this.Collection, 'removeMany', collDeleteFunc);
    this.interceptOperation(this.Collection, 'update', collUpdateFunc);
    this.interceptOperation(this.Collection, 'updateOne', collUpdateFunc);
    this.interceptOperation(this.Collection, 'updateMany', collUpdateFunc);
    this.interceptOperation(this.Collection, 'replaceOne', collUpdateFunc);
    this.interceptOperation(this.Collection, 'find', collFindOneFunc); // cursor
    this.interceptOperation(this.Collection, 'findOne', collFindOneFunc);
    this.interceptOperation(this.Collection, 'findOneAndDelete', collDeleteFunc);
    this.interceptOperation(this.Collection, 'findOneAndReplace', collUpdateFunc);
    this.interceptOperation(this.Collection, 'findOneAndUpdate', collUpdateFunc);
    this.interceptOperation(this.Collection, 'findAndRemove', collFindAndRemoveFunc);
    this.interceptOperation(this.Collection, 'findAndModify', collFindAndModifyFunc);

    this.interceptOperation(this.Collection, 'bulkWrite', collInsertFunc);
    this.interceptOperation(this.Collection, 'mapReduce', collMapReduceFunc);
    this.interceptOperation(this.Collection, 'aggregate', collDeleteFunc); // cursor
    this.interceptOperation(this.Collection, 'distinct', collFindAndRemoveFunc);
    this.interceptOperation(this.Collection, 'count', collFindOneFunc);
    this.interceptOperation(this.Collection, 'estimatedDocumentCount', collDropFunc);
    this.interceptOperation(this.Collection, 'countDocuments', collFindOneFunc);

    this.interceptOperation(this.Collection, 'createIndex', collDeleteFunc);
    this.interceptOperation(this.Collection, 'createIndexes', collDeleteFunc);
    this.interceptOperation(this.Collection, 'ensureIndex', collDeleteFunc);
    this.interceptOperation(this.Collection, 'dropIndex', collDeleteFunc);
    this.interceptOperation(this.Collection, 'dropIndexes', collDropFunc);
    this.interceptOperation(this.Collection, 'dropAllIndexes', collDropFunc);
    this.interceptOperation(this.Collection, 'reIndex', collDropFunc);

    this.interceptOperation(this.Collection, 'indexes', collDropFunc);
    this.interceptOperation(this.Collection, 'indexExists', collDeleteFunc);
    this.interceptOperation(this.Collection, 'indexInformation', collDropFunc);
    this.interceptOperation(this.Collection, 'listIndexes', collDropFunc); // cursor
    this.interceptOperation(this.Collection, 'stats', collDropFunc);

    this.interceptOperation(this.Collection, 'rename', collDeleteFunc);
    this.interceptOperation(this.Collection, 'drop', collDropFunc);
    this.interceptOperation(this.Collection, 'options', collDropFunc);
    this.interceptOperation(this.Collection, 'isCapped', collDropFunc);

    this.interceptOperation(this.Db, 'aggregate', dbAddUserFunc); // cursor

    this.interceptOperation(this.Db, 'addUser', dbAddUserFunc);
    this.interceptOperation(this.Db, 'removeUser', dbRemoveUserFunc);

    this.interceptOperation(this.Db, 'collection', dbRemoveUserFunc);
    this.interceptOperation(this.Db, 'createCollection', dbRemoveUserFunc);
    this.interceptOperation(this.Db, 'renameCollection', dbRenameCollectionFunc);
    this.interceptOperation(this.Db, 'dropCollection', dbRemoveUserFunc);
    this.interceptOperation(this.Db, 'collections', dbCollectionsFunc);
    this.interceptOperation(this.Db, 'listCollections', dbAddUserFunc); // cursor

    this.interceptOperation(this.Db, 'createIndex', dbRenameCollectionFunc);
    this.interceptOperation(this.Db, 'ensureIndex', dbRenameCollectionFunc);
    this.interceptOperation(this.Db, 'indexInformation', dbRemoveUserFunc);
    this.interceptOperation(this.Db, 'stats', dbCollectionsFunc);

    this.interceptOperation(this.Db, 'command', dbRemoveUserFunc);
    this.interceptOperation(this.Db, 'eval', dbEvalFunc);
    this.interceptOperation(this.Db, 'executeDbAdminCommand', dbRemoveUserFunc);

    this.interceptOperation(this.Db, 'dropDatabase', dbCollectionsFunc);

    // TODO collection?
    //   group
    //   parallelCollectionScan
    //   geoHaystackSearch

    // NODO collection:
    //   initializeUnorderedBulkOp
    //   initializeOrderedBulkOp
    //   watch

    // NODO db:
    //   admin
    //   profilingLevel
    //   setProfilingLevel
    //   unref
    //   watch
  }

  interceptOperation(Cls: any, operation: string, operationFunc: any): void {
    const plugin = this;
    const _original = Cls.prototype[operation];

    if (!_original) return;

    Cls.prototype[operation] = function (...args: any[]) {
      let span = ContextManager.currentSpan;

      // XXX: mongodb calls back into itself at this level in several places, for this reason we just do a normal call
      // if this is detected instead of opening a new span. This should not affect secondary db calls being recorded
      // from a cursor since this span is kept async until the cursor is closed, at which point it is stoppped.

      if ((span as any)?.mongodbInCall)
        // mongodb has called into itself internally
        return _original.apply(this, args);

      let host = '???';

      try {
        const db = this instanceof plugin.Collection ? this.s.db : this;
        host = db.serverConfig.s.options.servers.map((s: any) => `${s.host}:${s.port}`).join(','); // will this work for non-NativeTopology?
      } catch {
        /* nop */
      }

      span = ContextManager.current.newExitSpan('MongoDB/' + operation, Component.MONGODB);

      span.start();

      try {
        if (span.component === Component.UNKNOWN)
          // in case mongoose sitting on top
          span.component = Component.MONGODB;

        span.layer = SpanLayer.DATABASE;
        span.peer = host;

        span.tag(Tag.dbType('MongoDB'));
        span.tag(Tag.dbInstance(`${this.s.namespace.db}`));

        const hasCB = operationFunc.call(this, operation, span, args);

        (span as any).mongodbInCall = true;
        let ret = _original.apply(this, args);
        (span as any).mongodbInCall = false;

        if (!hasCB) {
          if (plugin.hookCursorMaybe(span, ret)) {
            // NOOP
          } else if (ret && typeof ret.then === 'function') {
            // generic Promise check
            ret = wrapPromise(span, ret);
          } else {
            // no callback passed in and no Promise or Cursor returned, play it safe
            span.stop();

            return ret;
          }
        }

        span.async();

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
export default new MongoDBPlugin();
