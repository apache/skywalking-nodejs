# Node.js runtime metrics

The agent reports 12 process-level meters through SkyWalking `MeterReportService`. Runtime metrics
are enabled by default. The default sample and report period is 20 seconds.

## Reported meters

| Meter name | Node.js source | Unit or value |
| --- | --- | --- |
| `instance_nodejs_process_cpu` | `process.cpuUsage()` | Percent, user plus system CPU, divided by the logical CPU count |
| `instance_nodejs_heap_used` | `process.memoryUsage().heapUsed` | Bytes |
| `instance_nodejs_heap_total` | `process.memoryUsage().heapTotal` | Bytes |
| `instance_nodejs_heap_limit` | `v8.getHeapStatistics().heap_size_limit` | Bytes |
| `instance_nodejs_rss` | `process.memoryUsage().rss` | Bytes |
| `instance_nodejs_external_memory` | `process.memoryUsage().external` | Bytes |
| `instance_nodejs_array_buffers` | `process.memoryUsage().arrayBuffers` | Bytes |
| `instance_nodejs_uptime` | `process.uptime()` | Seconds |
| `instance_nodejs_peak_malloced_memory` | `v8.getHeapStatistics().peak_malloced_memory` | Bytes |
| `instance_nodejs_malloced_memory` | `v8.getHeapStatistics().malloced_memory` | Bytes |
| `instance_nodejs_old_space_used` | `v8.getHeapSpaceStatistics()` old space | Bytes |
| `instance_nodejs_new_space_used` | `v8.getHeapSpaceStatistics()` new space | Bytes |

CPU is calculated from the change in user and system CPU time between samples. The result is
divided by the number of logical CPUs, so its normal range is 0 to 100 percent for the whole Node.js
process.

## Configure reporting

Disable runtime meters:

```bash
export SW_AGENT_NODEJS_RUNTIME_METRICS_REPORTER_ACTIVE=false
```

Change the period to 30 seconds:

```bash
export SW_AGENT_NODEJS_RUNTIME_METRICS_REPORT_PERIOD=30000
```

The period must be a positive integer in milliseconds. The same period controls sampling and
reporting. A shorter period creates more work in the agent and OAP.

The matching `agent.start()` options are `runtimeMetricsReporterActive` and
`runtimeMetricsReportPeriod`. See [Configuration](../setup/configuration.md) for old option names.

## OAP dashboard

OAP must include the Node.js runtime meter rules and dashboard. The OAP setup maps the raw
`instance_nodejs_*` meters to stored metrics whose names start with `meter_`.

See the
[Node.js runtime dashboard setup](https://skywalking.apache.org/docs/main/next/en/setup/backend/dashboards-nodejs-runtime/)
in the main SkyWalking documentation.

## Flush behavior

`agent.flush()` takes a current runtime sample and asks the meter reporter to send it. The reporter
does not keep a backlog of old meter values. A sample that cannot be sent is discarded.

Custom business metrics are not available through a stable public API in this package.
