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
import { Command, Commands } from '../../../proto/common/Common_pb';
import BootService from '../boot/BootService';
import ServiceManager from '../boot/ServiceManager';
import CommandExecutorService from './CommandExecutorService';
import CommandSerialNumberCache from './CommandSerialNumberCache';

const logger = createLogger(__filename);

const MAX_COMMAND_QUEUE = 64;

export type AgentCommand = {
  name: string;
  serialNumber: string;
  args: Map<string, string>;
};

export function parseAgentCommand(command: Command): AgentCommand {
  const args = new Map<string, string>();
  let serialNumber = '';
  for (const pair of command.getArgsList()) {
    const key = pair.getKey();
    const value = pair.getValue();
    args.set(key, value);
    if (key === 'SerialNumber') {
      serialNumber = value;
    }
  }
  return {
    name: command.getCommand(),
    serialNumber,
    args,
  };
}

/** Java {@code CommandService}. */
export default class CommandService implements BootService {
  private running = false;

  private readonly queue: AgentCommand[] = [];

  private readonly serialNumberCache = new CommandSerialNumberCache();

  private drainScheduled = false;

  prepare(): void {}

  boot(): void {
    this.running = true;
  }

  onComplete(): void {}

  shutdown(): void {
    this.running = false;
    this.queue.length = 0;
  }

  priority(): number {
    return 0;
  }

  receiveCommand(commands: Commands | null | undefined): void {
    if (!commands || !this.running) {
      return;
    }

    for (const command of commands.getCommandsList()) {
      try {
        const agentCommand = parseAgentCommand(command);
        if (!agentCommand.serialNumber) {
          logger.warn('Command [%s] missing SerialNumber; ignored.', agentCommand.name);
          continue;
        }
        if (this.serialNumberCache.contain(agentCommand.serialNumber)) {
          logger.warn('Command [%s] is executed, ignored', agentCommand.name);
          continue;
        }
        if (this.queue.length >= MAX_COMMAND_QUEUE) {
          logger.warn(
            'Command [%s, %s] cannot add to command list because the command list is full.',
            agentCommand.name,
            agentCommand.serialNumber,
          );
          continue;
        }
        this.queue.push(agentCommand);
      } catch (error) {
        logger.error('Failed to parse OAP command: %s', error);
      }
    }

    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || !this.running) {
      return;
    }
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      this.drainQueue();
    });
  }

  private drainQueue(): void {
    const executor = ServiceManager.INSTANCE.findService(CommandExecutorService);
    if (!executor) {
      return;
    }

    while (this.queue.length > 0) {
      const command = this.queue.shift();
      if (!command) {
        break;
      }
      if (this.serialNumberCache.contain(command.serialNumber)) {
        continue;
      }
      try {
        executor.execute(command);
        this.serialNumberCache.add(command.serialNumber);
      } catch (error) {
        logger.error('Failed to execute command [%s]: %s', command.name, error);
      }
    }
  }
}
