# Node.js Agent — gRPC / TLS Operational Constraints

The gRPC-related remote layer is modeled on the **mature Java agent gRPC architecture** in `apm-sniffer/apm-agent-core` (channel lifecycle, TLS/mTLS, trace and meter reporting, command handling). Configuration names and outward behavior target **Java parity** wherever grpc-js permits; remaining Node-specific gaps are listed below.

Operational constraints for Node.js behaviors that differ from Java (or need grpc-js-specific rules). Env var names and defaults: [README](../README.md#set-up-nodejs-agent).

---

## TLS and collector address

### Background

When TLS is enabled and DNS resolves a hostname to Pod IPs, grpc-js connects to **`10.x.x.x:11800`** but the OAP certificate is issued for **`skywalking-oap.example.svc`**. The agent sets grpc-js **`grpc.ssl_target_name_override`** using **`BackendTarget.tlsServerName`** from DNS expansion (one SNI per configured hostname entry).

### Behavior

| Deployment | `SW_AGENT_COLLECTOR_BACKEND_SERVICES` |
| :--- | :--- |
| Kubernetes Headless Service | Single DNS name, e.g. `skywalking-oap.skywalking.svc:11800` |
| Multiple OAP clusters (different certs) | Comma-separated hostnames — each gets its own SNI when resolved |
| Static IP failover | Comma-separated **`IP:port`** only |

If two hostnames resolve to the **same** IP with **different** SNI names during DNS expansion, the agent logs a warning and keeps the **first** hostname's SNI for that target.

**Code reference:** `expandBackendAddresses`, `BackendTarget.tlsServerName`, `TLSChannelBuilder`.
