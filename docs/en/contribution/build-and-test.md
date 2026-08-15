# Build and test

This guide is for contributors building the Node.js Agent from source.

## Requirements

- Node.js 20 or later. Node.js 20 is the minimum version, and CI runs on Node.js 20, 22, and 24.
- Git.
- Docker for plugin integration tests and the built-package test.

## Get the source

The SkyWalking protocol definitions are a Git submodule. Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/apache/skywalking-nodejs.git
cd skywalking-nodejs
```

If you already cloned the repository:

```bash
git submodule update --init --recursive
```

## Install and build

```bash
npm install
npm run build
```

The `prepare` step generates TypeScript sources from the protocol definitions. The build compiles
the agent into `lib/`. Do not edit generated files in `src/proto/` by hand.

## Run checks

Run the TypeScript lint check:

```bash
npm run lint
```

Run all tests. Every suite in this release is a Docker plugin suite:

```bash
npm run test
```

Run one plugin suite:

```bash
npm run test tests/plugins/http/
```

Plugin tests start a mock SkyWalking collector and target services with Docker Compose. Make sure
Docker is running and that the test ports are free.

Test the built package in a container:

```bash
docker build . -f tests/build/Dockerfile -t skywalking-nodejs:test
docker run --rm skywalking-nodejs:test
```

## Main source areas

| Path | Content |
| --- | --- |
| `src/index.ts` | Public agent start, flush, stop, and wrapper exports |
| `src/config/` | Configuration and environment parsing |
| `src/core/` | Plugin loader and plugin helpers |
| `src/plugins/` | Automatic library instrumentation |
| `src/agent/protocol/grpc/` | Trace reporting, heartbeat, and gRPC clients |
| `src/trace/` | Trace context, spans, segments, and component IDs |
| `src/aws/`, `src/azure/` | Serverless wrappers and AWS helpers |
| `tests/plugins/` | Docker-based plugin integration tests |
| `tests/build/` | Built-package test image |

## Before opening a pull request

1. Add or update tests for the change.
2. Run `npm run lint` and `npm run build`.
3. Run the related plugin tests.
4. Update the user documentation when behavior or configuration changes.
5. Keep Apache license headers on new source and configuration files.

CI repeats the build, lint, plugin, and built-package checks that apply to the change.
