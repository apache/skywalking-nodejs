---
name: compile
description: >-
  Compile / build / type-check the skywalking-nodejs agent. Use when asked to "compile", "build",
  "type-check", "run tsc", "make sure it compiles", or to validate that changes under src/ build cleanly.
  Mirrors the CI pipeline in .github/workflows/build.yaml (npm i -> npm run lint -> npm run build) and
  handles the two things that trip up a fresh/Apple-Silicon checkout: the protobuf submodule and the
  grpc-tools native-binary download.
---

# Compile skywalking-nodejs

The source is TypeScript compiled by `tsc`, but it imports generated gRPC/protobuf stubs. So a build is
three stages: **fetch the proto definitions -> generate the stubs -> compile**.

## What the build does (source of truth: package.json + .github/workflows/build.yaml)

```
npm i            # install deps; the `prepare` hook runs scripts/protoc.sh -> generates src/proto/
npm run lint     # eslint src/**/*.ts  (eslint:recommended + prettier + Apache license-header check)
npm run build    # clean -> prepare (regen src/proto) -> tsc --build src -> regen proto into lib/
```

`npm run build` expands to:
`npm run clean && npm run prepare && tsc --build src && OUT_DIR=lib/proto/ scripts/protoc.sh`
Output lands in `lib/`. CI runs this on Node 12/14/16/18 (Node 18 is the highest; Node 10 skips lint).

`scripts/protoc.sh` invokes `node_modules/.bin/grpc_tools_node_protoc` (from **grpc-tools**) and the
`protoc-gen-ts` plugin (from **grpc_tools_node_protoc_ts**) over `protocol/**/*.proto`.

## Prerequisite for every path: the protobuf submodule

`protocol/` is a git submodule (apache/skywalking-data-collect-protocol). A fresh clone leaves it empty,
and then `tsc` fails with a cascade of `Cannot find module '../proto/...'`. Initialize it first:

```bash
git submodule update --init --recursive
find protocol -name '*.proto' | head      # sanity check: should list files
```

## Path A — Linux / Intel macOS (the simple case)

```bash
git submodule update --init --recursive
npm i
npm run lint
npm run build
```

## Path B — Apple Silicon (arm64), old checkouts pinning grpc-tools 1.11.x

Current `master` depends on `grpc-tools@^1.13.1`, which **does** ship a darwin-arm64 binary — so Path A
(`npm i`) works natively on Apple Silicon, no workaround needed. Use the steps below only on an **older
checkout** whose lockfile still pins `grpc-tools@1.11.2` (no arm64 prebuilt → `npm i` dies with
`404 ... grpc-tools/v1.11.2/darwin-arm64.tar.gz`). It installs deps without the broken postinstall, then
swaps in a 1.13.x binary that produces compatible stubs:

```bash
git submodule update --init --recursive

# 1. Install everything EXCEPT the failing grpc-tools postinstall:
npm i --ignore-scripts

# 2. Get a grpc-tools build that has an arm64 binary (1.13.x), in a scratch dir:
( cd /tmp && rm -rf gtt && mkdir gtt && cd gtt && npm i grpc-tools@latest )

# 3. Replace the binary-less grpc-tools with the working one (bin links stay valid):
rm -rf node_modules/grpc-tools && cp -R /tmp/gtt/node_modules/grpc-tools node_modules/grpc-tools

# 4. Sanity-check the toolchain, then build:
node_modules/.bin/grpc_tools_node_protoc --version    # -> libprotoc 3.19.1
npm run lint
npm run build
```

This was run end-to-end on darwin-arm64 (Node available locally, `tsc 3.9.10`): proto stubs generated,
`tsc --build src` exit 0, `eslint` exit 0, `lib/` populated.

Note: `--ignore-scripts` also skips the `prepare`/`husky` hooks, which is why step 4 runs the build
explicitly. The swapped `node_modules` is fine for building; it is not arch-portable to other machines.

## Path C — Docker (mirrors CI exactly; needs Docker Hub access)

Best for reproducibility when the host toolchain is uncooperative, but it requires pulling `node:18`
(this environment could not reach Docker Hub — registry `EOF` — so Path B was used instead):

```bash
git submodule update --init --recursive
docker run --rm --platform linux/amd64 -v "$PWD":/app -w /app node:18 bash -lc '
  npm i && npm run lint && npm run build
'
```

`--platform linux/amd64` is required on Apple Silicon so grpc-tools downloads its linux-x64 prebuilt; it
runs under emulation, so the first `npm i` is slow — use a long timeout. Afterward `rm -rf node_modules`
to drop the Linux binaries before any host use.

## Verifying success

- `tsc --build src` exits 0 (it is **silent** on success); `lib/` is populated, e.g.
  `lib/agent/protocol/grpc/clients/TraceReportClient.js`.
- A type error appears as a non-zero exit with a `src/....ts(line,col): error TS....` message.
- Lint failures are usually Prettier (`.prettierrc`: printWidth 120, singleQuote, trailingComma all) or a
  missing Apache header (`.file-headerrc`). Auto-fix formatting with `npm run format`.
- Type-check only (skip lint + lib emit), after deps + stubs exist: `node_modules/.bin/tsc --build src`.

## Gotchas

- Empty `protocol/` -> "Cannot find module '../proto/...'" everywhere -> you skipped the submodule.
- Native arm64 `npm i` dies in `grpc-tools` postinstall (404) -> use Path B (swap to grpc-tools 1.13.x).
- `npx tsc` with no `node_modules` silently installs an unrelated deprecated package literally named `tsc`
  (`tsc@2.0.4`) — that is NOT the TypeScript compiler. Install deps first, then use `node_modules/.bin/tsc`.
