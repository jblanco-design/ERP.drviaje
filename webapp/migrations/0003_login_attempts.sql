-- ============================================================
-- Dr. Viaje ERP - Migración v3: Tabla de rate limiting para login
-- ============================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  success    INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, created_at);
