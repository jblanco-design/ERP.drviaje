-- Migración 0012: Tabla cliente_tarjetas + columnas extra en proveedor_tarjetas
-- Permite gestión centralizada de tarjetas en "Tarjetas en Cartera"

-- Tabla de tarjetas de CLIENTES (ingresos con TC)
CREATE TABLE IF NOT EXISTS cliente_tarjetas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id            INTEGER REFERENCES clientes(id),
  movimiento_id         INTEGER REFERENCES movimientos_caja(id),
  file_id               INTEGER REFERENCES files(id),
  ultimos_4             TEXT NOT NULL,
  banco_emisor          TEXT,
  monto                 REAL NOT NULL,
  moneda                TEXT NOT NULL DEFAULT 'USD',
  fecha_cargo           TEXT NOT NULL DEFAULT (date('now')),
  estado                TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','autorizada','rechazada')),
  fecha_autorizacion    TEXT,
  autorizado_por_usuario INTEGER REFERENCES usuarios(id),
  notas                 TEXT,
  concepto              TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cli_tc_cliente  ON cliente_tarjetas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cli_tc_file     ON cliente_tarjetas(file_id);
CREATE INDEX IF NOT EXISTS idx_cli_tc_estado   ON cliente_tarjetas(estado);

-- Agregar columnas file_id y concepto a proveedor_tarjetas si no existen
ALTER TABLE proveedor_tarjetas ADD COLUMN file_id   INTEGER REFERENCES files(id);
ALTER TABLE proveedor_tarjetas ADD COLUMN concepto  TEXT;
ALTER TABLE proveedor_tarjetas ADD COLUMN servicios_ids TEXT;

CREATE INDEX IF NOT EXISTS idx_prov_tc_file    ON proveedor_tarjetas(file_id);
CREATE INDEX IF NOT EXISTS idx_prov_tc_estado  ON proveedor_tarjetas(estado);

SELECT 'Migración 0012: tablas de tarjetas en cartera creadas.' as resultado;
