/**
 * Add audit_type ('lp' | 'website') to audit_history so each run records which
 * audit purpose produced it. Defaults existing rows to 'lp'.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn("audit_history", {
    audit_type: { type: "text", notNull: true, default: "lp" }, // 'lp' | 'website'
  });
  pgm.addConstraint("audit_history", "audit_history_audit_type_check", {
    check: "audit_type in ('lp', 'website')",
  });
  pgm.createIndex("audit_history", ["user_id", "audit_type", "created_at"]);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex("audit_history", ["user_id", "audit_type", "created_at"]);
  pgm.dropConstraint("audit_history", "audit_history_audit_type_check");
  pgm.dropColumn("audit_history", "audit_type");
};
