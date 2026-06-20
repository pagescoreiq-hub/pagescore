/**
 * PageScoreIQ — initial schema migration.
 *
 * Tables: users, user_sessions, websites, audit_history.
 * Conventions: uuid primary keys, timestamptz, an index on every foreign key.
 *
 * Run with:  npm run migrate:up      (rollback: npm run migrate:down)
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // gen_random_uuid() comes from pgcrypto (already available on Supabase, but be explicit).
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  const id = { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") };
  const createdAt = { type: "timestamptz", notNull: true, default: pgm.func("now()") };

  // ── users ──────────────────────────────────────────────────────────────────
  pgm.createTable("users", {
    id,
    username: { type: "text", notNull: true, unique: true },
    email: { type: "text", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    role: { type: "text", notNull: true, default: "user" }, // 'user' | 'admin'
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: createdAt,
    updated_at: createdAt,
  });

  // ── user_sessions (one row per active refresh token) ────────────────────────
  pgm.createTable("user_sessions", {
    id,
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    refresh_token_hash: { type: "text", notNull: true, unique: true }, // sha256 of token
    user_agent: { type: "text" },
    ip: { type: "text" },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    created_at: createdAt,
  });
  pgm.createIndex("user_sessions", "user_id");

  // ── websites (each audited site, scoped to its owner) ───────────────────────
  pgm.createTable("websites", {
    id,
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    url: { type: "text", notNull: true },
    hostname: { type: "text", notNull: true },
    created_at: createdAt,
    last_audited_at: { type: "timestamptz" },
  });
  pgm.addConstraint("websites", "websites_user_hostname_unique", { unique: ["user_id", "hostname"] });
  pgm.createIndex("websites", "user_id");

  // ── audit_history (one row per audit run) ───────────────────────────────────
  pgm.createTable("audit_history", {
    id,
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    website_id: { type: "uuid", notNull: true, references: "websites", onDelete: "CASCADE" },
    url: { type: "text", notNull: true },
    overall_score: { type: "integer", notNull: true },
    grade: { type: "text", notNull: true },
    verdict: { type: "text" },
    summary: { type: "jsonb" }, // { pass, warn, fail }
    report: { type: "jsonb" }, // full FullAuditReport (replaces the old R2 JSON)
    pdf_key: { type: "text" }, // R2 object key
    pdf_url: { type: "text" }, // shareable link to the PDF
    created_at: createdAt,
  });
  pgm.createIndex("audit_history", ["user_id", "created_at"]);
  pgm.createIndex("audit_history", ["website_id", "created_at"]);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("audit_history");
  pgm.dropTable("websites");
  pgm.dropTable("user_sessions");
  pgm.dropTable("users");
};
