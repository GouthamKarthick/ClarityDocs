import { pool } from "./pool.js";

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token VARCHAR(255) NULL,
      verification_expires DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_token (token),
      INDEX idx_user_expires (user_id, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id CHAR(36) PRIMARY KEY COMMENT 'UUID v4 server-generated, PK prevents dup',
      name VARCHAR(255) NOT NULL,
      path VARCHAR(500) NOT NULL,
      status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
      document_type VARCHAR(50) NOT NULL DEFAULT 'unknown' COMMENT 'invoice|receipt|payment|bill|payslip|settlement_slip|other|unknown',
      data JSON NULL,
      error TEXT NULL,
      user_id CHAR(36) NULL COMMENT 'FK→users.id',
      expires_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 30 DAY) COMMENT '30-day hard delete',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status_created (status, created_at),
      INDEX idx_document_type (document_type),
      INDEX idx_type_status (document_type, status),
      INDEX idx_user_created (user_id, created_at),
      INDEX idx_expires (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  // Migrate existing DB (ADD COLUMN if missing — MySQL 8 supports IF NOT EXISTS via try/catch)
  try {
    const [cols] = await pool.query(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='documents' AND COLUMN_NAME='document_type'"
    );
    const cnt = (cols as Array<{ cnt: number }>)[0]?.cnt ?? 0;
    if (cnt === 0) {
      await pool.query(
        "ALTER TABLE documents ADD COLUMN document_type VARCHAR(50) NOT NULL DEFAULT 'unknown' COMMENT 'invoice|receipt|payment|bill|payslip|settlement_slip|other|unknown' AFTER status"
      );
    }
    const [userCols] = await pool.query(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='documents' AND COLUMN_NAME='user_id'"
    );
    if ((userCols as Array<{ cnt: number }>)[0]?.cnt === 0) {
      await pool.query("ALTER TABLE documents ADD COLUMN user_id CHAR(36) NULL AFTER data");
    }
    const [expCols] = await pool.query(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='documents' AND COLUMN_NAME='expires_at'"
    );
    if ((expCols as Array<{ cnt: number }>)[0]?.cnt === 0) {
      await pool.query("ALTER TABLE documents ADD COLUMN expires_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 30 DAY) AFTER user_id");
    }
    // Ensure indexes exist
    const [idx] = await pool.query(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='documents' AND INDEX_NAME='idx_document_type'"
    );
    if ((idx as Array<{ cnt: number }>)[0]?.cnt === 0) {
      await pool.query("ALTER TABLE documents ADD INDEX idx_document_type (document_type)");
    }
    const [idx2] = await pool.query(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='documents' AND INDEX_NAME='idx_type_status'"
    );
    if ((idx2 as Array<{ cnt: number }>)[0]?.cnt === 0) {
      await pool.query("ALTER TABLE documents ADD INDEX idx_type_status (document_type, status)");
    }
    const [idxU] = await pool.query(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='documents' AND INDEX_NAME='idx_user_created'"
    );
    if ((idxU as Array<{ cnt: number }>)[0]?.cnt === 0) {
      await pool.query("ALTER TABLE documents ADD INDEX idx_user_created (user_id, created_at)");
    }
    const [idxE] = await pool.query(
      "SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='documents' AND INDEX_NAME='idx_expires'"
    );
    if ((idxE as Array<{ cnt: number }>)[0]?.cnt === 0) {
      await pool.query("ALTER TABLE documents ADD INDEX idx_expires (expires_at)");
    }
    // FK if missing
    try {
      await pool.query("ALTER TABLE documents ADD CONSTRAINT fk_doc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
    } catch {}
  } catch {
    // ignore migration errors (e.g., concurrent ALTER)
  }
  // Phase3 migration is separate: 002_create_extraction_attempts.sql
  // CREATE TABLE extraction_attempts (
  //   id CHAR(36) PRIMARY KEY,
  //   doc_id CHAR(36) NOT NULL,
  //   method VARCHAR(50) NOT NULL,
  //   confidence FLOAT NOT NULL,
  //   cost DECIMAL(10,6) NULL,
  //   latency INT NOT NULL,
  //   success BOOLEAN NOT NULL,
  //   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  //   FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
  // );
}
