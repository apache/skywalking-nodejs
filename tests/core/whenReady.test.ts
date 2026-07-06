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

jest.mock('../../src/core/PluginInstaller', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    install: jest.fn(),
  })),
}));

jest.mock('../../src/agent/core/boot/ServiceManager', () => ({
  __esModule: true,
  default: {
    INSTANCE: {
      boot: jest.fn(),
      shutdown: jest.fn(),
    },
  },
}));

import agent, { whenReady, config } from '../../src/index';
import ServiceManager from '../../src/agent/core/boot/ServiceManager';
import PluginInstaller from '../../src/core/PluginInstaller';

describe('whenReady', () => {
  beforeEach(() => {
    process.env.SW_DISABLE = 'false';
    jest.clearAllMocks();
    (PluginInstaller as jest.Mock).mockImplementation(() => ({
      install: jest.fn(),
    }));
    agent.destroy();
  });

  it('resolves after bootstrap completes', async () => {
    agent.start({});
    await expect(whenReady()).resolves.toBeUndefined();
    expect(ServiceManager.INSTANCE.boot).toHaveBeenCalled();
  });

  it('resolves immediately when agent was never started', async () => {
    await expect(whenReady()).resolves.toBeUndefined();
  });

  it('rejects when bootstrap fails (B-2)', async () => {
    (PluginInstaller as jest.Mock).mockImplementation(() => ({
      install: jest.fn().mockImplementation(() => {
        throw new Error('plugin install failed');
      }),
    }));
    agent.start({});
    await expect(whenReady()).rejects.toThrow('plugin install failed');
    expect(ServiceManager.INSTANCE.boot).not.toHaveBeenCalled();
  });

  it('exported config omits authorization token (B-4)', async () => {
    const internal = (await import('../../src/config/AgentConfig')).default;
    internal.authorization = 'secret-token';
    expect((config as Record<string, unknown>).authorization).toBeUndefined();
  });
});
