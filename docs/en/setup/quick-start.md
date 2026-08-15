# Quick start

This guide installs the Node.js Agent and sends traces and runtime metrics to Apache SkyWalking
OAP.

## Requirements

- Node.js 20 or later.
- A compatible Apache SkyWalking OAP server with its gRPC receiver available. The default gRPC
  address is `127.0.0.1:11800`.

See the
[agent and OAP compatibility guide](https://skywalking.apache.org/docs/main/next/en/setup/service-agent/agent-compatibility/)
when you choose an OAP version.

## Install the package

```bash
npm install skywalking-backend-js
```

## Start the agent in code

The agent patches supported modules when `agent.start()` runs. Start it before loading your
framework, HTTP client, database client, or other instrumented module.

```typescript
import agent from 'skywalking-backend-js';

agent.start({
  serviceName: 'checkout-service',
  serviceInstance: 'checkout-service-1',
  collectorAddress: '127.0.0.1:11800',
});

// Load the application after agent.start().
```

Options passed to `agent.start()` replace environment values, including empty values. Do not pass
an empty collector address.

## Start the agent with environment variables

The package includes a small entry file for Node.js `--require`. This is useful when you cannot
change the first lines of the application.

```bash
SW_AGENT_NAME=checkout-service \
SW_AGENT_COLLECTOR_BACKEND_SERVICES=127.0.0.1:11800 \
node --require skywalking-backend-js/lib/egg app.js
```

This entry calls `agent.start()` with environment values. Despite the file name, it can be used as
a general preload entry.

## Check the result

1. Send a request to the application.
2. Open the SkyWalking UI and select the value of `SW_AGENT_NAME`.
3. Check that a trace appears.
4. Wait at least 20 seconds and check the Node.js runtime dashboard if it is installed in OAP.

If no data appears, read [Troubleshooting](../advanced/troubleshooting.md).

## Next steps

- Set production values in [Configuration](configuration.md).
- Check your modules in [Supported libraries](../plugins/supported-libraries.md).
- Read [Tracing](../features/tracing.md) to learn which requests are recorded.
