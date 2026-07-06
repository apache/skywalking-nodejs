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

import path from 'path';
import {
  getAgentPackagePath,
  resolveAgentPath,
  resetAgentPackagePathCacheForTest,
} from '../../src/agent/core/boot/AgentPackagePath';

describe('AgentPackagePath (Java AgentPackagePath parity)', () => {
  afterEach(() => {
    resetAgentPackagePathCacheForTest();
  });

  it('resolves agent package root from boot module location', () => {
    const root = getAgentPackagePath();
    expect(root).toBe(path.resolve(__dirname, '../..'));
  });

  it('joins relative paths under agent package root', () => {
    const resolved = resolveAgentPath('ca/ca.crt');
    expect(resolved).toBe(path.join(getAgentPackagePath(), 'ca/ca.crt'));
  });

  it('keeps absolute paths unchanged', () => {
    expect(resolveAgentPath('/etc/ssl/ca.crt')).toBe('/etc/ssl/ca.crt');
  });

  it('rejects relative paths that escape the agent package root', () => {
    expect(() => resolveAgentPath('../../../etc/passwd')).toThrow(/escapes agent package root/);
  });
});
