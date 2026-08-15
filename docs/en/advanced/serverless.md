# Serverless

The package exports wrappers for AWS Lambda and Azure Functions HTTP triggers. These wrappers are
experimental and do not have dedicated current CI suites in this repository. Test them with the
runtime and event form used by your function.

## AWS Lambda

Choose the wrapper that matches the event:

| Export | Use |
| --- | --- |
| `AWSLambdaGatewayAPIHTTP` | API Gateway HTTP API payload version 2.0 |
| `AWSLambdaGatewayAPIREST` | API Gateway REST API payload version 1.0 |
| `AWSLambdaTriggerPlugin` | Other Lambda triggers |

The two API Gateway wrappers read incoming SkyWalking context and record the HTTP path, method,
URL, source address, and response status when those values are present. The generic wrapper starts
a Lambda span but cannot read HTTP context from an unknown event form.

```javascript
const {
  default: agent,
  AWSLambdaGatewayAPIHTTP,
} = require('skywalking-backend-js');

agent.start({
  serviceName: 'checkout-lambda',
  collectorAddress: 'oap.example.com:11800',
});

exports.handler = AWSLambdaGatewayAPIHTTP.wrap(async (event) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
});
```

The wrapper handles an async return value, the handler callback, and the older `context.done`,
`context.succeed`, and `context.fail` forms. It ends the span only once.

### Flush before Lambda freezes the process

AWS can freeze a process after the handler completes. `SW_AWS_LAMBDA_FLUSH` controls when the
wrapper calls `agent.flush()` before it returns:

- `0` — flush after every invocation.
- A positive number — flush when at least that many seconds passed between wrapped invocations.
  The first invocation also flushes. The default is `2`.
- `-1` — never flush in the wrapper.

A flush adds time to the invocation. Test the setting with your request rate and Lambda timeout.

### Link direct Lambda invokes

When one instrumented service calls a wrapped Lambda through AWS SDK v2, set
`SW_AWS_LAMBDA_CHAIN=true` on the caller. The caller adds trace context to the invoke payload, and
the generic wrapper reads and removes it before calling your handler.

This can change a non-object payload into a JSON object. Read [AWS SDK v2](../plugins/aws-sdk-v2.md)
before enabling it.

## Azure Functions HTTP trigger

Wrap a JavaScript HTTP trigger with `AzureHttpTriggerPlugin`:

```javascript
const {
  default: agent,
  AzureHttpTriggerPlugin,
} = require('skywalking-backend-js');

agent.start({
  serviceName: 'checkout-azure-function',
  collectorAddress: 'oap.example.com:11800',
});

module.exports = AzureHttpTriggerPlugin.wrap(async function (context, req) {
  return {
    status: 200,
    body: { ok: true },
  };
});
```

The wrapper reads incoming trace headers, records HTTP values, and supports Promise returns and
`context.done`. Make sure the agent starts before other instrumented modules used by the function.

## Limits

- These wrappers are for JavaScript handler functions. Other Azure or AWS host languages are not
  handled by this package.
- A platform timeout or forced process stop can still lose data before a flush completes.
- `SW_HTTP_IGNORE_METHOD` also applies to the API Gateway and Azure HTTP wrappers.
