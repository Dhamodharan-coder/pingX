import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node20',
  clean: true,
  // Bundle workspace source only. Third-party packages stay external, so every package a bundled
  // @pingx/* module imports must also be a dependency of this app.
  noExternal: [/^@pingx\//],
  external: [/^(?!@pingx\/)[^./]/],
});
