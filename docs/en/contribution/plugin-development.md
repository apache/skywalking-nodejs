# Plugin development

A plugin patches a Node.js library so calls made by that library create SkyWalking spans. Read an
existing plugin close to your target library before adding a new one.

## Plugin contract

Each automatic plugin in `src/plugins/` implements `SwPlugin` and exports one default instance:

```typescript
class ExamplePlugin implements SwPlugin {
  readonly module = 'example-library';
  readonly versions = '^1.0.0';

  install(installer: PluginInstaller): void {
    const target = installer.require?.(this.module) ?? require(this.module);
    // Patch the target API.
  }
}

export default new ExamplePlugin();
```

Use a file name ending in `Plugin.ts`. The normal loader scans compiled files in `lib/plugins/`.

- `module` is the npm module that must be installed in the application.
- `versions` is a semantic version range checked by the loader.
- Set `isBuiltIn = true` only for a Node.js built-in module such as `http`.
- Use `installer.require` when possible so the plugin loads the application's copy of the module.

Choose a version range from real API support. Do not use `*` only to avoid checking versions.

## Instrumentation rules

Keep library behavior unchanged apart from trace collection:

1. Save the original function before replacing it.
2. Preserve `this`, arguments, return values, thrown errors, callbacks, events, and Promise results.
3. Create the correct entry, exit, or local span from `ContextManager.current`.
4. Set the component, span layer, operation name, peer, and standard tags when the data exists.
5. Record errors and stop every span on all completion paths.
6. Use `span.async()` and `span.resync()` when work leaves and later returns to the active async
   path.
7. Do not record request bodies, database parameters, or other private values by default.

`src/core/SwPlugin.ts` provides helpers for common callback, Promise, and event-emitter completion
forms. Some libraries need a local helper because their API has different completion rules.

Use an existing component in `src/trace/Component.ts` when it matches. A new component ID must be
agreed with the SkyWalking project so it does not conflict with another agent or integration.

## Add tests

Create `tests/plugins/<module>/` by following a similar plugin suite. A normal suite contains:

- `test.ts` to start Docker Compose and send expected data to the mock collector;
- `docker-compose.yml` for the collector, application, and target service;
- client and server files that exercise the instrumented API;
- `expected.data.yaml` with the expected SkyWalking segment data.

Add the target package to `devDependencies` and update `package-lock.json` when the test needs it.
The CI plugin matrix finds each directory under `tests/plugins/` except `common`, so a new directory
becomes a CI job without a manual matrix entry.

Run the suite:

```bash
npm run test tests/plugins/example-library/
```

Also run lint and build as described in [Build and test](build-and-test.md).

## Webpack support

The normal loader finds a compiled plugin automatically. The Webpack loader does not. If the target
package allows its `package.json` to be imported, add the plugin to
`PluginInstaller.installBundled()` and test a production bundle.

If this is not possible, state the limit in [Webpack](../advanced/webpack.md). Do not claim Webpack
support based only on the normal plugin test.

## Update documentation

For a new plugin:

1. Add the library and current CI state to [Supported libraries](../plugins/supported-libraries.md).
2. Add configuration details if the plugin adds settings.
3. Add important behavior changes, such as changed batching or payload data.
4. Update troubleshooting when the plugin has a common setup limit.
