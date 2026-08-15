# Apache SkyWalking Node.js Agent documentation

The Node.js Agent reports distributed traces to Apache SkyWalking OAP. Start with
[Quick start](en/setup/quick-start.md), then use the pages below when you need more detail.

## Setup

- [Quick start](en/setup/quick-start.md) — install the package and report the first trace.
- [Configuration](en/setup/configuration.md) — all environment variables and `agent.start()`
  options.
- [Start and stop the agent](en/setup/startup-and-shutdown.md) — load order, `flush()`, and
  `destroy()`.

## Features

- [Tracing](en/features/tracing.md) — trace creation, context transfer, ignored requests, and data
  limits.

## Plugins

- [Supported libraries](en/plugins/supported-libraries.md) — automatic instrumentation and plugin
  names.
- [AWS SDK v2](en/plugins/aws-sdk-v2.md) — DynamoDB, Lambda, SNS, and SQS instrumentation.

## Advanced use

- [Serverless](en/advanced/serverless.md) — AWS Lambda and Azure Functions wrappers.
- [Webpack](en/advanced/webpack.md) — current bundle support and its limits.
- [Troubleshooting](en/advanced/troubleshooting.md) — common setup and reporting problems.

## Development and contribution

- [Build and test](en/contribution/build-and-test.md) — build the agent and run its checks.
- [Plugin development](en/contribution/plugin-development.md) — add or change library
  instrumentation.
- [Release](en/contribution/release.md) — release steps for maintainers and vote checks.

Published versions are listed on the
[GitHub Releases page](https://github.com/apache/skywalking-nodejs/releases).
