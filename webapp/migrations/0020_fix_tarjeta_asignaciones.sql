-- Migración 0020: Corregir schema de tarjeta_asignaciones
-- servicio_id y file_id deben ser opcionales (NULL permitido para registros de saldo a favor)
-- En SQLite no se puede ALTER COLUMN, hay que recrear la tabla

-- 1. Renombrar la tabla original
ALTER TABLE tarjeta_asignaciones RENAME TO tarjeta_asignaciones_old;

-- 2. Crear tabla nueva con el schema correcto (servicio_id y file_id opcionales)
CREATE TABLE tarjeta_asignaciones (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_tarjeta_id    INTEGER REFERENCES cliente_tarjetas(id),
  proveedor_tarjeta_id  INTEGER REFERENCES proveedor_tarjetas(id),
  proveedor_id          INTEGER NOT NULL,
  servicio_id           INTEGER,
  file_id               INTEGER,
  monto                 REAL NOT NULL CHECK(monto > 0),
  moneda                TEXT NOT NULL DEFAULT 'USD',
  estado                TEXT NOT NULL DEFAULT 'tc_enviada',
  notas                 TEXT,
  creado_por_usuario    INTEGER,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Copiar datos existentes
INSERT INTO tarjeta_asignaciones
  SELECT id, cliente_tarjeta_id, proveedor_tarjeta_id, proveedor_id,
         servicio_id, file_id, monto, moneda,
         COALESCE(estado, 'tc_enviada'),
         notas, creado_por_usuario, created_at
  FROM tarjeta_asignaciones_old;

-- 4. Eliminar tabla vieja
DROP TABLE tarjeta_asignaciones_old;

-- 5. Recrear índices
CREATE INDEX IF NOT EXISTS idx_ta_cli_tc   ON tarjeta_asignaciones(cliente_tarjeta_id);
CREATE INDEX IF NOT EXISTS idx_ta_prov_tc  ON tarjeta_asignaciones(proveedor_tarjeta_id);
CREATE INDEX IF NOT EXISTS idx_ta_svc      ON tarjeta_asignaciones(servicio_id);
CREATE INDEX IF NOT EXISTS idx_ta_estado   ON tarjeta_asignaciones(estado);
CREATE INDEX IF NOT EXISTS idx_ta_prov     ON tarjeta_asignaciones(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ta_file     ON tarjeta_asignaciones(file_id);
