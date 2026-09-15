# Real OAP mTLS remote e2e

End-to-end coverage of Agent → OAP gRPC over mutual TLS against a real OAP +
BanyanDB stack (see `docker-compose.yml`).

## Prerequisites

- Docker
- Node.js (same majors as CI: 20 / 22 / 24)
- `openssl` and `bash` (Git Bash or WSL on Windows)

## Generate certificates

Private keys are not committed. Generate them before running the suite:

```bash
bash tests/remote-e2e/mtls/generate-certs.sh
```

This writes `server/server.pem`, `client/client.pem`, and refreshes the CA /
leaf certificates under `server/` and `client/`. Those `.pem` files are gitignored.

## Run

```bash
npm run test tests/remote-e2e/mtls/
```

CI runs the same `generate-certs.sh` step before the Jest suite.
