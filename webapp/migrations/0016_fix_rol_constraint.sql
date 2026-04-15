-- ============================================================
-- Migración 0016: Corregir constraint de rol en tabla usuarios
-- Ampliar CHECK para incluir 'supervisor' y 'administracion'
-- SQLite no soporta ALTER TABLE para modificar constraints,
-- por lo que se recrea la tabla completa preservando todos los datos.
-- ============================================================

-- 1. Crear tabla temporal con el constraint correcto
CREATE TABLE IF NOT EXISTS usuarios_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK(rol IN ('gerente', 'administracion', 'supervisor', 'vendedor')),
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Copiar todos los datos existentes
INSERT INTO usuarios_new SELECT * FROM usuarios;

-- 3. Eliminar tabla antigua
DROP TABLE usuarios;

-- 4. Renombrar nueva tabla
ALTER TABLE usuarios_new RENAME TO usuarios;

SELECT 'Migración 0016: constraint de rol actualizado correctamente.' as mensaje;
