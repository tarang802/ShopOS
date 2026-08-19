import { defineConfig } from 'tsup';

/**
 * We bundle the API with tsup (esbuild) rather than emitting with tsc.
 *
 * WHY: @shopos/shared is consumed as TypeScript source so the web app gets
 * instant hot reload on shared changes. A bundler compiles that source into the
 * server output without any of the path-alias or file-extension rewriting that
 * plain tsc would require. Type safety is unaffected - `npm run typecheck` still
 * runs the real compiler over everything.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Runtime dependencies stay external so node_modules is used at runtime;
  // only our own workspace source is bundled in.
  noExternal: ['@shopos/shared'],
});
