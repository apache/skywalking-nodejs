#!/usr/bin/env bash

set -x

ROOT_DIR="$(dirname "$0")"/..

(rm -rf src/proto || true) && (mkdir -p src/proto || true) && (rm -rf src/proto || true) && (mkdir -p src/proto || true)

cd "${ROOT_DIR}"/protocol || exit

PROTOC_GEN_TS_PATH="../${ROOT_DIR}/node_modules/.bin/protoc-gen-ts"
PROTOC_PLUGIN="../${ROOT_DIR}/node_modules/.bin/grpc_tools_node_protoc_plugin"
PROTOC="../${ROOT_DIR}/node_modules/.bin/grpc_tools_node_protoc"

${PROTOC} \
    --js_out=import_style=commonjs,binary:../src/proto/ \
    --grpc_out=../src/proto/ \
    --plugin=protoc-gen-grpc="${PROTOC_PLUGIN}" \
      **/*.proto

${PROTOC} \
    --plugin=protoc-gen-ts="${PROTOC_GEN_TS_PATH}" \
    --ts_out=../src/proto/ \
      **/*.proto

