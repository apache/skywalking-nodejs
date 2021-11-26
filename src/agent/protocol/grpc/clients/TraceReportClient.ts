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
import * as grpc from '@grpc/grpc-js';
import { connectivityState } from '@grpc/grpc-js';
import { createLogger } from '../../../../logging';
import Client from './Client';
import { TraceSegmentReportServiceClient } from '../../../../proto/language-agent/Tracing_grpc_pb';
import AuthInterceptor from '../AuthInterceptor';
import SegmentObjectAdapter from '../SegmentObjectAdapter';
import { emitter } from '../../../../lib/EventEmitter';
import Segment from '../../../../trace/context/Segment';

const logger = createLogger(__filename);

export default class TraceReportClient implements Client {
  private readonly reporterClient: TraceSegmentReportServiceClient;
  private readonly buffer: Segment[] = [];
  private timeout?: NodeJS.Timeout;

  constructor() {
    this.reporterClient = new TraceSegmentReportServiceClient(
      config.collectorAddress,
      config.secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
    );
    emitter.on('segment-finished', (segment) => {
      this.buffer.push(segment);
      this.timeout?.ref();
    });
  }

  get isConnected(): boolean {
    return this.reporterClient?.getChannel().getConnectivityState(true) === connectivityState.READY;
  }

  start() {
    const reportFunction = () => {
      emitter.emit('segments-sent'); // reset limiter in SpanContext

      try {
        if (this.buffer.length === 0) {
          return;
        }

        const stream = this.reporterClient.collect(AuthInterceptor(),(error, _) => {
          if (error) {
            logger.error('Failed to report trace data', error);
          }
        });

        try {
          for (const segment of this.buffer) {
            if (segment) {
              if (logger._isDebugEnabled) {
                logger.debug('Sending segment ', { segment });
              }

              stream.write(new SegmentObjectAdapter(segment));
            }
          }
        } finally {
          this.buffer.length = 0;
        }

        stream.end();
      } finally {
        this.timeout = setTimeout(reportFunction, 1000).unref();
      }
    };

    this.timeout = setTimeout(reportFunction, 1000).unref();
  }
}
