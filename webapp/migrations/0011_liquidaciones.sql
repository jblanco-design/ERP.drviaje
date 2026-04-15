-- ============================================================
-- Migración 0011: Liquidación de comisiones de vendedores
-- ============================================================
--
-- MODELO:
--   liquidaciones        → cabezal de cada liquidación (por vendedor, por período)
--   liquidacion_files    → detalle: un registro por file incluido en la liquidación
--
-- LÓGICA DE AJUSTE:
--   Cuando un file ya liquidado se reabre y cambia su utilidad,
--   se genera un nuevo registro en liquidacion_files con el DELTA
--   (utilidad_actual - utilidad_ya_liquidada), que puede ser negativo.
--   El campo "utilidad_base" en liquidacion_files guarda la utilidad
--   que se tomó en cuenta AL MOMENTO de incluir ese file.
--   El campo "utilidad_anterior" guarda cuánto ya se liquidó antes (0 en la primera vez).
-- ============================================================

-- Cabezal de liquidación
CREATE TABLE IF NOT EXISTS liquidaciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendedor_id     INTEGER NOT NULL REFERENCES usuarios(id),
  periodo         TEXT    NOT NULL,           -- ej: '2026-04' (mes que se está liquidando)
  fecha_liquidacion TEXT  NOT NULL,           -- fecha en que se aprueba/registra el pago
  estado          TEXT    NOT NULL DEFAULT 'borrador'
                          CHECK(estado IN ('borrador','aprobada','pagada')),
  -- totales calculados al momento de aprobar
  total_utilidad  REAL    NOT NULL DEFAULT 0, -- suma de utilidad_delta de todos los files
  notas           TEXT,
  aprobado_por    INTEGER REFERENCES usuarios(id),
  aprobado_at     DATETIME,
  created_by      INTEGER NOT NULL REFERENCES usuarios(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Detalle: un registro por file incluido (y uno adicional por cada ajuste posterior)
CREATE TABLE IF NOT EXISTS liquidacion_files (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  liquidacion_id      INTEGER NOT NULL REFERENCES liquidaciones(id) ON DELETE CASCADE,
  file_id             INTEGER NOT NULL REFERENCES files(id),
  -- utilidad del vendedor EN ESTE TRAMO
  -- En files compartidos ya viene al 50%
  utilidad_anterior   REAL    NOT NULL DEFAULT 0, -- total ya liquidado antes para este file
  utilidad_base       REAL    NOT NULL,            -- utilidad del vendedor al momento de esta liquidación
  utilidad_delta      REAL    NOT NULL,            -- utilidad_base - utilidad_anterior (puede ser negativo)
  -- snapshot del file al momento de liquidar
  file_numero         TEXT    NOT NULL,
  file_total_venta    REAL    NOT NULL DEFAULT 0,
  file_total_costo    REAL    NOT NULL DEFAULT 0,
  es_compartido       INTEGER NOT NULL DEFAULT 0,  -- 1 si el vendedor es el compartido (50%)
  es_ajuste           INTEGER NOT NULL DEFAULT 0,  -- 1 si es una liquidación adicional por reapertura
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_liq_vendedor  ON liquidaciones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_liq_periodo   ON liquidaciones(periodo);
CREATE INDEX IF NOT EXISTS idx_liq_files_liq ON liquidacion_files(liquidacion_id);
CREATE INDEX IF NOT EXISTS idx_liq_files_file ON liquidacion_files(file_id);

SELECT 'Migración 0011: tablas de liquidaciones creadas.' as mensaje;
