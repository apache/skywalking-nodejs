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

import * as path from 'path';
import { DockerComposeEnvironment, StartedDockerComposeEnvironment, Wait } from 'testcontainers';
import axios from 'axios';
import waitForExpect from 'wait-for-expect';
import { promises as fs } from 'fs';

const rootDir = path.resolve(__dirname);

describe('plugin tests', () => {
  let compose: StartedDockerComposeEnvironment;

  beforeAll(async () => {
    compose = await new DockerComposeEnvironment(rootDir, 'docker-compose.yml')
    .withWaitStrategy('client', Wait.forHealthCheck())
    .up();
  });

  afterAll(async () => {
    await compose.down();
  });

  it(__filename, async () => {
    await waitForExpect(async () => expect((await axios.get('http://localhost:5001/test/express')).status).toBe(200));

    const expectedData = await fs.readFile(path.join(rootDir, 'expected.data.yaml'), 'utf8');

    try {
      await waitForExpect(async () =>
        expect((await axios.post('http://localhost:12800/dataValidate', expectedData)).status).toBe(200),
      );
    } catch (e) {
      const actualData = (await axios.get('http://localhost:12800/receiveData')).data;
      console.info({ actualData });
      throw e;
    }
  });
});
