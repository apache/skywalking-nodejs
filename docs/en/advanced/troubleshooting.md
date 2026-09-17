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

If the process is short-lived, call `await agent.flush()` before exit. `flush()` is a bounded
best-effort attempt, not a delivery guarantee. See [Data is missing when the process stops](#data-is-missing-when-the-process-stops).

## OAP connection errors

The collector setting must use `host:port` form:

```bash
export SW_AGENT_COLLECTOR_BACKEND_SERVICES=oap.example.com:11800
```

Check DNS, network access, firewall rules, and the OAP gRPC port.

One `host:port` uses the grpc-js `dns:` resolver (all A/AAAA records become endpoints and are
re-resolved on demand by grpc-js when the channel needs fresh addresses — not on a fixed agent timer). A comma-separated list uses a static resolver with `pick_first`: by
default each name is a literal endpoint only — no DNS expansion or re-resolution per name, so
discovery is weaker than a single DNS name (for example a headless Kubernetes service).

To expand and periodically refresh multiple DNS names, set
`SW_AGENT_IS_RESOLVE_DNS_PERIODICALLY=true` (or `isResolveDnsPeriodically: true` in `agent.start()`).
`SW_AGENT_COLLECTOR_IS_RESOLVE_DNS_PERIODICALLY` is accepted as a Java-aligned alias.
The agent resolves each hostname to all A/AAAA records (each lookup times out after 5s),
dials the resulting IP list via
`sw-static` (including when expansion yields a single IP), and re-resolves every 30 seconds
(override with `SW_AGENT_DNS_RE_RESOLVE_INTERVAL_SECONDS`, or the Java-aligned
`SW_AGENT_COLLECTOR_GRPC_CHANNEL_CHECK_INTERVAL`). Failed names keep their last-known endpoints
so a partial DNS outage does not shrink the dial set; the gRPC channel is rebuilt when the
merged address set changes, and open is retried on later ticks if no channel was installed yet.
Timer ticks that arrive while a resolve is still running are skipped (no overlapping resolve).
Under TLS, when endpoints are IP literals, the agent uses the first configured
hostname in the list as SNI / authority unless `SW_AGENT_SSL_TARGET_NAME_OVERRIDE` is set. All backends must
still present certificates that share the needed SANs.

An option passed to `agent.start()` replaces the environment value. This includes an empty string:

```typescript
// Do not do this. It removes the default collector address.
agent.start({ collectorAddress: '' });
```

For a TLS OAP endpoint, set `SW_AGENT_SECURE=true`. The agent uses the system trust store by
default. Set `SW_AGENT_AUTHENTICATION` if OAP requires an agent token.

For a custom CA or mTLS, configure `SW_AGENT_SSL_TRUSTED_CA_PATH`. For mTLS, also configure both
`SW_AGENT_SSL_KEY_PATH` and `SW_AGENT_SSL_CERT_CHAIN_PATH`; all three paths are optional relative
to the Node.js process working directory. The client key and certificate must be a matching pair.
The agent fails channel creation when either client path is missing or unreadable, rather than
silently falling back to one-way TLS.

With Apache OAP, point the agent at the mTLS-enabled `receiver-sharing-server` gRPC listener
(commonly port `11801`, or the port selected by `SW_RECEIVER_GRPC_PORT`). Do not assume that the
regular OAP agent listener on port `11800` requests client certificates.

Under TLS with multiple backends, certificate verification follows the channel authority.
With periodic multi-name DNS expand, that is the first **hostname** in the configured list
(not an IP literal earlier in the list). Without DNS expand, authority follows the first list
entry in the configured target. Endpoint pick order may be shuffled by grpc-js, but the target
string — and therefore authority / SNI — stays in config order. Every backend must present a
certificate that shares the needed SANs, or failover handshakes fail. Prefer one DNS name with
multiple A/AAAA records for TLS high availability.

If the agent connects with a hostname or IP that does not appear in the OAP certificate SAN, the
handshake fails with a hostname mismatch. Set `SW_AGENT_SSL_TARGET_NAME_OVERRIDE` to the SAN name
that OAP does present — for example the DNS name when the agent connects via an IP literal.
This overrides both the TLS SNI and the gRPC default authority.

Channel disconnect lines are logged at `error` and recover lines at `warn` (throttled separately so a
recover line is not swallowed by the disconnect window). For per-address grpc-js detail, set
`GRPC_TRACE=pick_first,subchannel`.

## Traces are missing during an OAP outage

The agent keeps finished segments in a memory buffer. When the buffer reaches
`SW_AGENT_MAX_BUFFER_SIZE`, it removes the oldest finished segment and may log that the trace buffer
reached maximum size. Restore the OAP connection; increasing the buffer only delays data loss and
uses more process memory.

If a report attempt fails, the agent may log that it discarded N trace segment(s) after report
failure. Those segments are not re-sent. Reporting is best-effort: failures discard data, and
`flush()` only waits briefly then tries once more.

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

The default agent log level is `warn`.

| Level | What you typically see |
| --- | --- |
| `error` | Auth rejection, channel disconnect (throttled), fatal boot failures |
| `warn` (default) | Channel recovered (throttled), trace buffer full, discarded segment batches, meter report failures (throttled) |
| `info` / `debug` | Lifecycle noise; span debug lines |

Levels below the configured threshold are silent by design (`warn` / `info` / `debug` become no-ops
when the threshold is higher).

- When `NODE_ENV` is not `production`, logs go to the console.
- When `NODE_ENV=production`, logs go to `skywalking.log` in the process working directory.
- Set `SW_LOGGING_TARGET=console` to use the console in production.

## Agent to OAP over an HTTP proxy

Agent to OAP over an HTTP proxy is not supported. Every gRPC channel sets `grpc.enable_http_proxy=0`,
so host `http_proxy` / `https_proxy` never affect OAP uplink. This applies to single-address and
multi-address targets. After upgrade, traffic that previously relied on an HTTP CONNECT proxy to
reach OAP will no longer use that proxy.

## Data is missing when the process stops

`agent.destroy()` stops reporters but does not flush them. Use this order:

```typescript
await agent.flush();
agent.destroy();
```

`flush()` waits a short time for in-flight work and may start one more report attempt. It does not
guarantee delivery if OAP is slow or unreachable.

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
