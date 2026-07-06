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
set -euo pipefail
AIP="$(getent hosts collector-a | awk '{print $1; exit}')"
BIP="$(getent hosts collector-b | awk '{print $1; exit}')"
if [[ -z "${AIP}" || -z "${BIP}" ]]; then
  echo "collector-a/collector-b IP not found for oap.test bootstrap" >&2
  exit 1
fi
grep -v '[[:space:]]oap\.test' /etc/hosts > /tmp/hosts.oap || cp /etc/hosts /tmp/hosts.oap
# Two A records for oap.test — Java expandBackendAddresses / getAllByName multi-IP parity.
echo "${AIP} oap.test" >> /tmp/hosts.oap
echo "${BIP} oap.test" >> /tmp/hosts.oap
cat /tmp/hosts.oap > /etc/hosts
exec npx ts-node /app/tests/remote-e2e/common/server.ts
