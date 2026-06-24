# Compiling and Building

We build skywalking-nodejs with NodeJS 20 (the current LTS baseline; CI tests Node 20, 22, and 24).
If you don't have a suitable NodeJS installed, use a version manager such as
[nvm](https://github.com/nvm-sh/nvm) to manage multiple node versions, or build inside a Docker
container:

```shell
# Suppose you have the source codes in folder skywalking-nodejs
docker run -it --rm -v $(pwd)/skywalking-nodejs:/workspace -w /workspace node:20 bash
```

The gRPC / protobuf definitions live in the `protocol/` git submodule, so initialize it first (or
clone the repository with `--recurse-submodules`). Then install dependencies — the `prepare` hook
generates the protobuf stubs into `src/proto/` — and compile:

```shell
git submodule update --init --recursive
npm install
npm run build
```

`npm run build` compiles the TypeScript sources into `lib/`. Other useful commands:

```shell
npm run lint     # ESLint: code style + Apache license headers
npm run test     # plugin tests (require Docker)
```

Warnings can be ignored, but if an error prevents you from continuing, try `rm -rf node_modules/`
and rerun the commands above.
