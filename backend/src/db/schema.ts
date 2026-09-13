import { pool } from "./pool.js";

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id CHAR(36) PRIMARY KEY COMMENT 'UUID v4 server-generated, PK prevents dup',
      name VARCHAR(255) NOT NULL,
      path VARCHAR(500) NOT NULL,
      status ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
      document_type VARCHAR(50) NOT NULL DEFAULT 'unknown' COMMENT 'invoice|receipt|payment|bill|payslip|settlement_slip|other|unknown',
      data JSON NULL,
      error TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status_created (status, created_at),
      INDEX idx_document_type (document_type),
      INDEX idx_type_status (document_type, status)
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
