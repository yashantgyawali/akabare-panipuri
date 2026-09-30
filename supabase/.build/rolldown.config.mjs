// Bundles the `game` edge function into one type-stripped ESM file for MCP deploys.
export default {
  input: 'supabase/functions/game/index.ts',
  external: [/^npm:/, /^jsr:/],
  platform: 'neutral',
  output: { file: 'supabase/.build/game/index.js', format: 'esm', comments: { legal: false, annotation: false, jsdoc: false } },
};
