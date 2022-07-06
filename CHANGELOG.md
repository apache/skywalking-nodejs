# 0.5.0
- Bump up grpc-node to 1.6.7 to fix CVE-2022-25878 (#85)
- Fix issue #9165 express router entry duplicated (#84)
- Fix skywalking s3 upload error #8824 (#82)
- Improved ignore path regex (#81)
- Upgrade data collect protocol (#78)
- Fix wrong instance properties (#77)
- Fix wrong command in release doc (#76)

# 0.4.0

- Fix mysql2 plugin install error. (#74)
- Update IORedis Plugin, fill `dbinstance` tag as host if `condition.select` doesn't exist. (#73)
- Experimental AWS Lambda Function support. (#70)
- Upgrade dependencies to fix vulnerabilities. (#68)
- Add lint pre-commit hook and migrate to eslint. (#66, #67)
- Bump up gRPC version, and use its new release repository. (#65)
- Regard `baseURL` when in Axios Plugin. (#63)
- Add an API to access the trace id. (#60)
- Use agent test tool snapshot Docker image instead of building in CI. (#59)
- Wrapped IORedisPlugin call in try/catch. (#58)

# 0.3.0

- Add ioredis plugin. (#53)
- Endpoint cold start detection and marking. (#52)
- Add mysql2 plugin. (#54)
- Add AzureHttpTriggerPlugin. (#51)
- Add Node 15 into test matrix. (#45)
- Segment reference and reporting overhaul. (#50)
- Add http ignore by method. (#49)
- Add secure connection option. (#48)
- BugFix: wrong context during many async spans. (#46)
- Add Node Mongoose Plugin. (#44)

# 0.2.0

- Add AMQPLib plugin (RabbitMQ). (#34)
- Add MongoDB plugin. (#33)
- Add PgPlugin - PosgreSQL. (#31)
- Add MySQLPlugin to plugins. (#30)
- Add http protocol of host to http plugins. (#28)
- Add tag `http.method` to plugins. (#26)
- Bugfix: child spans created on immediate `cb` from op. (#41)
- Bugfix: async and preparing child entry/exit. (#36)
- Bugfix: tsc error of dist lib. (#24)
- Bugfix: AxiosPlugin async() / resync(). (#21)
- Bugfix: some requests of express / axios are not close correctly. (#20)
- Express plugin uses http wrap explicitly if http plugin disabled. (#42)

# 0.1.0

- Initialize project core codes.
- Built-in http/https plugin.
- Express plugin.
- Axios plugin.
