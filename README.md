# SkyWalking NodeJS Agent

<img src="http://skywalking.apache.org/assets/logo.svg" alt="Sky Walking logo" height="90px" align="right" />

**SkyWalking-NodeJS**: The NodeJS Agent for Apache SkyWalking, which provides the native tracing abilities for NodeJS backend project.

**SkyWalking**: an APM(application performance monitor) system, especially designed for
microservices, cloud native and container-based (Docker, Kubernetes, Mesos) architectures.

[![GitHub stars](https://img.shields.io/github/stars/apache/skywalking-nodejs.svg?style=for-the-badge&label=Stars&logo=github)](https://github.com/apache/skywalking-nodejs)
[![Twitter Follow](https://img.shields.io/twitter/follow/asfskywalking.svg?style=for-the-badge&label=Follow&logo=twitter)](https://twitter.com/AsfSkyWalking)


[![Build](https://github.com/apache/skywalking-nodejs/workflows/Build/badge.svg?branch=master)](https://github.com/apache/skywalking-nodejs/actions?query=branch%3Amaster+event%3Apush+workflow%3A%22Build%22)
[![npm version](https://badge.fury.io/js/skywalking-backend-js.svg)](https://badge.fury.io/js/skywalking-backend-js)

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

Note that all options given (including empty/null values) will override the corresponding default values, e.g. `agent.start({ collectorAddress: '' })` will override the default value of `collectorAddress` to empty string, causing errors like `DNS resolution failed`.

- Use environment variables.

The supported environment variables are as follows:

Environment Variable | Description | Default
| :--- | :--- | :--- |
| `SW_AGENT_NAME` | The name of the service | `your-nodejs-service` |
| `SW_AGENT_INSTANCE` | The name of the service instance | Randomly generated |
| `SW_AGENT_COLLECTOR_BACKEND_SERVICES` | The backend OAP server address | `127.0.0.1:11800` |
| `SW_AGENT_SECURE` | Whether to use secure connection to backend OAP server | `false` |
| `SW_AGENT_AUTHENTICATION` | The authentication token to verify that the agent is trusted by the backend OAP, as for how to configure the backend, refer to [the yaml](https://github.com/apache/skywalking/blob/4f0f39ffccdc9b41049903cc540b8904f7c9728e/oap-server/server-bootstrap/src/main/resources/application.yml#L155-L158). | not set |
| `SW_AGENT_LOGGING_LEVEL` | The logging level, could be one of `error`, `warn`, `info`, `debug` | `info` |
| `SW_AGENT_DISABLE_PLUGINS` | Comma-delimited list of plugins to disable in the plugins directory (e.g. "mysql", "express") | `` |
| `SW_COLD_ENDPOINT` | Cold start detection is as follows: First span to run is considered a cold start. This span gets the tag `coldStart` set to 'true'. This span also optionally gets the text '\<cold\>' appended to the endpoint name if SW_COLD_ENDPOINT is set to 'true'. | `false` |
| `SW_IGNORE_SUFFIX` | The suffices of endpoints that will be ignored (not traced), comma separated | `.jpg,.jpeg,.js,.css,.png,.bmp,.gif,.ico,.mp3,.mp4,.html,.svg` |
| `SW_TRACE_IGNORE_PATH` | The paths of endpoints that will be ignored (not traced), comma separated | `` |
| `SW_HTTP_IGNORE_METHOD` | Comma-delimited list of http methods to ignore (GET, POST, HEAD, OPTIONS, etc...) | `` |
| `SW_SQL_TRACE_PARAMETERS` | If set to 'true' then SQL query parameters will be included | `false` |
| `SW_SQL_PARAMETERS_MAX_LENGTH` | The maximum string length of SQL parameters to log | `512` |
| `SW_MONGO_TRACE_PARAMETERS` | If set to 'true' then mongodb query parameters will be included | `false` |
| `SW_MONGO_PARAMETERS_MAX_LENGTH` | The maximum string length of mongodb parameters to log | `512` |
| `SW_AWSLAMBDA_FLUSH` | If set to 'true' then AWS Lambda functions will flush segment data when the handler finishes. `false` will be more optimal for high throughput applications but may lose spans. | `true` |
| `SW_AGENT_MAX_BUFFER_SIZE` | The maximum buffer size before sending the segment data to backend | `'1000'` |

Note that the various ignore options like `SW_IGNORE_SUFFIX`, `SW_TRACE_IGNORE_PATH` and `SW_HTTP_IGNORE_METHOD` as well as endpoints which are not recorded due to exceeding `SW_AGENT_MAX_BUFFER_SIZE` all propagate their ignored status downstream to any other endpoints they may call. If that endpoint is running the Node Skywalking agent then regardless of its ignore settings it will not be recorded since its upstream parent was not recorded. This allows elimination of entire trees of endpoints you are not interested in as well as eliminating partial traces if a span in the chain is ignored but calls out to other endpopints which are recorded as children of ROOT instead of the actual parent.

## Supported Libraries

There are some built-in plugins that support automatic instrumentation of NodeJS libraries, the complete lists are as follows:

Library | Plugin Name
| :--- | :--- |
| built-in `http` and `https` module | `http` / `https` |
| [`Express`](https://expressjs.com) | `express` |
| [`Axios`](https://github.com/axios/axios) | `axios` |
| [`MySQL`](https://github.com/mysqljs/mysql) | `mysql` |
| [`MySQL`](https://github.com/sidorares/node-mysql2) | `mysql2` |
| [`PostgreSQL`](https://github.com/brianc/node-postgres) | `pg` |
| [`pg-cursor`](https://github.com/brianc/node-postgres) | `pg-cursor` |
| [`MongoDB`](https://github.com/mongodb/node-mongodb-native) | `mongodb` |
| [`Mongoose`](https://github.com/Automattic/mongoose) | `mongoose` |
| [`RabbitMQ`](https://github.com/squaremo/amqp.node) | `amqplib` |
| [`Redis`](https://github.com/luin/ioredis) | `ioredis` |

### Compatible Libraries

The following are packages that have been tested to some extent and are compatible because they work through the instrumentation of an underlying package:

Library | Underlying Plugin Name
| :--- | :--- |
| [`request`](https://github.com/request/request) | `http` / `https` |
| [`request-promise`](https://github.com/request/request-promise) | `http` / `https` |
| [`koa`](https://github.com/koajs/koa) | `http` / `https` |

## Experimental Azure Functions Support

The plugin `AzureHttpTriggerPlugin` provides a wrapper function for an Azure Functions Javascript HttpTrigger endpoint. This is an http server endpoint and it must be instrumented manually currently. So far all other plugins tested work within the HttpTrigger and so a trace can pass through the Function and on to other endpoints called by the function. How much sense it makes to instrument an Azure Function which already lives in the cloud and has robust monitoring incorporated is a good question, but at the least this plugin will allow those endpoints to show up in a Skywalking trace.

### Usage:

```javascript
const {default: agent, AzureHttpTriggerPlugin} = require('skywalking-backend-js');

agent.start({ ... });

module.exports = AzureHttpTriggerPlugin.wrap(async function (context, req) {

  /* contents of http trigger function */

});
```

All that needs to be done is the actual trigger function needs to be wrapped with `azureHttpTriggerPlugin.wrap()`, whether that function is a default export or an explicitly named `entryPoint` or `run` or `index`.

## Experimental AWS Lambda Functions Support

The plugins `AWSLambdaTriggerPlugin`, `AWSLambdaGatewayAPIHTTP` and `AWSLambdaGatewayAPIREST` provide a wrapper functions for AWS Lambda Functions endpoints. `AWSLambdaTriggerPlugin` is a generic wrapper plugin which should work with any kind of Lambda trigger but also stores the least amount of informations since it does not know anything about the incoming data format. For this reason this type of trigger also can not link back to the caller, but it can create a new segment which will be propagated to all downstream children, this starting its own trace. `AWSLambdaGatewayAPIHTTP` and `AWSLambdaGatewayAPIREST` are specific wrappers for Lambda functions triggered by the GatewayAPI HTTP or REST triggers. They have the advantage of knowing the incoming data format and can thus extract existing trace segment information from incoming requests and chain correctly from upstream to any downstream endpoints.

### Usage:

```javascript
const {default: agent, AWSLambdaGatewayAPIHTTP} = require('skywalking-backend-js');

agent.start({ ... });

exports.handler = AWSLambdaGatewayAPIHTTP.wrap(async function (event, context, callback) {

  /* contents of http trigger function */

});
```

This is similar to Azure Functions wrapping, just wrap your handler function with `AWSLambdaTriggerPlugin.wrap()` or `AWSLambdaGatewayAPIHTTP.wrap()` or `AWSLambdaGatewayAPIREST.wrap()`. One thing to note is that AWS freezes processes in between invocations of lambda functions so whether you are doing async or sync handler functions with callbacks, you should make sure everything you need to do finishes before returning control to AWS or calling the synchronous callback. These plugins take this into account and automatically flush the segment buffers before closing a trace span.

## Contact Us
* Submit [an issue](https://github.com/apache/skywalking/issues/new) by using [Nodejs] as title prefix.
* Mail list: **dev@skywalking.apache.org**. Mail to `dev-subscribe@skywalking.apache.org`, follow the reply to subscribe the mail list.
* Join `skywalking` channel at [Apache Slack](http://s.apache.org/slack-invite). If the link is not working, find the latest one at [Apache INFRA WIKI](https://cwiki.apache.org/confluence/display/INFRA/Slack+Guest+Invites).
* Twitter, [ASFSkyWalking](https://twitter.com/ASFSkyWalking)

## License
Apache 2.0
