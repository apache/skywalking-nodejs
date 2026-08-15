# Webpack

Webpack needs module imports to be known at build time. The normal agent loader scans plugin files
and loads target modules at run time, so the agent uses a separate static loader when it detects a
bundle.

Webpack support is experimental.

## Plugins in the static loader

The current static loader includes:

- Node.js HTTP and HTTPS
- Express
- MySQL
- PostgreSQL
- MongoDB and Mongoose
- ioredis
- amqplib
- AWS SDK v2 DynamoDB, Lambda, SNS, and SQS

Axios and MySQL2 are not in the static loader because their package metadata cannot be loaded in
the form expected by the current code. They can be instrumented by the normal loader but not by
the current Webpack loader.

## Missing optional modules at build time

The static loader contains imports for all modules in the list above. Webpack may report a missing
module even when your application does not use that plugin. Mark each unused optional module as
`false` in `resolve.alias`.

```javascript
module.exports = {
  target: 'node',
  resolve: {
    alias: {
      amqplib: false,
      'aws-sdk': false,
      express: false,
      ioredis: false,
      mongodb: false,
      mongoose: false,
      mysql: false,
      pg: false,
    },
  },
};
```

Keep a module out of this list when your bundle uses it and you want its plugin installed.

## Disable a bundled plugin

The bundled loader currently checks its internal plugin file name, including `Plugin`. For
example:

```bash
export SW_AGENT_DISABLE_PLUGINS='MySQLPlugin,ExpressPlugin'
```

This differs from the normal loader, which uses `mysql,express`. Keep the value with the deployment
that needs it.

## Limits

- Only plugins listed in the static loader can work in a bundle.
- The loader reads a target module's `package.json` to check its version. A package that blocks this
  import cannot use the current static loader.
- A plugin contributor must add a new plugin to both the normal plugin directory and the static
  loader when Webpack support is possible.
- Tree shaking and other bundler changes can affect module patching. Test the final production
  bundle, not only the source application.

If bundling is not required, run the normal Node.js output and use the normal plugin loader.
