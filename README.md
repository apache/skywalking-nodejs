# SkyWalking NodeJS Agent

<img src="http://skywalking.apache.org/assets/logo.svg" alt="Sky Walking logo" height="90px" align="right" />

**SkyWalking-NodeJS**: The NodeJS Agent for Apache SkyWalking, which provides the native tracing abilities for NodeJS backend project.

**SkyWalking**: an APM(application performance monitor) system, especially designed for
microservices, cloud native and container-based (Docker, Kubernetes, Mesos) architectures.

[![GitHub stars](https://img.shields.io/github/stars/apache/skywalking-nodejs.svg?style=for-the-badge&label=Stars&logo=github)](https://github.com/apache/skywalking-nodejs)
[![Twitter Follow](https://img.shields.io/twitter/follow/asfskywalking.svg?style=for-the-badge&label=Follow&logo=twitter)](https://twitter.com/AsfSkyWalking)


[![Build](https://github.com/apache/skywalking-nodejs/workflows/Build/badge.svg?branch=master)](https://github.com/apache/skywalking-nodejs/actions?query=branch%3Amaster+event%3Apush+workflow%3A%22Build%22)

## Install SkyWalking NodeJS package from npmjs

```bash
$ npm install --save skywalking-backend-js
```

## Set up NodeJS Agent

SkyWalking NodeJS SDK requires SkyWalking backend (OAP) 8.0+ and NodeJS >= 10.

```typescript
import agent from 'skywalking-backend-js';

agent.start();
```

This will use default configurations to start the SkyWalking agent above, if you want to specify your own configurations, here are two methods.

- Pass those values to `agent.start` method, such as:

```typescript
agent.start({
  serviceName: 'my-service-name',
  serviceInstance: 'my-service-instance-name',
  collectorAddress: 'my.collector.address:port',
});
```

note that all options given (including empty/null values) will override the corresponding default values, e.g. `agent.start({ collectorAddress: '' })` will override the default value of `collectorAddress` to empty string, causing errors like `DNS resolution failed`.

- Use environment variables.

The supported environment variables are as follows:

Environment Variable | Description | Default
| :--- | :--- | :--- |
| `SW_AGENT_NAME` | The name of the service | `your-nodejs-service` |
| `SW_AGENT_INSTANCE` | The name of the service instance | Randomly generated |
| `SW_AGENT_COLLECTOR_BACKEND_SERVICES` | The backend OAP server address | `127.0.0.1:11800` |
| `SW_AGENT_AUTHENTICATION` | The authentication token to verify that the agent is trusted by the backend OAP, as for how to configure the backend, refer to [the yaml](https://github.com/apache/skywalking/blob/4f0f39ffccdc9b41049903cc540b8904f7c9728e/oap-server/server-bootstrap/src/main/resources/application.yml#L155-L158). | not set |
| `SW_AGENT_LOGGING_LEVEL` | The logging level, could be one of `CRITICAL`, `FATAL`, `ERROR`, `WARN`(`WARNING`), `INFO`, `DEBUG` | `INFO` |
| `SW_IGNORE_SUFFIX` | The suffices of endpoints that will be ignored (not traced), comma separated | `.jpg,.jpeg,.js,.css,.png,.bmp,.gif,.ico,.mp3,.mp4,.html,.svg` |
| `SW_TRACE_IGNORE_PATH` | The paths of endpoints that will be ignored (not traced), comma separated | `` |
| `SW_AGENT_MAX_BUFFER_SIZE` | The maximum buffer size before sending the segment data to backend | `'1000'` |

## Supported Libraries

There are some built-in plugins that support automatic instrumentation of NodeJS libraries, the complete lists are as follows:

Library | Plugin Name
| :--- | :--- |
| built-in `http` and `https` module | `http` |
| [`express`](https://expressjs.com) | `express` |
| [`axios`](https://github.com/axios/axios) | `axios` |

## Contact Us
* Submit [an issue](https://github.com/apache/skywalking/issues/new) by using [Nodejs] as title prefix.
* Mail list: **dev@skywalking.apache.org**. Mail to `dev-subscribe@skywalking.apache.org`, follow the reply to subscribe the mail list.
* Join `skywalking` channel at [Apache Slack](http://s.apache.org/slack-invite). If the link is not working, find the latest one at [Apache INFRA WIKI](https://cwiki.apache.org/confluence/display/INFRA/Slack+Guest+Invites).
* Twitter, [ASFSkyWalking](https://twitter.com/ASFSkyWalking)

## License
Apache 2.0
