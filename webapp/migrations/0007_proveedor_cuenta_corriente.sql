-- Migración 0007: Cuenta corriente de proveedores
-- Registra saldos a favor, pagos con tarjeta y sus autorizaciones

-- Tabla de movimientos de cuenta corriente del proveedor
CREATE TABLE IF NOT EXISTS proveedor_cuenta_corriente (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  tipo        TEXT NOT NULL CHECK(tipo IN ('credito','debito')),
  -- credito = saldo a favor del proveedor (ej: pago con TC pendiente autorización)
  -- debito  = uso de saldo a favor para pagar servicios
  metodo      TEXT NOT NULL DEFAULT 'transferencia',
  -- transferencia, efectivo, cheque, tarjeta
  monto       REAL NOT NULL DEFAULT 0,
  moneda      TEXT NOT NULL DEFAULT 'USD',
  concepto    TEXT NOT NULL DEFAULT '',
  referencia  TEXT,           -- nro comprobante, factura, etc.
  estado      TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado IN ('pendiente','confirmado','anulado')),
  -- pendiente = TC enviada, esperando autorización del proveedor
  -- confirmado = proveedor confirmó la TC / pago acreditado
  -- anulado = se anuló el movimiento
  autorizado_por TEXT,        -- usuario que autorizó (para pagos con saldo insuficiente)
  usuario_id  INTEGER REFERENCES usuarios(id),
  movimiento_caja_id INTEGER REFERENCES movimientos_caja(id),
  servicios_ids TEXT,         -- ids de servicios pagados (JSON array como texto)
  fecha       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tabla de tarjetas de crédito cargadas para pago a proveedor
-- Permite cargar múltiples TC en una sola transacción
CREATE TABLE IF NOT EXISTS proveedor_tarjetas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id          INTEGER NOT NULL REFERENCES proveedores(id),
  cuenta_corriente_id   INTEGER REFERENCES proveedor_cuenta_corriente(id),
  ultimos_4             TEXT NOT NULL,      -- últimos 4 dígitos de la TC
  banco_emisor          TEXT,               -- banco de la TC (opcional)
  monto                 REAL NOT NULL,
  moneda                TEXT NOT NULL DEFAULT 'USD',
  fecha_cargo           TEXT NOT NULL DEFAULT (date('now')),
  estado                TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','autorizada','rechazada')),
  -- pendiente = esperando que el proveedor confirme
  -- autorizada = proveedor confirmó el cobro
  -- rechazada = TC fue rechazada
  fecha_autorizacion    TEXT,
  autorizado_por_usuario INTEGER REFERENCES usuarios(id),  -- gerente que marcó como autorizada
  notas                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_pcc_proveedor ON proveedor_cuenta_corriente(proveedor_id, estado);
CREATE INDEX IF NOT EXISTS idx_ptc_proveedor ON proveedor_tarjetas(proveedor_id, estado);
CREATE INDEX IF NOT EXISTS idx_ptc_cuenta    ON proveedor_tarjetas(cuenta_corriente_id);

-- Agregar columna autorizado_por en movimientos_caja (para pagos con saldo insuficiente)
ALTER TABLE movimientos_caja ADD COLUMN autorizado_por TEXT;
-- Agregar columna banco_cuenta en movimientos_caja (cuenta bancaria de salida)
ALTER TABLE movimientos_caja ADD COLUMN banco_cuenta TEXT;
