-- ============================================================
-- Dr. Viaje ERP - Migración v2: Nuevos estados de file y servicio
-- NOTA: estado_pago_proveedor ya está en 0001_initial.sql
-- Esta migración solo hace la actualización de datos
-- ============================================================

-- Migrar estados viejos de files a los nuevos:
UPDATE files SET estado = 'en_proceso' WHERE estado = 'cotizacion';
UPDATE files SET estado = 'seniado'    WHERE estado = 'confirmado';
UPDATE files SET estado = 'cerrado'    WHERE estado = 'operado';

-- Sincronizar estado_pago_proveedor con prepago_realizado
UPDATE servicios SET estado_pago_proveedor = 'pagado' WHERE prepago_realizado = 1;

-- Índice para consultas por estado_pago_proveedor (IF NOT EXISTS es válido en CREATE INDEX)
CREATE INDEX IF NOT EXISTS idx_servicios_estado_pago ON servicios(estado_pago_proveedor);
