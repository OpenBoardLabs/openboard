import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic, BindParams } from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openboardDir = path.join(os.homedir(), '.openboard');
if (!fs.existsSync(openboardDir)) {
  fs.mkdirSync(openboardDir, { recursive: true });
}
const DB_PATH = path.join(openboardDir, 'openboard.db');
console.log("[db] DB_PATH", DB_PATH);

// Migrate old database if it exists
const oldDbPath = path.join(__dirname, '..', '..', '..', 'openboard.db');
if (fs.existsSync(oldDbPath) && !fs.existsSync(DB_PATH)) {
  fs.copyFileSync(oldDbPath, DB_PATH);
}
// Resolve sql.js WASM dynamically — handles npm workspace node_modules hoisting
const require = createRequire(import.meta.url);
const sqlJsDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm'));
const WASM_PATH = path.join(sqlJsDir, 'sql-wasm.wasm');


let db: SqlJsDatabase;

// ---------------------------------------------------------------------------
// Thin compatibility layer so repositories look identical to better-sqlite3
// ---------------------------------------------------------------------------
interface Statement {
  all: (...params: unknown[]) => Record<string, unknown>[];
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  run: (...params: unknown[]) => void;
}

let inTransaction = false;

function makeStatement(sql: string): Statement {
  return {
    all(...params: unknown[]) {
      const results = db.exec(sql, params.length ? (params as BindParams) : undefined);
      if (!results.length || !results[0].values.length) return [];
      const { columns, values } = results[0];
      return values.map(row =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]]))
      ) as Record<string, unknown>[];
    },
    get(...params: unknown[]) {
      return this.all(...params)[0];
    },
    run(...params: unknown[]) {
      db.run(sql, params.length ? (params as BindParams) : undefined);
      // Don't persist mid-transaction — sql.js auto-commits on db.export(),
      // which would invalidate the open transaction and cause COMMIT/ROLLBACK to fail.
      if (!inTransaction) persist();
    },
  };
}

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ---------------------------------------------------------------------------
// Transaction helper (sql.js has no WAL, runs synchronously anyway)
// ---------------------------------------------------------------------------
function transaction(fn: () => void): () => void {
  return () => {
    inTransaction = true;
    db.run('BEGIN');
    try {
      fn();
      db.run('COMMIT');
      inTransaction = false;
      persist(); // single persist after the full transaction commits
    } catch (e) {
      db.run('ROLLBACK');
      inTransaction = false;
      throw e;
    }
  };
}

// ---------------------------------------------------------------------------
// Public DB handle (mimics better-sqlite3 surface used by repositories)
// ---------------------------------------------------------------------------
export interface Db {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => void;
  transaction: (fn: () => void) => () => void;
}

let dbHandle: Db;

export async function initDb(): Promise<Db> {
  if (dbHandle) return dbHandle;

  const wasmFile = fs.readFileSync(WASM_PATH);
  const wasmBinary = wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength);
  const SQL: SqlJsStatic = await initSqlJs({ wasmBinary });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength));
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');
  runMigrations();

  dbHandle = {
    prepare: makeStatement,
    exec: (sql) => { db.exec(sql); persist(); },
    transaction,
  };

  return dbHandle;
}

export function getDb(): Db {
  if (!dbHandle) throw new Error('DB not initialized. Call initDb() first.');
  return dbHandle;
}

function runMigrations() {
  db.run(`
    CREATE TABLE IF NOT EXISTS boards (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      path       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS board_workspaces (
      id         TEXT PRIMARY KEY,
      board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      type       TEXT NOT NULL, -- 'folder' or 'git'
      path       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS columns (
      id         TEXT PRIMARY KEY,
      board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id          TEXT PRIMARY KEY,
      column_id   TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority    TEXT NOT NULL DEFAULT 'medium',
      position    INTEGER NOT NULL DEFAULT 0,
      agent_sessions TEXT NOT NULL DEFAULT '[]',
      column_moves TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY,
      ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author      TEXT NOT NULL DEFAULT 'agent',
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS column_configs (
      column_id            TEXT PRIMARY KEY REFERENCES columns(id) ON DELETE CASCADE,
      agent_type           TEXT NOT NULL,
      agent_model          TEXT,
      on_finish_column_id  TEXT
    );
  `);

  try {
    db.run("ALTER TABLE boards ADD COLUMN path TEXT;");
    console.log("[db] Migration: Added path column to boards table");
  } catch (e: any) { }

  try {
    db.run("ALTER TABLE tickets ADD COLUMN agent_sessions TEXT NOT NULL DEFAULT '[]';");
    console.log("[db] Migration: Added agent_sessions column to tickets table");
  } catch (e: any) { }

  try {
    db.run("ALTER TABLE tickets ADD COLUMN column_moves TEXT NOT NULL DEFAULT '[]';");
    console.log("[db] Migration: Added column_moves column to tickets table");
  } catch (e: any) { }


  try {
    db.run("ALTER TABLE column_configs ADD COLUMN agent_model TEXT;");
    console.log("[db] Migration: Added agent_model column to column_configs table");
  } catch (e: any) { }

  try {
    db.run("ALTER TABLE column_configs ADD COLUMN max_agents INTEGER DEFAULT 1;");
    console.log("[db] Migration: Added max_agents column to column_configs table");
  } catch (e: any) { }

  try {
    db.run("ALTER TABLE column_configs ADD COLUMN on_reject_column_id TEXT;");
    console.log("[db] Migration: Added on_reject_column_id column to column_configs table");
  } catch (e: any) { }

  try {
    db.run("ALTER TABLE column_configs ADD COLUMN review_mode TEXT DEFAULT 'pr';");
    console.log("[db] Migration: Added review_mode column to column_configs table");
  } catch (e: any) { }



  persist();
}
