import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { BaseStore, type Item, type Operation, type OperationResults, type SearchItem } from "@langchain/langgraph-checkpoint";

type Row = { namespace: string; key: string; value: string; created_at: string; updated_at: string };

/** Namespaces are stored joined by a separator that the workflow never puts inside a namespace label. */
const separator = "\u001f";

function encode(namespace: readonly string[]): string {
  for (const label of namespace) {
    if (label.length === 0 || label.includes(separator)) throw new Error(`Invalid namespace label '${label}'.`);
  }
  return namespace.join(separator);
}

function toItem(row: Row): Item {
  return {
    namespace: row.namespace.split(separator), key: row.key, value: JSON.parse(row.value) as Record<string, unknown>,
    createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
  };
}

/**
 * A LangGraph store over SQLite for long-lived workflow knowledge. It supports get, put (and delete with a null
 * value) and namespace-prefix search with limit and offset; filters, semantic queries and namespace listing are
 * not supported and throw.
 */
export class SqliteStore extends BaseStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    super();
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS items (
      namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (namespace, key))`);
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results = this.db.transaction(() => operations.map((operation) => this.apply(operation)))();
    return results as OperationResults<Op>;
  }

  private apply(operation: Operation): Item | null | SearchItem[] | void {
    if ("namespacePrefix" in operation) {
      if (operation.filter !== undefined || operation.query !== undefined) {
        throw new Error("SqliteStore supports prefix search only, without filters or queries.");
      }
      const prefix = encode(operation.namespacePrefix);
      const rows = this.db.prepare(`SELECT * FROM items WHERE namespace = ? OR substr(namespace, 1, ?) = ?
        ORDER BY namespace, key LIMIT ? OFFSET ?`)
        .all(prefix, prefix.length + 1, prefix + separator, operation.limit ?? 10, operation.offset ?? 0) as Row[];
      return rows.map(toItem);
    }
    if ("value" in operation) {
      const namespace = encode(operation.namespace);
      if (operation.value === null) {
        this.db.prepare("DELETE FROM items WHERE namespace = ? AND key = ?").run(namespace, operation.key);
        return;
      }
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO items (namespace, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(namespace, operation.key, JSON.stringify(operation.value), now, now);
      return;
    }
    if ("key" in operation) {
      const row = this.db.prepare("SELECT * FROM items WHERE namespace = ? AND key = ?").get(encode(operation.namespace), operation.key) as Row | undefined;
      return row === undefined ? null : toItem(row);
    }
    throw new Error("SqliteStore does not support listing namespaces.");
  }

  close(): void {
    this.db.close();
  }
}
