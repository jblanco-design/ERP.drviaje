-- ============================================
-- Dr. Viaje ERP - Esquema de Base de Datos v1
-- ============================================

-- Usuarios del sistema (Gerente / Vendedor)
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK(rol IN ('gerente', 'vendedor')),
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Proveedores (a quién le pagamos)
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT DEFAULT 'proveedor',
  contacto TEXT,
  email TEXT,
  telefono TEXT,
  notas TEXT,
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Operadores/Prestadores (quién ejecuta el servicio)
CREATE TABLE IF NOT EXISTS operadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT,
  contacto TEXT,
  email TEXT,
  telefono TEXT,
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_completo TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  direccion TEXT,
  tipo_documento TEXT CHECK(tipo_documento IN ('CI', 'PAS', 'RUT')) DEFAULT 'CI',
  nro_documento TEXT,
  fecha_nacimiento TEXT,
  vencimiento_pasaporte TEXT,
  preferencias_comida TEXT,
  millas_aerolineas TEXT,
  notas TEXT,
  bitrix_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Files (Expedientes de viaje)
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT UNIQUE NOT NULL,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  vendedor_id INTEGER NOT NULL REFERENCES usuarios(id),
  estado TEXT NOT NULL DEFAULT 'en_proceso' CHECK(estado IN ('en_proceso','seniado','cerrado','anulado')),
  fecha_apertura TEXT DEFAULT (datetime('now')),
  fecha_viaje TEXT,
  destino_principal TEXT,
  notas TEXT,
  total_venta REAL DEFAULT 0,
  total_costo REAL DEFAULT 0,
  moneda TEXT DEFAULT 'USD',
  bitrix_deal_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Servicios dentro de cada File
CREATE TABLE IF NOT EXISTS servicios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tipo_servicio TEXT NOT NULL CHECK(tipo_servicio IN ('aereo','hotel','traslado','tour','seguro','otro')),
  descripcion TEXT NOT NULL,
  proveedor_id INTEGER REFERENCES proveedores(id),
  operador_id INTEGER REFERENCES operadores(id),
  destino_codigo TEXT,
  nro_ticket TEXT,
  fecha_inicio TEXT,
  fecha_fin TEXT,
  costo_original REAL DEFAULT 0,
  moneda_origen TEXT DEFAULT 'USD',
  tipo_cambio REAL DEFAULT 1.0,
  precio_venta REAL DEFAULT 0,
  requiere_prepago INTEGER DEFAULT 0,
  fecha_limite_prepago TEXT,
  prepago_realizado INTEGER DEFAULT 0,
  estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente','confirmado','cancelado')),
  estado_pago_proveedor TEXT DEFAULT 'pendiente',
  notas TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cotizaciones del día (USD/UYU)
CREATE TABLE IF NOT EXISTS cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  moneda_origen TEXT NOT NULL DEFAULT 'USD',
  moneda_destino TEXT NOT NULL DEFAULT 'UYU',
  valor REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(fecha, moneda_origen, moneda_destino)
);

-- Cuentas bancarias
CREATE TABLE IF NOT EXISTS bancos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_entidad TEXT NOT NULL,
  nro_cuenta TEXT,
  moneda TEXT NOT NULL CHECK(moneda IN ('USD','UYU')),
  saldo_inicial REAL DEFAULT 0,
  activo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Movimientos de caja / tesorería
CREATE TABLE IF NOT EXISTS movimientos_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('ingreso','egreso')),
  metodo TEXT NOT NULL CHECK(metodo IN ('efectivo','transferencia','tarjeta','cheque')),
  moneda TEXT NOT NULL DEFAULT 'USD',
  monto REAL NOT NULL,
  cotizacion REAL DEFAULT 1.0,
  monto_uyu REAL DEFAULT 0,
  file_id INTEGER REFERENCES files(id),
  cliente_id INTEGER REFERENCES clientes(id),
  proveedor_id INTEGER REFERENCES proveedores(id),
  banco_id INTEGER REFERENCES bancos(id),
  concepto TEXT NOT NULL,
  referencia TEXT,
  anulado INTEGER DEFAULT 0,
  motivo_anulacion TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  fecha TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Conciliación bancaria
CREATE TABLE IF NOT EXISTS conciliacion_bancaria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banco_id INTEGER NOT NULL REFERENCES bancos(id),
  movimiento_id INTEGER REFERENCES movimientos_caja(id),
  fecha TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  tipo TEXT CHECK(tipo IN ('ingreso','egreso')),
  conciliado INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Gastos administrativos / de estructura
CREATE TABLE IF NOT EXISTS gastos_admin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rubro TEXT NOT NULL CHECK(rubro IN ('marketing','rrhh','oficina','software','impuestos','otros')),
  descripcion TEXT NOT NULL,
  monto REAL NOT NULL,
  moneda TEXT DEFAULT 'UYU',
  fecha TEXT NOT NULL,
  proveedor TEXT,
  comprobante TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_files_cliente ON files(cliente_id);
CREATE INDEX IF NOT EXISTS idx_files_vendedor ON files(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_files_estado ON files(estado);
CREATE INDEX IF NOT EXISTS idx_servicios_file ON servicios(file_id);
CREATE INDEX IF NOT EXISTS idx_servicios_tipo ON servicios(tipo_servicio);
CREATE INDEX IF NOT EXISTS idx_movimientos_file ON movimientos_caja(file_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_caja(fecha);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_fecha ON cotizaciones(fecha);

-- Usuario gerente por defecto (password: DrViaje2024!)
INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol) VALUES 
  ('Gerente', 'gerente@drviaje.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lquu', 'gerente');
