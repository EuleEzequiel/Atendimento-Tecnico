import fs from "node:fs";
import path from "node:path";

/**
 * Camada de acesso a dados.
 *
 * Se DATABASE_URL estiver definido, usa Postgres (recomendado para produção,
 * ex: Supabase, Neon, Render Postgres). Isso resolve o problema de o SQLite
 * viver em disco efêmero no Render Free e perder dados a cada redeploy/sleep.
 *
 * Se DATABASE_URL não estiver definido, cai para SQLite local (bom para rodar
 * na sua máquina/dev, mas NÃO deve ser usado como banco definitivo em
 * hospedagem com filesystem efêmero).
 */

export const usingPostgres = Boolean(process.env.DATABASE_URL);

let impl;

if (usingPostgres) {
  const { default: pg } = await import("pg");
  const { Pool } = pg;

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // A maioria dos provedores gerenciados (Supabase, Neon, Render Postgres)
    // exige SSL e usa certificado que o Node não valida por padrão.
    ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendances (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      raw TEXT NOT NULL,
      identified TEXT NOT NULL,
      done TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      client TEXT,
      equipment_json TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_attendances_user_created
    ON attendances (user_id, created_at DESC);
  `);

  function mapAttendance(row) {
    if (!row) return null;
    return { ...row, created_at: row.created_at.toISOString() };
  }

  impl = {
    async findUserByEmail(email) {
      const { rows } = await pool.query(
        "SELECT * FROM users WHERE lower(email) = lower($1)",
        [email]
      );
      return rows[0] || null;
    },

    async createUser({ name, email, passwordHash }) {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, created_at`,
        [name, email, passwordHash]
      );
      return rows[0];
    },

    async findUserById(id) {
      const { rows } = await pool.query(
        "SELECT id, name, email, created_at FROM users WHERE id = $1",
        [id]
      );
      return rows[0] || null;
    },

    async createAttendance(a) {
      const { rows } = await pool.query(
        `INSERT INTO attendances
         (user_id, raw, identified, done, category, summary, client, equipment_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, raw, identified, done, category, summary, client, equipment_json, created_at`,
        [a.userId, a.raw, a.identified, a.done, a.category, a.summary, a.client, a.equipmentJson]
      );
      return mapAttendance(rows[0]);
    },

    async getAttendanceById(id, userId) {
      const { rows } = await pool.query(
        "SELECT * FROM attendances WHERE id = $1 AND user_id = $2",
        [id, userId]
      );
      return mapAttendance(rows[0]);
    },

    async listAttendances(userId, limit = 500) {
      const { rows } = await pool.query(
        `SELECT id, raw, identified, done, category, summary, client, equipment_json, created_at
         FROM attendances
         WHERE user_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [userId, limit]
      );
      return rows.map(mapAttendance);
    }
  };
} else {
  const { default: Database } = await import("better-sqlite3");

  const dbPath = process.env.DB_PATH || "./data/central-tecnica.db";
  const absolute = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const sqlite = new Database(absolute);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      raw TEXT NOT NULL,
      identified TEXT NOT NULL,
      done TEXT NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      client TEXT,
      equipment_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attendances_user_created
    ON attendances(user_id, created_at DESC);
  `);

  impl = {
    async findUserByEmail(email) {
      return sqlite.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) || null;
    },

    async createUser({ name, email, passwordHash }) {
      const result = sqlite
        .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
        .run(name, email, passwordHash);
      return sqlite
        .prepare("SELECT id, name, email, created_at FROM users WHERE id = ?")
        .get(result.lastInsertRowid);
    },

    async findUserById(id) {
      return sqlite.prepare("SELECT id, name, email, created_at FROM users WHERE id = ?").get(id) || null;
    },

    async createAttendance(a) {
      const result = sqlite
        .prepare(
          `INSERT INTO attendances
           (user_id, raw, identified, done, category, summary, client, equipment_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(a.userId, a.raw, a.identified, a.done, a.category, a.summary, a.client, a.equipmentJson);

      return sqlite.prepare("SELECT * FROM attendances WHERE id = ?").get(result.lastInsertRowid);
    },

    async getAttendanceById(id, userId) {
      return (
        sqlite.prepare("SELECT * FROM attendances WHERE id = ? AND user_id = ?").get(id, userId) || null
      );
    },

    async listAttendances(userId, limit = 500) {
      return sqlite
        .prepare(
          `SELECT id, raw, identified, done, category, summary, client, equipment_json, created_at
           FROM attendances
           WHERE user_id = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT ?`
        )
        .all(userId, limit);
    }
  };
}

export const db = impl;
