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
      config.secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
    );
    emitter.on('segment-finished', (segment) => {
      this.buffer.push(segment);
      this.timeout?.ref();
    });
  }

  get isConnected(): boolean {
    return this.reporterClient?.getChannel().getConnectivityState(true) === connectivityState.READY;
  }

  private reportFunction(callback?: any) {
    emitter.emit('segments-sent'); // reset limiter in SpanContext

    try {
      if (this.buffer.length === 0) {
        if (callback) callback();

        return;
      }

      const stream = this.reporterClient.collect(
        AuthInterceptor(),
        { deadline: Date.now() + config.traceTimeout },
        (error, _) => {
          if (error) {
            logger.error('Failed to report trace data', error);
          }

          if (callback) callback();
        },
      );

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
      this.timeout = setTimeout(this.reportFunction.bind(this), 1000).unref();
    }
  }

  start() {
    this.timeout = setTimeout(this.reportFunction.bind(this), 1000).unref();
  }

  flush(): Promise<any> | null {
    // This function explicitly returns null instead of a resolved Promise in case of nothing to flush so that in this
    // case passing control back to the event loop can be avoided. Even a resolved Promise will run other things in
    // the event loop when it is awaited and before it continues.

    return this.buffer.length === 0
      ? null
      : new Promise((resolve) => {
          this.reportFunction(resolve);
        });
  }
}
