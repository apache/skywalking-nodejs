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

/* eslint-env jest */

jest.mock('../../src/config/AgentConfig', () => ({
  __esModule: true,
  default: { runtimeMetricsReporterActive: false },
}));

jest.mock('../../src/logging', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
  throttled: () => jest.fn(),
}));

import ServiceManager from '../../src/agent/core/boot/ServiceManager';
import GRPCChannelManager from '../../src/agent/core/remote/GRPCChannelManager';

describe('ServiceManager boot (Java parity)', () => {
  afterEach(() => {
    ServiceManager.INSTANCE.shutdown();
  });

  it('marks booted even when a service boot throws (Java isBooted=true unconditionally)', () => {
    const manager = ServiceManager.INSTANCE;
    const original = GRPCChannelManager.prototype.boot;
    GRPCChannelManager.prototype.boot = () => {
      throw new Error('boot exploded');
    };

    manager.boot();
    expect(manager.isBooted()).toBe(true);
    expect(manager.findService(GRPCChannelManager)).toBeDefined();

    GRPCChannelManager.prototype.boot = original;
  });
});
