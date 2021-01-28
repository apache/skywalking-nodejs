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

import * as http from 'http';
import mysql from 'mysql2';
import agent from '../../../src';

agent.start({
  serviceName: 'server',
  maxBufferSize: 1000,
})

const server = http.createServer((req, res) => {
  const connection = mysql.createConnection({
    host: process.env.MYSQL_HOST || 'mysql',
    user: 'root',
    password: 'root',
    database: 'test'
  });
  connection.query(
    'SELECT * FROM `user` WHERE `name` = "u1"',
    function (err, results, fields) {
      res.end(JSON.stringify({
        results,
        fields
      }))
    }
  );
})

server.listen(5000, () => console.info('Listening on port 5000...'));
