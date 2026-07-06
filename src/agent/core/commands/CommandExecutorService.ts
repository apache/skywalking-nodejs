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

import { createLogger } from '../../../logging';
import BootService from '../boot/BootService';
import { AgentCommand } from './CommandService';

const logger = createLogger(__filename);

/** Java {@code CommandExecutorService} — routes commands; unknown commands are logged only. */
export default class CommandExecutorService implements BootService {
  private readonly executors = new Map<string, (command: AgentCommand) => void>();

  prepare(): void {}

  boot(): void {}

  onComplete(): void {}

  shutdown(): void {}

  priority(): number {
    return 0;
  }

  registerExecutor(commandName: string, executor: (command: AgentCommand) => void): void {
    this.executors.set(commandName, executor);
  }

  execute(command: AgentCommand): void {
    const executor = this.executors.get(command.name);
    if (executor) {
      executor(command);
      return;
    }
    logger.warn('Received unsupported command [%s]; ignored (Java NoopCommandExecutor parity).', command.name);
  }
}
