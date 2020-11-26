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

import { Log, RefType, SegmentObject, SegmentReference, SpanObject } from '../../../proto/language-agent/Tracing_pb';
import config from '../../../config/AgentConfig';
import { KeyStringValuePair } from '../../../proto/common/Common_pb';
import Segment from '../../../trace/context/Segment';

/**
 * An adapter that adapts {@link Segment} objects to gRPC object {@link SegmentObject}.
 */
export default class SegmentObjectAdapter extends SegmentObject {
  constructor(segment: Segment) {
    super();
    this.setService(config.serviceName);
    this.setServiceinstance(config.serviceInstance);
    this.setTraceid(segment.relatedTraces[0].toString());
    this.setTracesegmentid(segment.segmentId.toString());
    this.setSpansList(
      segment.spans.map((span) => {
        const spanObj = new SpanObject();
        spanObj.setSpanid(span.id);
        spanObj.setParentspanid(span.parentId);
        spanObj.setStarttime(span.startTime);
        spanObj.setEndtime(span.endTime);
        spanObj.setOperationname(span.operation);
        spanObj.setPeer(span.peer);
        spanObj.setSpantype(span.type);
        spanObj.setSpanlayer(span.layer);
        spanObj.setComponentid(span.component.id);
        spanObj.setIserror(span.errored);
        spanObj.setLogsList(
          span.logs.map((log) => {
            const l = new Log();
            l.setTime(log.timestamp);
            l.setDataList(
              log.items.map((logItem) => {
                const item = new KeyStringValuePair();
                item.setKey(logItem.key);
                item.setValue(logItem.val);
                return item;
              }),
            );
            return l;
          }),
        );
        spanObj.setTagsList(
          span.tags.map((tag) => {
            const item = new KeyStringValuePair();
            item.setKey(tag.key);
            item.setValue(tag.val);
            return item;
          }),
        );
        spanObj.setRefsList(
          span.refs.map((ref) => {
            const segmentRef = new SegmentReference();
            segmentRef.setReftype(RefType.CROSSPROCESS);
            segmentRef.setTraceid(ref.traceId.toString());
            segmentRef.setParenttracesegmentid(ref.segmentId.toString());
            segmentRef.setParentspanid(ref.spanId);
            segmentRef.setParentservice(ref.service);
            segmentRef.setParentserviceinstance(ref.serviceInstance);
            segmentRef.setNetworkaddressusedatpeer(ref.clientAddress);
            return segmentRef;
          }),
        );
        return spanObj;
      }),
    );
  }
}
