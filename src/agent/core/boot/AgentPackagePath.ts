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

import path from 'path';

let cachedPackagePath: string | undefined;

/**
 * Directory containing the agent npm package (Java {@code AgentPackagePath} parity).
 * Resolved from {@code src|lib}/agent/core/boot/AgentPackagePath.ts.
 */
export function getAgentPackagePath(): string {
  if (!cachedPackagePath) {
    cachedPackagePath = path.resolve(__dirname, '..', '..', '..', '..');
  }
  return cachedPackagePath;
}

export function isPathInsideAgentRoot(resolvedPath: string): boolean {
  return isPathInsideRoot(resolvedPath, getAgentPackagePath());
}

function isPathInsideRoot(resolvedPath: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedResolved = path.resolve(resolvedPath);
  return normalizedResolved === normalizedRoot || normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`);
}

/**
 * Resolve TLS file paths relative to the agent package when not absolute
 * (Java {@code new File(AgentPackagePath.getPath(), configuredPath)}).
 */
let absoluteTlsPathWarned = false;

export function warnOnceAbsoluteTlsPath(configuredPath: string | undefined): void {
  if (absoluteTlsPathWarned || !configuredPath || !path.isAbsolute(configuredPath.trim())) {
    return;
  }
  absoluteTlsPathWarned = true;
  console.warn('[skywalking] Absolute TLS path bypasses agent-package containment checks:', configuredPath.trim());
}

export function resolveAgentPath(configuredPath: string | undefined): string | undefined {
  if (!configuredPath) {
    return undefined;
  }
  if (path.isAbsolute(configuredPath)) {
    warnOnceAbsoluteTlsPath(configuredPath);
    return path.normalize(configuredPath);
  }
  const root = getAgentPackagePath();
  const resolved = path.normalize(path.join(root, configuredPath));
  if (!isPathInsideRoot(resolved, root)) {
    throw new Error(`TLS path escapes agent package root: ${configuredPath}`);
  }
  return resolved;
}

/** @internal test hook */
export function resetAgentPackagePathCacheForTest(): void {
  cachedPackagePath = undefined;
}
