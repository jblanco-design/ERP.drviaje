-- Migración 0018: Asignaciones de tarjetas a servicios/proveedores
-- Permite dividir el monto de una tarjeta en múltiples servicios del mismo proveedor

CREATE TABLE IF NOT EXISTS tarjeta_asignaciones (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Origen: puede ser tarjeta de cliente o de proveedor
  cliente_tarjeta_id  INTEGER REFERENCES cliente_tarjetas(id),
  proveedor_tarjeta_id INTEGER REFERENCES proveedor_tarjetas(id),
  -- Destino
  proveedor_id        INTEGER NOT NULL REFERENCES proveedores(id),
  servicio_id         INTEGER NOT NULL REFERENCES servicios(id),
  file_id             INTEGER NOT NULL REFERENCES files(id),
  -- Monto asignado
  monto               REAL NOT NULL CHECK(monto > 0),
  moneda              TEXT NOT NULL DEFAULT 'USD',
  -- Registro
  notas               TEXT,
  creado_por_usuario  INTEGER REFERENCES usuarios(id),
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Constraints: debe tener exactamente una fuente
  CHECK (
    (cliente_tarjeta_id IS NOT NULL AND proveedor_tarjeta_id IS NULL) OR
    (cliente_tarjeta_id IS NULL AND proveedor_tarjeta_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ta_cliente_tarjeta   ON tarjeta_asignaciones(cliente_tarjeta_id);
CREATE INDEX IF NOT EXISTS idx_ta_proveedor_tarjeta ON tarjeta_asignaciones(proveedor_tarjeta_id);
CREATE INDEX IF NOT EXISTS idx_ta_servicio          ON tarjeta_asignaciones(servicio_id);
CREATE INDEX IF NOT EXISTS idx_ta_proveedor         ON tarjeta_asignaciones(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ta_file              ON tarjeta_asignaciones(file_id);
