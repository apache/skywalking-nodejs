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

import Span from '../../trace/span/Span';
import { ContextCarrier } from '../context/ContextCarrier';
import Context from '../context/Context';
import { SpanType } from '../../proto/language-agent/Tracing_pb';
import DummyContext from '../context/DummyContext';

export default class DummySpan extends Span {
  static create(context?: Context): DummySpan {
    return new DummySpan({
      context: context ?? new DummyContext(),
      operation: '',
      type: SpanType.LOCAL,
    });
  }

  start(): any {
    if (!this.depth++) this.context.start(this);
  }

  stop(block?: any): void {
    if (!--this.depth) this.context.stop(this);
  }

  async(block?: any): void {
    this.context.async(this);
  }

  resync(): any {
    this.context.resync(this);
  }

  error(error: Error, statusOverride?: number): this {
    return this;
  }

  inject(): ContextCarrier {
    return new ContextCarrier();
  }

  extract(carrier: ContextCarrier): this {
    return this;
  }
}
