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

import * as os from 'os';

export type AgentConfig = {
  serviceName?: string;
  serviceInstance?: string;
  collectorAddress?: string;
  authorization?: string;
  maxBufferSize?: number;
};

export default {
  serviceName: process.env.SERVICE_NAME || 'your-nodejs-service',
  serviceInstance:
    process.env.SERVICE_INSTANCE ||
    ((): string => {
      return os.hostname();
    })(),
  collectorAddress: process.env.COLLECTOR_ADDRESS || '127.0.0.1:11800',
  authorization: process.env.AUTHORIZATION,
  maxBufferSize: process.env.MAX_BUFFER_SIZE || '1000',
};
