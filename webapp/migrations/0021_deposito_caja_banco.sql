-- Migración 0021: Depósitos de Caja Chica → Banco
-- Registra los movimientos de efectivo de caja que se depositan en una cuenta bancaria

CREATE TABLE IF NOT EXISTS depositos_caja_banco (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Movimientos generados
  mov_egreso_id         INTEGER NOT NULL REFERENCES movimientos_caja(id),  -- egreso de caja
  mov_ingreso_id        INTEGER NOT NULL REFERENCES movimientos_caja(id),  -- ingreso al banco
  -- Cuentas involucradas
  caja_sesion_id        INTEGER NOT NULL REFERENCES caja_sesiones(id),
  banco_destino_id      INTEGER NOT NULL REFERENCES bancos(id),
  -- Importe
  moneda                TEXT NOT NULL,
  monto                 REAL NOT NULL,
  -- Concepto libre
  concepto              TEXT,
  -- Auditoría
  usuario_id            INTEGER REFERENCES usuarios(id),
  fecha                 TEXT NOT NULL DEFAULT (datetime('now')),
  -- Anulación
  anulado               INTEGER NOT NULL DEFAULT 0,
  motivo_anulacion      TEXT,
  anulado_por_usuario   INTEGER REFERENCES usuarios(id),
  anulado_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_dep_caja_sesion ON depositos_caja_banco(caja_sesion_id);
CREATE INDEX IF NOT EXISTS idx_dep_banco_dest  ON depositos_caja_banco(banco_destino_id);
CREATE INDEX IF NOT EXISTS idx_dep_fecha       ON depositos_caja_banco(fecha);
