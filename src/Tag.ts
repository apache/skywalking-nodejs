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

export interface Tag {
  readonly key: string;
  readonly overridable: boolean;
  val: string;
}

export default {
  coldStartKey: 'coldStart',
  httpStatusCodeKey: 'http.status_code', // TODO: maybe find a better place to put these?
  httpStatusMsgKey: 'http.status.msg',
  httpURLKey: 'http.url',
  httpMethodKey: 'http.method',
  dbTypeKey: 'db.type',
  dbInstanceKey: 'db.instance',
  dbStatementKey: 'db.statement',
  dbSqlParametersKey: 'db.sql.parameters',
  dbMongoParametersKey: 'db.mongo.parameters',
  mqBrokerKey: 'mq.broker',
  mqTopicKey: 'mq.topic',
  mqQueueKey: 'mq.queue',
  arnKey: 'arn',

  coldStart(val: boolean = true): Tag {
    return {
      key: this.coldStartKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  httpStatusCode(val: string | number | undefined): Tag {
    return {
      key: this.httpStatusCodeKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  httpStatusMsg(val: string | undefined): Tag {
    return {
      key: this.httpStatusMsgKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  httpURL(val: string | undefined): Tag {
    return {
      key: this.httpURLKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  httpMethod(val: string | undefined): Tag {
    return {
      key: this.httpMethodKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  dbType(val: string | undefined): Tag {
    return {
      key: this.dbTypeKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  dbInstance(val: string | undefined): Tag {
    return {
      key: this.dbInstanceKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  dbStatement(val: string | undefined): Tag {
    return {
      key: this.dbStatementKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  dbSqlParameters(val: string | undefined): Tag {
    return {
      key: this.dbSqlParametersKey,
      overridable: false,
      val: `${val}`,
    } as Tag;
  },
  dbMongoParameters(val: string | undefined): Tag {
    return {
      key: this.dbMongoParametersKey,
      overridable: false,
      val: `${val}`,
    } as Tag;
  },
  mqBroker(val: string | undefined): Tag {
    return {
      key: this.mqBrokerKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  mqTopic(val: string | undefined): Tag {
    return {
      key: this.mqTopicKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  mqQueue(val: string | undefined): Tag {
    return {
      key: this.mqQueueKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
  arn(val: string | undefined): Tag {
    return {
      key: this.arnKey,
      overridable: true,
      val: `${val}`,
    } as Tag;
  },
};
