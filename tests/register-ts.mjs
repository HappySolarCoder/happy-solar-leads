import { register } from 'node:module';

// Node's type-stripping loader does not add .ts for extensionless relative imports.
register(new URL('./resolve-ts-hook.mjs', import.meta.url));
