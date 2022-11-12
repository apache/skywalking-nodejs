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

import config from '../../../config/AgentConfig';
import { KeyStringValuePair } from '../../../proto/common/Common_pb';
import Segment from '../../../trace/context/Segment';
import { Log, RefType, SegmentObject, SegmentReference, SpanObject } from '../../../proto/language-agent/Tracing_pb';

/**
 * An adapter that adapts {@link Segment} objects to gRPC object {@link SegmentObject}.
 */
export default class SegmentObjectAdapter extends SegmentObject {
  constructor(segment: Segment) {
    super();
    super
      .setService(config.serviceName)
      .setServiceinstance(config.serviceInstance)
      .setTraceid(segment.relatedTraces[0].toString())
      .setTracesegmentid(segment.segmentId.toString())
      .setSpansList(
        segment.spans.map((span) =>
          new SpanObject()
            .setSpanid(span.id)
            .setParentspanid(span.parentId)
            .setStarttime(span.startTime)
            .setEndtime(span.endTime)
            .setOperationname(span.operation)
            .setPeer(span.peer)
            .setSpantype(span.type)
            .setSpanlayer(span.layer)
            .setComponentid(span.component.id)
            .setIserror(span.errored)
            .setLogsList(
              span.logs.map((log) =>
                new Log()
                  .setTime(log.timestamp)
                  .setDataList(
                    log.items.map((logItem) => new KeyStringValuePair().setKey(logItem.key).setValue(logItem.val)),
                  ),
              ),
            )
            .setTagsList(span.tags.map((tag) => new KeyStringValuePair().setKey(tag.key).setValue(tag.val)))
            .setRefsList(
              span.refs.map((ref) =>
                new SegmentReference()
                  .setReftype(RefType.CROSSPROCESS)
                  .setTraceid(ref.traceId.toString())
                  .setParenttracesegmentid(ref.segmentId.toString())
                  .setParentspanid(ref.spanId)
                  .setParentservice(ref.service)
                  .setParentserviceinstance(ref.serviceInstance)
                  .setNetworkaddressusedatpeer(ref.clientAddress),
              ),
            ),
        ),
      );
  }
}
