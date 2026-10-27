// The few Node APIs the tests' D1 stand-in uses. The server is typed for Workers, so
// @types/node (whose globals clash with workers-types) isn't installed.

declare module 'node:sqlite' {
  type Value = null | number | bigint | string | Uint8Array;
  export class StatementSync {
    all(...params: Value[]): Record<string, Value>[];
    get(...params: Value[]): Record<string, Value> | undefined;
    run(...params: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}

declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function readdirSync(path: URL): string[];
}

// Vitest runs the tests as Node modules, which have import.meta.url.
interface ImportMeta {
  readonly url: string;
}
