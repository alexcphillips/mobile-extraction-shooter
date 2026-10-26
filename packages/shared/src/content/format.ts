import { z } from 'zod';

/** Upgrades a document from one format version to the next. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * A kind of content file: its current version, its schema, and the migrations that
 * upgrade older files. migrations[v] turns version v into v + 1.
 */
export interface ContentFormat<T> {
  kind: string;
  version: number;
  schema: z.ZodType<T>;
  migrations: Readonly<Record<number, Migration>>;
}

export class ContentError extends Error {
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = 'ContentError';
  }
}

/**
 * Checks a parsed JSON document's formatVersion, runs the migrations up to the current
 * version, then validates it. source names the file in error messages.
 */
export function loadContent<T>(format: ContentFormat<T>, raw: unknown, source: string): T {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new ContentError(source, `a ${format.kind} must be a JSON object`);
  let doc = raw as Record<string, unknown>;
  const version = doc.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new ContentError(source, 'formatVersion must be a positive integer');
  if (version > format.version) {
    throw new ContentError(
      source,
      `${format.kind} format ${version} is newer than this build supports (${format.version})`,
    );
  }
  for (let v = version; v < format.version; v++) {
    const migrate = format.migrations[v];
    if (!migrate) throw new ContentError(source, `no migration from ${format.kind} format ${v}`);
    doc = { ...migrate(doc), formatVersion: v + 1 };
  }
  const result = format.schema.safeParse(doc);
  if (!result.success) throw new ContentError(source, `\n${z.prettifyError(result.error)}`);
  return result.data;
}
