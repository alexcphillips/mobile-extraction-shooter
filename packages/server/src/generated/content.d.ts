// Types for content.js, which scripts/bundle-content.mjs writes (it's gitignored):
// every bundled content file's parsed JSON, by its path from the repo root.
declare const files: Record<string, unknown>;
export default files;
