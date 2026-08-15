# Configuration

You can configure the agent with environment variables or with options passed to `agent.start()`.
An option passed to `agent.start()` replaces the matching environment value.

```typescript
import agent from 'skywalking-backend-js';

agent.start({
  serviceName: 'checkout-service',
  serviceInstance: 'checkout-service-1',
  collectorAddress: 'oap.example.com:11800',
  secure: true,
  authorization: 'token-value',
});
```

Environment variables are read when the package is first loaded. Set them before starting the
Node.js process. `SW_DISABLE` is checked when `start()` is called.

## Service and OAP connection

| Environment variable | `agent.start()` option | Default | Description |
| --- | --- | --- | --- |
| `SW_AGENT_NAME` | `serviceName` | `your-nodejs-service` | Service name shown in SkyWalking. |
| `SW_AGENT_INSTANCE` | `serviceInstance` | Host name | Service instance name shown in SkyWalking. |
| `SW_AGENT_COLLECTOR_BACKEND_SERVICES` | `collectorAddress` | `127.0.0.1:11800` | OAP gRPC address in `host:port` form. |
| `SW_AGENT_SECURE` | `secure` | `false` | Use TLS for the OAP gRPC connection. |
| `SW_AGENT_AUTHENTICATION` | `authorization` | Not set | Authentication token sent to OAP. |
| `SW_AGENT_TRACE_TIMEOUT` | `traceTimeout` | `10000` | gRPC deadline in milliseconds for trace and meter reports and service management requests. Must be a positive integer. |

For token authentication, set the same token in OAP with `SW_AUTHENTICATION`. See
[OAP token authentication](https://skywalking.apache.org/docs/main/next/en/setup/backend/backend-token-auth/).

When `secure` is enabled, the agent uses the system trust store. It does not provide options for a
custom CA, client certificate, or mutual TLS.

Use one OAP address. If a comma-separated list is set, the current agent uses only the first entry.

## Agent control and logging

| Environment variable | `agent.start()` option | Default | Description |
| --- | --- | --- | --- |
| `SW_DISABLE` | None | Not set | Set the exact value `true` to keep the agent stopped. |
| `SW_AGENT_LOGGING_LEVEL` | None | `error` | Agent log level: `error`, `warn`, `info`, or `debug`. |
| `SW_LOGGING_TARGET` | None | See below | Set to `console` to log to the console in production. |
| `SW_AGENT_MAX_BUFFER_SIZE` | `maxBufferSize` | `1000` | Limit for active and buffered trace segments. Must be a positive integer. |
| `SW_AGENT_DISABLE_PLUGINS` | `disablePlugins` | Empty | Comma-separated plugin file names without the `Plugin` suffix, such as `mysql,express`. |

Outside production mode, agent logs go to the console. When `NODE_ENV=production`, logs go to
`skywalking.log` in the working directory unless `SW_LOGGING_TARGET=console` is set.

When the trace buffer is full, the oldest finished segment is removed. Increase the buffer only
after checking process memory and OAP availability.

## Trace filtering

| Environment variable | `agent.start()` option | Default | Description |
| --- | --- | --- | --- |
| `SW_IGNORE_SUFFIX` | `ignoreSuffix` | `.jpg,.jpeg,.js,.css,.png,.bmp,.gif,.ico,.mp3,.mp4,.html,.svg` | Comma-separated path suffixes that are not traced. |
| `SW_TRACE_IGNORE_PATH` | `traceIgnorePath` | Empty | Comma-separated operation-name patterns that are not traced. Supports `?`, `*`, and `**`. |
| `SW_HTTP_IGNORE_METHOD` | `httpIgnoreMethod` | Empty | Comma-separated HTTP methods that are not traced, such as `OPTIONS,HEAD`. |
| `SW_COLD_ENDPOINT` | `coldEndpoint` | `false` | Add `<cold>` to the first operation name. The first span also gets a `coldStart=true` tag. |

Ignored trace state is sent to downstream services. This stops a filtered request from creating a
partial trace later in the call chain. See [Tracing](../features/tracing.md) for pattern examples.

## Database parameters

| Environment variable | `agent.start()` option | Default | Description |
| --- | --- | --- | --- |
| `SW_SQL_TRACE_PARAMETERS` | `sqlTraceParameters` | `false` | Record SQL parameter values. |
| `SW_SQL_PARAMETERS_MAX_LENGTH` | `sqlParametersMaxLength` | `512` | Maximum SQL parameter text length. |
| `SW_MONGO_TRACE_PARAMETERS` | `mongoTraceParameters` | `false` | Record MongoDB parameter values. |
| `SW_MONGO_PARAMETERS_MAX_LENGTH` | `mongoParametersMaxLength` | `512` | Maximum MongoDB parameter text length. |

Parameter values can contain passwords, tokens, personal data, or other private data. Keep these
options off unless the data is safe to collect.

## Runtime metrics

| Environment variable | `agent.start()` option | Default | Description |
| --- | --- | --- | --- |
| `SW_AGENT_NODEJS_RUNTIME_METRICS_REPORTER_ACTIVE` | `runtimeMetricsReporterActive` | `true` | Enable Node.js runtime meters. Set to `false` to disable them. |
| `SW_AGENT_NODEJS_RUNTIME_METRICS_REPORT_PERIOD` | `runtimeMetricsReportPeriod` | `20000` | Sample and report period in milliseconds. Must be a positive integer. |

Old runtime metric environment names are still accepted:

- `SW_AGENT_RUNTIME_METRICS_REPORTER_ACTIVE`
- `SW_AGENT_NVM_METRICS_REPORTER_ACTIVE`
- `SW_AGENT_NVM_JVM_REPORTER_ACTIVE`
- `SW_AGENT_RUNTIME_METRICS_REPORT_PERIOD`
- `SW_AGENT_NVM_METRICS_REPORT_PERIOD`
- `SW_AGENT_NVM_JVM_METRICS_REPORT_PERIOD`

The old program options `nvmMetricsReporterActive`, `nvmJvmReporterActive`,
`nvmMetricsReportPeriod`, and `nvmJvmMetricsReportPeriod` are also accepted. Use the current names
for new deployments.

## AWS options

| Environment variable | `agent.start()` option | Default | Description |
| --- | --- | --- | --- |
| `SW_AWS_LAMBDA_FLUSH` | `awsLambdaFlush` | `2` | Seconds between Lambda calls after which the wrapper flushes on exit. `0` means always; `-1` means never. |
| `SW_AWS_LAMBDA_CHAIN` | `awsLambdaChain` | `false` | Add trace context to an AWS Lambda invoke payload. Use only when the caller and called Lambda are instrumented. |
| `SW_AWS_SQS_CHECK_BODY` | `awsSQSCheckBody` | `false` | Also look in an incoming SQS message body for trace context passed through SNS. |

Read [AWS SDK v2](../plugins/aws-sdk-v2.md) and [Serverless](../advanced/serverless.md) before
enabling these options.
