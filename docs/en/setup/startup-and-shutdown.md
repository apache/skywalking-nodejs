# Start and stop the agent

## Start before application modules

`agent.start()` installs module patches. Call it before loading any module that must be
instrumented.

```javascript
const agent = require('skywalking-backend-js').default;

agent.start();

const express = require('express');
const axios = require('axios');
```

Some forms of early module loading cannot be patched later. For example, a function copied from
Node.js `http` before agent startup may keep the original function.

You can also use the preload entry:

```bash
node --require skywalking-backend-js/lib/egg app.js
```

Set its configuration through environment variables.

## Repeated calls to `start()`

The first successful `start()` call starts the agent. Later calls are ignored, and their options
are not applied.

Set `SW_DISABLE=true` to make `start()` return without starting the agent. The value must be the
lowercase text `true`.

## Flush pending data

`agent.flush()` waits for active spans to finish and asks the trace and meter reporters to send
their current data.

```typescript
await agent.flush();
```

It returns `null` when the agent is not started. A flush is useful before a short-lived process
exits. Normal long-running services do not need to call it for every request.

## Stop the agent

`agent.destroy()` stops the reporting services and timers.

```typescript
await agent.flush();
agent.destroy();
```

`destroy()` does not call `flush()` for you. Flush first when pending data is important.

Do not use repeated `destroy()` and `start()` calls as a normal restart method. Library patches
remain in the process after the reporting services stop. Start one agent for the life of a normal
service process.
