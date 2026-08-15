# Tracing

The agent creates SkyWalking trace segments and sends them to OAP over gRPC. Supported plugins
create spans around HTTP, framework, database, cache, messaging, and AWS SDK calls.

## How tracing starts

Start the agent before the modules that it must patch. See
[Start and stop the agent](../setup/startup-and-shutdown.md).

For an incoming HTTP request, the HTTP plugin reads the SkyWalking `sw8` trace header. A valid
header links the new span to its parent. When the header is absent, the plugin starts a new trace.
A malformed `sw8` header is not recorded as a new trace. For an outgoing HTTP request, the plugin
writes the `sw8` header.

The HTTP operation name normally contains the method and path. An HTTP status code of 400 or higher
marks the span as an error. Plugins can add more tags, logs, component IDs, and peer information.

## Filter HTTP traces

Use these settings to avoid recording requests that do not help you:

- `SW_IGNORE_SUFFIX` filters a request path by suffix.
- `SW_TRACE_IGNORE_PATH` filters an operation name by a pattern.
- `SW_HTTP_IGNORE_METHOD` filters a request by HTTP method.

Incoming HTTP and Express operation names use `METHOD:/path`, such as `GET:/orders`. Outgoing HTTP
operation names use `/path`. `SW_TRACE_IGNORE_PATH` accepts comma-separated patterns:

| Pattern | Meaning | Example match |
| --- | --- | --- |
| `?` | One character except `/` | `GET:/user/?` matches `GET:/user/1`. |
| `*` | Zero or more characters except `/` | `GET:/assets/*` matches `GET:/assets/a.js`. |
| `**` | Zero or more characters across path parts | `**/internal/**` matches incoming and outgoing nested paths. |

Example:

```bash
export SW_TRACE_IGNORE_PATH='**/health,**/internal,**/internal/**'
export SW_HTTP_IGNORE_METHOD='OPTIONS,HEAD'
```

An ignored trace sends ignored state to supported downstream services. This prevents a later
service from recording a partial trace without its parent.

## Buffer and timeout

Finished segments wait in memory until the reporter sends them. `SW_AGENT_MAX_BUFFER_SIZE` controls
the number of finished segments that can wait. When this buffer is full, the oldest finished
segment is removed.

The same value limits active trace segments. When the active limit is reached, new work uses an
ignored context until the reporter resets the limit. This ignored state is sent to supported
downstream services.

`SW_AGENT_TRACE_TIMEOUT` sets the gRPC deadline in milliseconds for trace report requests.
Reporting errors do not stop application requests. The agent limits repeated connection error logs
to avoid a log storm.

## Database statements and parameters

Database plugins can record a statement or command. SQL and MongoDB parameter values are disabled
by default. Enable them only when their data is safe to send to OAP:

```bash
export SW_SQL_TRACE_PARAMETERS=true
export SW_SQL_PARAMETERS_MAX_LENGTH=512
export SW_MONGO_TRACE_PARAMETERS=true
export SW_MONGO_PARAMETERS_MAX_LENGTH=512
```

These values may include secrets or personal data. The length settings limit text size but do not
remove private values.

## Cold start tag

The first span made by the process gets the tag `coldStart=true`. Set `SW_COLD_ENDPOINT=true` to
also add `<cold>` to that operation name.

## Manual instrumentation status

The package exports `ContextManager` and `config`, and some applications use `ContextManager` to
create manual spans. This use is not documented as a stable manual instrumentation API and is not
covered by compatibility guarantees. Use the built-in plugins when possible.

The package does not provide a public API for custom business metrics. For business metrics,
consider the
[SkyWalking OpenTelemetry receiver](https://skywalking.apache.org/docs/main/next/en/setup/backend/opentelemetry-receiver/).
