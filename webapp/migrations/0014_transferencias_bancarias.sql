-- Migración 0014: Transferencias entre cuentas bancarias
-- Registra el encabezado de cada transferencia vinculando los 2 movimientos

CREATE TABLE IF NOT EXISTS transferencias_bancarias (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Movimientos generados (egreso origen + ingreso destino)
  mov_egreso_id         INTEGER NOT NULL REFERENCES movimientos_caja(id),
  mov_ingreso_id        INTEGER NOT NULL REFERENCES movimientos_caja(id),
  -- Cuentas involucradas
  banco_origen_id       INTEGER NOT NULL REFERENCES bancos(id),
  banco_destino_id      INTEGER NOT NULL REFERENCES bancos(id),
  -- Importes cargados por el usuario
  monto_debito          REAL NOT NULL,          -- lo que sale de origen
  moneda_debito         TEXT NOT NULL,          -- moneda de la cuenta origen
  monto_credito         REAL NOT NULL,          -- lo que entra en destino
  moneda_credito        TEXT NOT NULL,          -- moneda de la cuenta destino
  -- Arbitraje calculado (diferencia en USD)
  arbitraje_usd         REAL NOT NULL DEFAULT 0,
  -- Cotizaciones usadas para el cálculo
  cotizacion_debito     REAL NOT NULL DEFAULT 1, -- debito → USD
  cotizacion_credito    REAL NOT NULL DEFAULT 1, -- credito → USD
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

CREATE INDEX IF NOT EXISTS idx_transf_banco_origen  ON transferencias_bancarias(banco_origen_id);
CREATE INDEX IF NOT EXISTS idx_transf_banco_destino ON transferencias_bancarias(banco_destino_id);
CREATE INDEX IF NOT EXISTS idx_transf_fecha         ON transferencias_bancarias(fecha);
