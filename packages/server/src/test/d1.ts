import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env';

/*
 * A stand-in for D1 over node:sqlite (D1 is SQLite too), covering what the server uses:
 * prepare, bind, first, all, run and batch (in one transaction, like D1's). The schema
 * comes from migrations/, as `wrangler d1 migrations apply` would build it.
 */

type Value = null | number | string;

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: Value[] = [],
  ) {}

  bind(...params: Value[]) {
    return new Statement(this.db, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>() {
    return { success: true, results: this.rows() as T[], meta: { changes: 0 } };
  }

  async run() {
    return this.exec();
  }

  rows() {
    return this.db.prepare(this.sql).all(...this.params);
  }

  exec() {
    if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(this.sql))
      return { success: true, results: this.rows(), meta: { changes: 0 } };
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes) } };
  }
}

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export function createTestDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(MIGRATIONS).sort()) {
    db.exec(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (stmts: Statement[]) => {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.exec());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return d1 as unknown as D1Database;
}

export function testEnv(): Env {
  return { DB: createTestDb() };
}
