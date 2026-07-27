import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import shared from "@tuomashatakka/eslint-config";

// The shared config carries the house style + @eslint-react rules; the Next
// preset sits on top for the framework-specific checks (no <img>, no sync
// scripts, app-router constraints) that only apply in this repo.
//
// Both presets register an `import` plugin, and flat config refuses to let the
// same plugin name be defined twice ("Cannot redefine plugin"). The shared
// config wins that key, so drop it from Next's blocks — its own rules are
// namespaced under `@next/next` and are unaffected.
const nextWithoutImportPlugin = next.map(config => {
    if (!config.plugins?.import)
        return config;
    const { import: _dropped, ...plugins } = config.plugins;
    return { ...config, plugins };
});

export default defineConfig([
    ...shared,
    ...nextWithoutImportPlugin,
]);
