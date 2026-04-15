-- ============================================================
-- Migración 0005: Agregar soporte para tipo_documento 'DNI'
-- SQLite no permite ALTER TABLE para modificar CHECK constraints
-- Se crea tabla temporal, copia datos, renombra
-- ============================================================

-- 1. Crear nueva tabla clientes con constraint actualizado (incluye 'DNI')
CREATE TABLE IF NOT EXISTS clientes_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_completo TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  tipo_documento TEXT CHECK(tipo_documento IN ('CI', 'DNI', 'PAS', 'RUT')),
  nro_documento TEXT,
  fecha_nacimiento TEXT,
  vencimiento_pasaporte TEXT,
  preferencias_comida TEXT,
  millas_aerolineas TEXT,
  notas TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- 2. Copiar todos los datos existentes (columnas comunes)
INSERT INTO clientes_new (id, nombre_completo, email, telefono, direccion, tipo_documento,
  nro_documento, fecha_nacimiento, vencimiento_pasaporte, preferencias_comida,
  millas_aerolineas, notas, created_at, updated_at)
SELECT id, nombre_completo, email, telefono, direccion, tipo_documento,
  nro_documento, fecha_nacimiento, vencimiento_pasaporte, preferencias_comida,
  millas_aerolineas, notas, created_at, updated_at
FROM clientes;

-- 3. Borrar tabla vieja
DROP TABLE clientes;

-- 4. Renombrar la nueva
ALTER TABLE clientes_new RENAME TO clientes;
