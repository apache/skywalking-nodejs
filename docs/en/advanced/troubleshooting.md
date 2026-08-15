# Troubleshooting

Start with the checks below. Set `SW_AGENT_LOGGING_LEVEL=debug` for a short test when you need more
agent detail. Change it back after the test because debug logging adds work and can produce large
logs.

## No service or traces in SkyWalking

1. Confirm that Node.js is version 20 or later.
2. Confirm that `agent.start()` runs before Express, HTTP clients, database clients, and other
   instrumented modules are loaded.
3. Check `SW_DISABLE`. The exact value `true` keeps the agent stopped.
4. Check `SW_AGENT_NAME` and select that service name in the SkyWalking UI.
5. Send a request that uses a [supported library](../plugins/supported-libraries.md).
6. Check that the path, suffix, and HTTP method are not filtered by trace settings.
7. Check the agent log for plugin version or OAP connection errors.

If the process is short-lived, call `await agent.flush()` before exit.

## OAP connection errors

The collector setting must use `host:port` form:

```bash
export SW_AGENT_COLLECTOR_BACKEND_SERVICES=oap.example.com:11800
```

Check DNS, network access, firewall rules, and the OAP gRPC port. The current agent uses only the
first item if the value is a comma-separated list.

An option passed to `agent.start()` replaces the environment value. This includes an empty string:

```typescript
// Do not do this. It removes the default collector address.
agent.start({ collectorAddress: '' });
```

For a TLS OAP endpoint, set `SW_AGENT_SECURE=true`. The agent uses the system trust store. It has no
configuration for a custom CA or client certificate. Set `SW_AGENT_AUTHENTICATION` if OAP requires
an agent token.

## Traces are missing during an OAP outage

The agent keeps finished segments in a memory buffer. When the buffer reaches
`SW_AGENT_MAX_BUFFER_SIZE`, it removes the oldest finished segment. Restore the OAP connection;
increasing the buffer only delays data loss and uses more process memory.

## A library has no spans

- Check that the agent started before the library loaded.
- Check the library and plugin in [Supported libraries](../plugins/supported-libraries.md).
- Most plugin version rules are broad, but CI tests exact versions from `package-lock.json`. Test
  other versions in your application.
- Webpack uses a smaller static plugin set. See [Webpack](webpack.md).
- AWS SDK for JavaScript v3 is not covered by the AWS SDK v2 plugins.

## Runtime metrics do not appear

1. Check that `SW_AGENT_NODEJS_RUNTIME_METRICS_REPORTER_ACTIVE` is not `false`.
2. Wait at least one report period. The default is 20 seconds.
3. Check that your OAP version includes the Node.js runtime meter rules and dashboard.
4. Check the OAP connection and agent log.

See [Node.js runtime metrics](../features/runtime-metrics.md) for meter names and OAP setup.

## Agent logs are hard to find

The default agent log level is `error`.

- When `NODE_ENV` is not `production`, logs go to the console.
- When `NODE_ENV=production`, logs go to `skywalking.log` in the process working directory.
- Set `SW_LOGGING_TARGET=console` to use the console in production.

## Data is missing when the process stops

`agent.destroy()` stops reporters but does not flush them. Use this order:

```typescript
await agent.flush();
agent.destroy();
```

Do not use stop and restart as a normal agent update method inside one process. Module patches stay
installed after `destroy()`.

## SQS receives only one message

This is current AWS SDK v2 SQS plugin behavior. The plugin removes `MaxNumberOfMessages` so it can
link one message to one entry span. Disable `AWS2SQS` if the application requires batch receives.

## Ask for help

If the checks do not solve the problem, open an issue in the
[Apache SkyWalking issue tracker](https://github.com/apache/skywalking/issues/new). Include the
Node.js Agent version, Node.js version, OAP version, target library versions, startup code, and
relevant agent errors. Remove tokens and private data first.
