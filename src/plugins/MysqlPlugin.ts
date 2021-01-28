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
import Connection from 'mysql2/typings/mysql/lib/Connection';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import { Component } from '../trace/Component';
import ContextManager from '../trace/context/ContextManager';
import SwPlugin from '../core/SwPlugin';
import Tag from '../Tag';

class MysqlPlugin implements SwPlugin {
  readonly module = 'mysql2';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    this.interceptSql(installer);
  }

  private interceptSql(installer: PluginInstaller) {
    const mysql = installer.require('mysql2');
    const _query = mysql.Connection.prototype.query;
    mysql.Connection.prototype.query = function (this: Connection, sql: any, values: any, cb: any) {
      const span = ContextManager.current.newExitSpan('Mysql/query', `${this.config.host}:${this.config.port}`).start();
      const query = _query.apply(this, [sql, values, cb]);
      span.component = Component.MYSQL;
      span.layer = SpanLayer.DATABASE;
      span.tag(Tag.dbType('mysql'));
      if (this.config.database) {
        span.tag(Tag.dbInstance(this.config.database));
      }
      span.tag(Tag.dbStatement(query.sql));
      span.async();
      const _onResult = query.onResult;
      query.onResult = function (err: Error, row: any, fields: any) {
        span.resync();
        if (err) {
          span.errored = true;
          span.error(err)
        }
        span.stop();
        _onResult.apply(this, [err, row, fields]);
      }
      return query;
    }
  }

}

export default new MysqlPlugin();
