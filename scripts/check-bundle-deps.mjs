// Fails if a bundled app imports a package that isn't in its own dependencies
// (it would resolve in the dev workspace but not in production).
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

let failed = false;
for (const app of ['api', 'worker']) {
  const src = readFileSync(`apps/${app}/dist/index.js`, 'utf8');
  const deps = Object.keys(JSON.parse(readFileSync(`apps/${app}/package.json`, 'utf8')).dependencies ?? {});
  const imports = new Set(
    [...src.matchAll(/from "([^".][^"]*)"|import\("([^".][^"]*)"\)/g)]
      .map((m) => m[1] ?? m[2])
      .filter((s) => !s.startsWith('node:') && !builtinModules.includes(s))
      .map((s) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0])),
  );
  const missing = [...imports].filter((p) => !deps.includes(p));
  if (missing.length) {
    failed = true;
    console.error(`apps/${app}: add to dependencies: ${missing.join(', ')}`);
  }
}
if (failed) process.exit(1);
console.log('bundle dependencies ok');
