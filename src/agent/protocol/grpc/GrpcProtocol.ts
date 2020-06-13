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

import Protocol from '@/agent/protocol/Protocol';
import * as grpc from 'grpc';
import { connectivityState } from 'grpc';
import config from '@/config/AgentConfig';
import { ManagementServiceClient } from '@/proto/management/Management_grpc_pb';
import { InstancePingPkg } from '@/proto/management/Management_pb';
import { createLogger } from '@/logging';
import AuthInterceptor from '@/agent/protocol/grpc/AuthInterceptor';
import { TraceSegmentReportServiceClient } from '@/proto/language-agent/Tracing_grpc_pb';
import buffer from '@/agent/Buffer';
import SegmentObjectAdapter from '@/agent/protocol/grpc/SegmentObjectAdapter';

const logger = createLogger('GrpcProtocol');

export default class GrpcProtocol implements Protocol {
  heartbeatClient: ManagementServiceClient;
  heartbeatTimer?: NodeJS.Timeout;

  reporterClient: TraceSegmentReportServiceClient;
  reportTimer?: NodeJS.Timeout;

  constructor() {
    this.heartbeatClient = new ManagementServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      { interceptors: [AuthInterceptor] },
    );

    this.reporterClient = new TraceSegmentReportServiceClient(
      config.collectorAddress,
      grpc.credentials.createInsecure(),
      { interceptors: [AuthInterceptor] },
    );
  }

  get isConnected(): boolean {
    return (this.heartbeatClient.getChannel().getConnectivityState(true) === connectivityState.READY)
      && (this.reporterClient.getChannel().getConnectivityState(true) === connectivityState.READY);
  }

  heartbeat() {
    if (this.heartbeatTimer) {
      logger.warn(`
        The heartbeat timer has already been scheduled,
        this may be a potential bug, please consider reporting
        this to https://github.com/apache/skywalking/issues/new
      `);
      return;
    }

    const keepAlivePkg = new InstancePingPkg()
      .setService(config.serviceName)
      .setServiceinstance(config.serviceInstance);

    this.heartbeatTimer = setInterval(() => {
        this.heartbeatClient.keepAlive(
          keepAlivePkg,

          (error, _) => {
            if (error) {
              logger.error('Failed to send heartbeat', error);
            }
          },
        );
      }, 3000,
    ).unref();
  }

  report() {
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

        while (buffer.buffer.length > 0) {
          const segment = buffer.buffer.pop();
          if (segment) {
            logger.info('Sending segment', { segment });
            stream.write(new SegmentObjectAdapter(segment));
          }
        }

        stream.end();
      } finally {
        this.reportTimer = setTimeout(reportFunction, 1000).unref();
      }
    };

    this.reportTimer = setTimeout(reportFunction, 1000).unref();
  }

};
