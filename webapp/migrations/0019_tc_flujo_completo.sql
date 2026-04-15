-- Migración 0019: Flujo completo de tarjetas de crédito
-- Nuevos estados en estado_pago_proveedor: 'tc_enviada', 'tc_negada'
-- Tabla alertas_tc: notificaciones de TC negada al vendedor

-- ── Extender tarjeta_asignaciones con campo estado y hacer servicio_id opcional ──
-- Primero creamos la tabla correcta si no existe
CREATE TABLE IF NOT EXISTS tarjeta_asignaciones (
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

-- Agregar columna estado si no existe (para DB que ya tenían la tabla)
ALTER TABLE tarjeta_asignaciones ADD COLUMN estado TEXT NOT NULL DEFAULT 'tc_enviada';

-- ── Agregar campo monto_tc_asignado en servicios ──
ALTER TABLE servicios ADD COLUMN monto_tc_asignado REAL DEFAULT 0;

-- ── Tabla alertas_tc: notificaciones de TC negada ──
CREATE TABLE IF NOT EXISTS alertas_tc (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_tarjeta_id    INTEGER REFERENCES cliente_tarjetas(id),
  proveedor_tarjeta_id  INTEGER REFERENCES proveedor_tarjetas(id),
  asignacion_id         INTEGER REFERENCES tarjeta_asignaciones(id),
  servicio_id           INTEGER REFERENCES servicios(id),
  file_id               INTEGER NOT NULL REFERENCES files(id),
  vendedor_usuario_id   INTEGER REFERENCES usuarios(id),
  monto                 REAL NOT NULL,
  moneda                TEXT NOT NULL DEFAULT 'USD',
  proveedor_id          INTEGER,
  motivo                TEXT,
  estado                TEXT NOT NULL DEFAULT 'pendiente',
  vista_at              DATETIME,
  resuelta_at           DATETIME,
  creado_at             DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ta_estado          ON tarjeta_asignaciones(estado);
CREATE INDEX IF NOT EXISTS idx_alertas_tc_file    ON alertas_tc(file_id);
CREATE INDEX IF NOT EXISTS idx_alertas_tc_vend    ON alertas_tc(vendedor_usuario_id);
CREATE INDEX IF NOT EXISTS idx_alertas_tc_estado  ON alertas_tc(estado);
