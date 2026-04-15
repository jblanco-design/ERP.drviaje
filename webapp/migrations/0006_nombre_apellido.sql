-- ============================================================
-- Dr. Viaje ERP - Migración v6
-- Separar nombre_completo en nombre + apellido
-- en tablas clientes y pasajeros.
-- Agregar cantidad_pasajeros en servicios.
-- ============================================================

-- ── CLIENTES ─────────────────────────────────────────────────
ALTER TABLE clientes ADD COLUMN nombre  TEXT;
ALTER TABLE clientes ADD COLUMN apellido TEXT;

-- Poblar desde nombre_completo existente
-- (primer token → nombre, resto → apellido)
UPDATE clientes
SET nombre   = TRIM(SUBSTR(nombre_completo, 1,
                  CASE WHEN INSTR(nombre_completo, ' ') > 0
                       THEN INSTR(nombre_completo, ' ') - 1
                       ELSE LENGTH(nombre_completo) END)),
    apellido = CASE
                 WHEN INSTR(nombre_completo, ' ') > 0
                 THEN TRIM(SUBSTR(nombre_completo, INSTR(nombre_completo, ' ') + 1))
                 ELSE NULL
               END;

-- ── PASAJEROS ────────────────────────────────────────────────
ALTER TABLE pasajeros ADD COLUMN nombre  TEXT;
ALTER TABLE pasajeros ADD COLUMN apellido TEXT;

UPDATE pasajeros
SET nombre   = TRIM(SUBSTR(nombre_completo, 1,
                  CASE WHEN INSTR(nombre_completo, ' ') > 0
                       THEN INSTR(nombre_completo, ' ') - 1
                       ELSE LENGTH(nombre_completo) END)),
    apellido = CASE
                 WHEN INSTR(nombre_completo, ' ') > 0
                 THEN TRIM(SUBSTR(nombre_completo, INSTR(nombre_completo, ' ') + 1))
                 ELSE NULL
               END;

-- ── SERVICIOS: cantidad de pasajeros ─────────────────────────
ALTER TABLE servicios ADD COLUMN cantidad_pasajeros INTEGER DEFAULT 1;
