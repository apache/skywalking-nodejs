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

import config from '../../../../config/AgentConfig';
import * as grpc from 'grpc';
import { connectivityState } from 'grpc';
import { createLogger } from '../../../../logging';
import Client from './Client';
import { TraceSegmentReportServiceClient } from '../../../../proto/language-agent/Tracing_grpc_pb';
import AuthInterceptor from '../AuthInterceptor';
import buffer from '../../../../agent/Buffer';
import SegmentObjectAdapter from '../SegmentObjectAdapter';

const logger = createLogger(__filename);

class TraceReportClient implements Client {
  reporterClient: TraceSegmentReportServiceClient;
  timeout: any;

  constructor() {
    this.reporterClient = new TraceSegmentReportServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      { interceptors: [AuthInterceptor] },
    );
  }

  get isConnected(): boolean {
    return this.reporterClient.getChannel().getConnectivityState(true) === connectivityState.READY;
  }

  ref() {
    this.timeout.ref();
  }

  start() {
    /*
    init the reporterClient again
    */
    this.reporterClient = new TraceSegmentReportServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      { interceptors: [AuthInterceptor] },
    );
    const reportFunction = () => {
      try {
        if (buffer.length === 0) {
          return;
        }

        const stream = this.reporterClient.collect((error, _) => {
          if (error) {
            logger.error('Failed to report trace data', error);
          }
        });

        while (buffer.length > 0) {
          const segment = buffer.buffer.splice(0, 1)[0];
          if (segment) {
            if (logger.isDebugEnabled()) {
              logger.debug('Sending segment ', { segment });
            }

            stream.write(new SegmentObjectAdapter(segment));
          }
        }

        stream.end();
      } finally {
        this.timeout = setTimeout(reportFunction, 1000).unref();
      }
    };

    this.timeout = setTimeout(reportFunction, 1000).unref();
  }
}

export default new TraceReportClient();
