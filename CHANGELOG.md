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
