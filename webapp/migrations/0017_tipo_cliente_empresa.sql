-- ============================================================
-- Migración 0017: Soporte para clientes Empresa
-- Agrega tipo_cliente, razon_social y persona_contacto
-- ============================================================

-- tipo_cliente: 'persona_fisica' (default) o 'empresa'
ALTER TABLE clientes ADD COLUMN tipo_cliente TEXT NOT NULL DEFAULT 'persona_fisica';

-- Razón social (solo para empresas)
ALTER TABLE clientes ADD COLUMN razon_social TEXT;

-- Persona de contacto (obligatoria para empresas)
ALTER TABLE clientes ADD COLUMN persona_contacto TEXT;

SELECT 'Migración 0017: columnas tipo_cliente, razon_social y persona_contacto agregadas.' as mensaje;
