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

import * as fs from 'fs';
import * as path from 'path';
import SwPlugin from '../core/SwPlugin';
import { createLogger } from '../logging';
import * as semver from 'semver';
import config from '../config/AgentConfig';

const logger = createLogger(__filename);

let topModule = module;
while (topModule.parent) {
  const filename = topModule.filename;

  topModule = topModule.parent;

  if (filename.endsWith('/skywalking-backend-js/lib/index.js'))
    // stop at the appropriate level in case app is being run by some other framework
    break;
}

export default class PluginInstaller {
  private readonly pluginDir: string;
  // if we are running bundled then topModule.require and module.constructor._resolveFilename are undefined (in webpack at least)
  readonly require: (name: string) => any = topModule.require?.bind(topModule);
  readonly resolve = (request: string) => (module.constructor as any)._resolveFilename(request, topModule);

  constructor() {
    this.pluginDir = path.resolve(__dirname, '..', 'plugins');
  }

  private checkModuleVersion = (plugin: SwPlugin): { version: string; isSupported: boolean } => {
    try {
      if (plugin.isBuiltIn) {
        return {
          version: '*',
          isSupported: true,
        };
      }
    } catch {
      // module not found
      return {
        version: 'not found,',
        isSupported: false,
      };
    }

    let version = null;
    try {
      const packageJsonPath = this.resolve(`${plugin.module}/package.json`);
      version = this.require(packageJsonPath).version;
    } catch (e) {
      version = plugin.getVersion?.(this);
    }

    if (!semver.satisfies(version, plugin.versions)) {
      return {
        version: version || 'not found,',
        isSupported: false,
      };
    }
    return {
      version,
      isSupported: true,
    };
  };

  isPluginEnabled = (name: string): boolean => !name.match(config.reDisablePlugins);

  installNormal(): void {
    fs.readdirSync(this.pluginDir)
      .filter((file) => !(file.endsWith('.d.ts') || file.endsWith('.js.map')))
      .forEach((file) => {
        if (file.replace(/(?:Plugin)?\.js$/i, '').match(config.reDisablePlugins)) {
          logger.info(`Plugin ${file} not installed because it is disabled`);
          return;
        }

        let plugin;
        const pluginFile = path.join(this.pluginDir, file);

        try {
          plugin = this.require(pluginFile).default as SwPlugin;
          const { isSupported, version } = this.checkModuleVersion(plugin);

          if (!isSupported) {
            logger.info(`Plugin ${plugin.module} ${version} doesn't satisfy the supported version ${plugin.versions}`);
            return;
          }

          logger.info(`Installing plugin ${plugin.module} ${plugin.versions}`);

          plugin.install(this);
        } catch (e) {
          if (plugin) {
            logger.error(`Error installing plugin ${plugin.module} ${plugin.versions}`);
          } else {
            logger.error(`Error processing plugin ${pluginFile}`);
          }
        }
      });
  }

  private checkBundledModuleVersion = (
    plugin: SwPlugin,
    version: string,
  ): { version: string; isSupported: boolean } => {
    try {
      if (plugin.versions === '!' || plugin.isBuiltIn || version === '*') {
        return {
          version: '*',
          isSupported: true,
        };
      }
    } catch {
      // module not found
      return {
        version: 'not found,',
        isSupported: false,
      };
    }

    if (!semver.satisfies(version, plugin.versions)) {
      return {
        version,
        isSupported: false,
      };
    }
    return {
      version,
      isSupported: true,
    };
  };

  private installBundledPlugin = (pluginFile: string, plugin: SwPlugin, packageVersion: string) => {
    if (pluginFile.match(config.reDisablePlugins)) {
      logger.info(`Plugin ${pluginFile} not installed because it is disabled`);
      return;
    }

    try {
      const { isSupported, version } = this.checkBundledModuleVersion(plugin, packageVersion);

      if (!isSupported) {
        logger.info(`Plugin ${plugin.module} ${version} doesn't satisfy the supported version ${plugin.versions}`);
        return;
      }

      if (plugin.versions === '!') {
        logger.info(`Explicit instrumentation plugin ${plugin.module} available`);
      } else {
        logger.info(`Installing plugin ${plugin.module} ${plugin.versions}`);
      }

      plugin.install(this);
    } catch (e) {
      console.error(e);
      logger.error(`Error installing plugin ${plugin.module} ${plugin.versions}`);
    }
  };

  installBundled(): void {
    // XXX: Initial support for running in a bundle, not ideal and doesn't support some plugins but at least it works.
    // Webpack does not support dynamic `require(var)`, all imports must be of static form `require('module')`.

    try {
      this.installBundledPlugin(
        'AMQPLibPlugin',
        require('../plugins/AMQPLibPlugin').default,
        require('amqplib/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin(
        'AWS2DynamoDBPlugin',
        require('../plugins/AWS2DynamoDBPlugin').default,
        require('aws-sdk/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin(
        'AWS2LambdaPlugin',
        require('../plugins/AWS2LambdaPlugin').default,
        require('aws-sdk/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin(
        'AWS2SNSPlugin',
        require('../plugins/AWS2SNSPlugin').default,
        require('aws-sdk/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin(
        'AWS2SQSPlugin',
        require('../plugins/AWS2SQSPlugin').default,
        require('aws-sdk/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    // this.installBundledPlugin('AxiosPlugin', require('../plugins/AxiosPlugin').default, require('axios/package.json').version);  // this package in all its wisdom disallows import of its package.json where the version number lives

    try {
      this.installBundledPlugin(
        'ExpressPlugin',
        require('../plugins/ExpressPlugin').default,
        require('express/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin('HttpPlugin', require('../plugins/HttpPlugin').default, '*');
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin(
        'IORedisPlugin',
        require('../plugins/IORedisPlugin').default,
        require('ioredis/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin(
        'MongoDBPlugin',
        require('../plugins/MongoDBPlugin').default,
        require('mongodb/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin(
        'MongoosePlugin',
        require('../plugins/MongoosePlugin').default,
        require('mongoose/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    // this.installBundledPlugin('MySQL2Plugin', require('../plugins/MySQL2Plugin').default, require('mysql2/package.json').version);  // this package in all its wisdom disallows import of its package.json where the version number lives

    try {
      this.installBundledPlugin(
        'MySQLPlugin',
        require('../plugins/MySQLPlugin').default,
        require('mysql/package.json').version,
      );
    } catch {
      // ESLINT SUCKS!
    }

    try {
      this.installBundledPlugin('PgPlugin', require('../plugins/PgPlugin').default, require('pg/package.json').version);
    } catch {
      // ESLINT SUCKS!
    }
  }

  install(): void {
    if (this.require as any) this.installNormal();
    else this.installBundled();
  }
}
