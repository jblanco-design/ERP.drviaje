-- Migración 0015: Agregar razón social y RUT a proveedores
ALTER TABLE proveedores ADD COLUMN razon_social TEXT;
ALTER TABLE proveedores ADD COLUMN nro_rut TEXT;
