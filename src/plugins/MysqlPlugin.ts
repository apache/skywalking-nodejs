import PluginInstaller from "../core/PluginInstaller";
import Connection from "mysql2/typings/mysql/lib/Connection";
import Query from "mysql2/typings/mysql/lib/protocol/sequences/Query";
import { SpanLayer } from "../proto/language-agent/Tracing_pb";
import { Component } from "../trace/Component";
import ContextManager from "../trace/context/ContextManager";
import SwPlugin from "../core/SwPlugin";
import Tag from "../Tag";

class MysqlPlugin implements SwPlugin {
  readonly module = 'mysql2';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    this.interceptSql(installer);
  }

  private interceptSql(installer: PluginInstaller) {
    const mysql = installer.require("mysql2");
    const Connection = mysql.Connection;
    const _query: Function = Connection.prototype.query;
    Connection.prototype.query = function (this: Connection, sql: any, values: any, cb: any) {
      const span = ContextManager.current.newExitSpan("Mysql/query", `${this.config.host}:${this.config.port}`).start();
      const query: Query = _query.apply(this, [sql, values, cb]);
      span.component = Component.MYSQL;
      span.layer = SpanLayer.DATABASE;
      span.tag(Tag.DBType("mysql"));
      span.tag(Tag.DBInstance(this.config.database ?? "unknown"));
      span.tag(Tag.DBStatement(query.sql));
      span.async();
      const _onResult: Function = (query as any).onResult;
      (query as any).onResult = function () {
        span.resync();
        span.stop();
        _onResult.apply(this, arguments);
      }
      return query;
    }
  }

}

export default new MysqlPlugin();
