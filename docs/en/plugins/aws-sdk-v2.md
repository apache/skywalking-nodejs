# AWS SDK for JavaScript v2

The agent instruments selected services in the `aws-sdk` 2.x package. AWS SDK for JavaScript v3
uses different packages and is not instrumented by these plugins.

Start the agent before loading `aws-sdk`:

```javascript
const agent = require('skywalking-backend-js').default;

agent.start();

const AWS = require('aws-sdk');
```

The plugins support normal AWS SDK v2 callbacks, request `.send(callback)`, and request
`.promise()` use.

## DynamoDB DocumentClient

The DynamoDB plugin instruments these `AWS.DynamoDB.DocumentClient` methods:

- `batchGet` and `batchWrite`
- `delete`, `get`, `put`, and `update`
- `query` and `scan`
- `transactGet` and `transactWrite`

It creates database spans with operation names such as `AWS/DynamoDB/put`.

## Lambda invoke

The Lambda plugin instruments `AWS.Lambda.invoke`. It does not trace requests whose
`InvocationType` is `DryRun`.

Set `SW_AWS_LAMBDA_CHAIN=true` to add SkyWalking trace context to the invoke payload. The plugin may
change a string or buffer payload into a JSON object so it can add the context. Enable this only
when the called Lambda uses a SkyWalking Lambda wrapper and accepts this payload form.

```bash
export SW_AWS_LAMBDA_CHAIN=true
```

The wrapper removes the internal context before it calls your handler. See
[Serverless](../advanced/serverless.md).

## SNS

The SNS plugin instruments `publish` and `publishBatch`. For a publish to `TopicArn`, it adds an
internal `__revdTraceId` message attribute. The SQS plugin can use that attribute to link an SNS to
SQS message path.

The plugin does not add trace context when the SNS destination is only `TargetArn` or
`PhoneNumber`.

## SQS

The SQS plugin instruments:

- `sendMessage`
- `sendMessageBatch`
- `receiveMessage`

Send operations add an internal `__revdTraceId` message attribute. Receive operations ask SQS for
that attribute, use it as parent trace context, and remove the internal attribute before returning
the message when possible.

The receive plugin removes `MaxNumberOfMessages` from the request. This makes SQS return at most one
message so the agent can link one received message to one entry span. This changes batch receive
behavior and can reduce receive throughput. Do not use this plugin when your application requires
multi-message receives.

When SNS wraps message attributes inside the SQS body, set this option to also check the body:

```bash
export SW_AWS_SQS_CHECK_BODY=true
```

## Disable one AWS plugin

The four normal-loader disable values are:

```text
AWS2DynamoDB
AWS2Lambda
AWS2SNS
AWS2SQS
```

For example:

```bash
export SW_AGENT_DISABLE_PLUGINS='AWS2SQS'
```

AWS SDK plugins do not have a dedicated current CI suite in this repository. Test their behavior
with the exact AWS SDK v2 version and call form used by your service.
