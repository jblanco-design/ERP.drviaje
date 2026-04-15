-- Migración 0013: Gestión completa de cuentas bancarias
-- Agrega campo 'descripcion' para alias/notas de la cuenta
-- El campo 'activo' ya existe en la tabla original

ALTER TABLE bancos ADD COLUMN descripcion TEXT DEFAULT NULL;
