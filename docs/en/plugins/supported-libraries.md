# Supported libraries

The agent installs a plugin only when its target module is present and its version matches the
plugin rule. Start the agent before loading these modules.

## Automatic instrumentation

| Library | Module | Disable value | Current plugin CI suite |
| --- | --- | --- | --- |
| Node.js HTTP and HTTPS | Built-in `http` and `https` | `http` | Yes |
| [Express](https://expressjs.com/) | `express` | `express` | Yes |
| [Axios](https://axios-http.com/) | `axios` | `axios` | Yes |
| [MySQL](https://github.com/mysqljs/mysql) | `mysql` | `mysql` | Yes |
| [MySQL2](https://github.com/sidorares/node-mysql2) | `mysql2` | `mysql2` | Yes |
| [PostgreSQL](https://node-postgres.com/) | `pg` | `pg` | Yes |
| [pg-cursor](https://github.com/brianc/node-postgres/tree/master/packages/pg-cursor) | `pg-cursor` through the `pg` plugin | `pg` | No current coverage |
| [MongoDB](https://github.com/mongodb/node-mongodb-native) | `mongodb` | `mongodb` | Yes |
| [Mongoose](https://mongoosejs.com/) | `mongoose` | `mongoose` | Yes |
| [RabbitMQ client](https://github.com/amqp-node/amqplib) | `amqplib` | `amqplib` | No dedicated current suite |
| [ioredis](https://github.com/redis/ioredis) | `ioredis` | `ioredis` | Yes |
| [AWS SDK for JavaScript v2](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/welcome.html) | `aws-sdk` 2.x | See below | No dedicated current suite |

The normal plugin loader uses the plugin file name without its `Plugin` suffix for
`SW_AGENT_DISABLE_PLUGINS`. Values are not case-sensitive. AWS SDK v2 has four plugins, so disable
them separately with `AWS2DynamoDB`, `AWS2Lambda`, `AWS2SNS`, or `AWS2SQS`.

```bash
export SW_AGENT_DISABLE_PLUGINS='mysql,express,AWS2SQS'
```

Webpack uses a separate static plugin loader and currently checks internal names such as
`MySQLPlugin`. Read [Webpack](../advanced/webpack.md) before setting plugin disable values in a
bundle.

## Version rules

Most current plugins declare `*` as their module version rule. The AWS plugins declare `2.*`.
`*` means that the loader accepts the installed version; it does not mean that every past or future
module version has been tested.

CI runs the plugin suites on Node.js 20, 22, and 24 with the dependency versions in the repository
lock file. Check the
[test workflow](https://github.com/apache/skywalking-nodejs/blob/v0.9.0/.github/workflows/test.yaml)
and [package lock](https://github.com/apache/skywalking-nodejs/blob/v0.9.0/package-lock.json) when an
exact tested version matters.

## Libraries without a direct plugin

Libraries built on Node.js HTTP may create spans through the HTTP plugin even when they do not have
a plugin of their own. Earlier project documentation named `request`, `request-promise`, and `koa`
as examples. The current repository does not run a separate CI suite for these packages, so treat
their behavior as indirect HTTP instrumentation.

## What the plugins record

- HTTP plugins record request operations, peers, status codes, and trace context.
- Database plugins record database type, instance, peer, and statement or command where available.
- Messaging plugins record broker and queue or topic information where available.
- AWS SDK v2 plugins record supported DynamoDB, Lambda, SNS, and SQS operations.

Database parameter values are off by default. See [Configuration](../setup/configuration.md) before
enabling them.
