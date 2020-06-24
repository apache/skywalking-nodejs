#!/usr/bin/env bash
#
# Licensed to the Apache Software Foundation (ASF) under one or more
# contributor license agreements.  See the NOTICE file distributed with
# this work for additional information regarding copyright ownership.
# The ASF licenses this file to You under the Apache License, Version 2.0
# (the "License"); you may not use this file except in compliance with
# the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

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

