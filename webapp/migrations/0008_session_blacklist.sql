-- ============================================================
-- Blacklist de tokens JWT revocados
-- Permite logout real e invalidación inmediata de sesiones
-- ============================================================

CREATE TABLE IF NOT EXISTS session_blacklist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 del token (no guardamos el token completo)
  user_id     INTEGER NOT NULL,
  revoked_at  DATETIME DEFAULT (datetime('now')),
  expires_at  DATETIME NOT NULL       -- para limpieza automática
);

CREATE INDEX IF NOT EXISTS idx_blacklist_token_hash ON session_blacklist(token_hash);
CREATE INDEX IF NOT EXISTS idx_blacklist_expires    ON session_blacklist(expires_at);
