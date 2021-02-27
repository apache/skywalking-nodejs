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
import ContextManager from '../trace/context/ContextManager';
import { Component } from '../trace/Component';
import Tag from '../Tag';
import { SpanLayer } from '../proto/language-agent/Tracing_pb';
import PluginInstaller from '../core/PluginInstaller';
import config from '../config/AgentConfig';

class MySQLPlugin implements SwPlugin {
  readonly module = 'mysql';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    const Connection = installer.require('mysql/lib/Connection');
    const _query = Connection.prototype.query;

    Connection.prototype.query = function(sql: any, values: any, cb: any) {
      const wrapCallback = (_cb: any) => {
        return function(this: any, error: any, results: any, fields: any) {
          span.resync();

          if (error)
            span.error(error);

          span.stop();

          return _cb.call(this, error, results, fields);
        }
      };

      let query: any;

      const host = `${this.config.host}:${this.config.port}`;
      const span = ContextManager.current.newExitSpan('mysql/query', host).start();

      try {
        span.component = Component.MYSQL;
        span.layer = SpanLayer.DATABASE;
        span.peer = host;

        span.tag(Tag.dbType('Mysql'));
        span.tag(Tag.dbInstance(`${this.config.database}`));

        let _sql: any;
        let _values: any;
        let streaming: any;

        if (typeof sql === 'function') {
          sql = wrapCallback(sql);

        } else if (typeof sql === 'object') {
          _sql = sql.sql;

          if (typeof values === 'function') {
            values = wrapCallback(values);
            _values = sql.values;

          } else if (values !== undefined) {
            _values = values;

            if (typeof cb === 'function') {
              cb = wrapCallback(cb);
            } else {
              streaming = true;
            }

          } else {
            streaming = true;
          }

        } else {
          _sql = sql;

          if (typeof values === 'function') {
            values = wrapCallback(values);

          } else if (values !== undefined) {
            _values = values;

            if (typeof cb === 'function') {
              cb = wrapCallback(cb);
            } else {
              streaming = true;
            }

          } else {
            streaming = true;
          }
        }

        span.tag(Tag.dbStatement(`${_sql}`));

        if (_values) {
          let vals = _values.map((v: any) => v === undefined ? 'undefined' : JSON.stringify(v)).join(', ');

          if (vals.length > config.sql_parameters_max_length)
            vals = vals.splice(0, config.sql_parameters_max_length);

          span.tag(Tag.dbSqlParameters(`[${vals}]`));
        }

        query = _query.call(this, sql, values, cb);

        if (streaming) {
          query.on('error', (e: any) => {
            span.resync();
            span.error(e);
          });

          query.on('end', () => {
            span.resync();  // may have already been done in 'error' but safe to do multiple times
            span.stop()
          });
        }

      } catch (e) {
        span.error(e);
        span.stop();

        throw e;
      }

      span.async();

      return query;
    };
  }
}

// noinspection JSUnusedGlobalSymbols
export default new MySQLPlugin();
