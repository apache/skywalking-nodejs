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

# Generate throwaway CA / server / client material for the mTLS remote-e2e suite.
# Private keys are written under this directory and must never be committed
# (see .gitignore). Requires openssl and bash.

set -euo pipefail

# Git Bash / MSYS rewrites leading-/ arguments as Windows paths (breaks -subj /CN=...).
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# Stay in this directory and use relative paths — MinGW openssl can fail writing
# absolute /c/... paths on Windows Git Bash.
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p server client

cleanup() {
  rm -f server/ca.key server/ca.srl \
    server/server.csr server/server.srl \
    client/client.csr client/client.srl \
    server/server-san.ext client/client-san.ext
}
trap cleanup EXIT

# CA key + cert
openssl genrsa -out server/ca.key 2048
openssl req -new -x509 -days 3650 -key server/ca.key \
  -out server/ca.crt -subj "/CN=SkyWalking Test CA"

# Server key + cert signed by CA (SAN: oap + localhost + 127.0.0.1)
# Use a real extfile — process substitution (/dev/fd/N) breaks MinGW openssl on Windows.
printf 'subjectAltName=DNS:oap,DNS:localhost,IP:127.0.0.1\n' > server/server-san.ext
openssl genrsa -out server/server.pem 2048
openssl req -new -key server/server.pem \
  -out server/server.csr -subj "/CN=oap"
openssl x509 -req -in server/server.csr -days 3650 \
  -CA server/ca.crt -CAkey server/ca.key -CAcreateserial \
  -out server/server.crt \
  -extfile server/server-san.ext

# Client key + cert signed by CA (SAN: localhost + 127.0.0.1)
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > client/client-san.ext
openssl genrsa -out client/client.pem 2048
openssl req -new -key client/client.pem \
  -out client/client.csr -subj "/CN=nodejs-mtls-e2e"
openssl x509 -req -in client/client.csr -days 3650 \
  -CA server/ca.crt -CAkey server/ca.key -CAcreateserial \
  -out client/client.crt \
  -extfile client/client-san.ext

# Agent container trusts the same CA that signed OAP's server cert.
cp server/ca.crt client/ca.crt

# Drop intermediates and the CA private key (only leaf keys remain for the test).
# trap cleanup also removes these on exit.
cleanup
trap - EXIT

echo "mTLS e2e certificates written under $(pwd)/{server,client}/"
ls -la server/ client/
