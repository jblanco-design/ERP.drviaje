-- ============================================================
-- Migración 0010: File Compartido entre vendedores
-- ============================================================
-- Un file puede ser compartido entre el vendedor dueño y un
-- vendedor adicional. La división es siempre 50/50.
-- Solo 1 vendedor compartido por file.
-- ============================================================

-- Tabla de files compartidos
CREATE TABLE IF NOT EXISTS file_compartido (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  vendedor_id      INTEGER NOT NULL REFERENCES usuarios(id),  -- vendedor con quien se comparte
  porcentaje       REAL    NOT NULL DEFAULT 50.0,             -- siempre 50 por ahora
  compartido_por   INTEGER NOT NULL REFERENCES usuarios(id),  -- quien lo compartió
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(file_id)  -- solo 1 vendedor compartido por file
);

CREATE INDEX IF NOT EXISTS idx_file_compartido_file    ON file_compartido(file_id);
CREATE INDEX IF NOT EXISTS idx_file_compartido_vendedor ON file_compartido(vendedor_id);

SELECT 'Migración 0010: tabla file_compartido creada.' as mensaje;
