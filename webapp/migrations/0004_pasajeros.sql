-- ============================================================
-- Dr. Viaje ERP - Migración v4: Pasajeros y titulares de pago
-- ============================================================
-- Diseño:
--   pasajeros        → personas que viajan (nombre, doc, etc.)
--   file_pasajeros   → relación N:M file ↔ pasajero
--                       con rol: 'titular' (cliente principal) o 'acompañante'
--                       y grupo: para identificar familias dentro del mismo file
--   servicio_pasajeros → relación N:M servicio ↔ pasajero
--                        (qué pasajeros están incluidos en cada servicio)
--   movimientos_caja  → agregar columna pasajero_pagador_id
--                        para saber qué titular hizo cada pago
-- ============================================================

-- Tabla de pasajeros (personas físicas que viajan)
CREATE TABLE IF NOT EXISTS pasajeros (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_completo       TEXT NOT NULL,
  tipo_documento        TEXT CHECK(tipo_documento IN ('CI','PAS','DNI','OTRO')) DEFAULT 'CI',
  nro_documento         TEXT,
  fecha_nacimiento      TEXT,
  vencimiento_pasaporte TEXT,
  nacionalidad          TEXT,
  email                 TEXT,
  telefono              TEXT,
  preferencias_comida   TEXT,
  millas_aerolineas     TEXT,
  notas                 TEXT,
  -- Si este pasajero ya existe como cliente, linkear
  cliente_id            INTEGER REFERENCES clientes(id),
  created_at            TEXT DEFAULT (datetime('now')),
  updated_at            TEXT DEFAULT (datetime('now'))
);

-- Relación File ↔ Pasajeros (quiénes viajan en cada file)
CREATE TABLE IF NOT EXISTS file_pasajeros (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  pasajero_id   INTEGER NOT NULL REFERENCES pasajeros(id),
  -- Rol en el file
  rol           TEXT NOT NULL DEFAULT 'acompañante' 
                CHECK(rol IN ('titular','acompañante')),
  -- Grupo familiar / titular de pago (ej: 'Familia Blanco', 'Familia León')
  -- Los pasajeros del mismo grupo comparten un titular de pago
  grupo         TEXT,
  -- Orden de aparición en el file (para display)
  orden         INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(file_id, pasajero_id)
);

-- Relación Servicio ↔ Pasajeros (qué pasajeros incluye cada servicio)
CREATE TABLE IF NOT EXISTS servicio_pasajeros (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  servicio_id   INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
  pasajero_id   INTEGER NOT NULL REFERENCES pasajeros(id),
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(servicio_id, pasajero_id)
);

-- Agregar columna pasajero_pagador_id a movimientos_caja
-- para identificar qué titular/grupo efectuó el pago
ALTER TABLE movimientos_caja ADD COLUMN pasajero_pagador_id INTEGER REFERENCES pasajeros(id);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_pasajeros_doc       ON pasajeros(nro_documento);
CREATE INDEX IF NOT EXISTS idx_pasajeros_cliente   ON pasajeros(cliente_id);
CREATE INDEX IF NOT EXISTS idx_file_pasajeros_file ON file_pasajeros(file_id);
CREATE INDEX IF NOT EXISTS idx_file_pasajeros_pax  ON file_pasajeros(pasajero_id);
CREATE INDEX IF NOT EXISTS idx_serv_pasajeros_serv ON servicio_pasajeros(servicio_id);
CREATE INDEX IF NOT EXISTS idx_serv_pasajeros_pax  ON servicio_pasajeros(pasajero_id);
CREATE INDEX IF NOT EXISTS idx_mov_pagador          ON movimientos_caja(pasajero_pagador_id);
