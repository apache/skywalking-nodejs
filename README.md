# Apache SkyWalking Node.js Agent

<img src="https://skywalking.apache.org/assets/logo.svg" alt="Apache SkyWalking logo" height="90px" align="right" />

The Apache SkyWalking Node.js Agent reports distributed traces and Node.js runtime metrics to an
Apache SkyWalking OAP server. It instruments supported Node.js libraries without changes to their
source code.

[![Build](https://github.com/apache/skywalking-nodejs/workflows/Build/badge.svg?branch=master)](https://github.com/apache/skywalking-nodejs/actions?query=branch%3Amaster+event%3Apush+workflow%3A%22Build%22)
[![npm version](https://badge.fury.io/js/skywalking-backend-js.svg)](https://www.npmjs.com/package/skywalking-backend-js)
[![GitHub stars](https://img.shields.io/github/stars/apache/skywalking-nodejs.svg?label=Stars&logo=github)](https://github.com/apache/skywalking-nodejs)

## Requirements

- Node.js 20 or later.
- A compatible Apache SkyWalking OAP server. See the
  [agent and OAP compatibility guide](https://skywalking.apache.org/docs/main/next/en/setup/service-agent/agent-compatibility/).

## Install

```bash
npm install skywalking-backend-js
```

## Quick start

Start the agent before loading the modules that it must instrument:

```typescript
import agent from 'skywalking-backend-js';

agent.start({
  serviceName: 'checkout-service',
  collectorAddress: '127.0.0.1:11800',
});
```

The same values can be set with environment variables:

```bash
export SW_AGENT_NAME=checkout-service
export SW_AGENT_COLLECTOR_BACKEND_SERVICES=127.0.0.1:11800
```

See [Quick start](docs/en/setup/quick-start.md) for the full setup and a way to load the agent with
Node.js `--require`.

## Documentation

The [documentation index](docs/README.md) includes:

- setup and all configuration values;
- tracing and Node.js runtime metrics;
- supported library plugins and AWS SDK v2 behavior;
- serverless and Webpack support;
- build, test, plugin development, and release guides.

## Main features

- Automatic trace collection for Node.js HTTP, database, messaging, and framework libraries.
- SkyWalking trace context transfer between supported services.
- Twelve process-level Node.js runtime meters.
- Optional wrappers for AWS Lambda and Azure Functions.

## Contributing

Read [Build and test](docs/en/contribution/build-and-test.md) before sending a change. Plugin authors
should also read [Plugin development](docs/en/contribution/plugin-development.md).

## Contact

- Report Node.js Agent problems in the
  [Apache SkyWalking issue tracker](https://github.com/apache/skywalking/issues/new) with `Nodejs` in
  the issue title.
- Join the `dev@skywalking.apache.org` mailing list by sending a message to
  `dev-subscribe@skywalking.apache.org`.
- Join the `skywalking` channel on [Apache Slack](https://s.apache.org/slack-invite).

## License

[Apache License 2.0](LICENSE)
