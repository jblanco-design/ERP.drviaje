-- ============================================================
-- Migración 0009: Nuevos roles — supervisor y administracion
-- ============================================================
-- Los roles válidos ahora son:
--   gerente       → acceso total, único que crea usuarios
--   administracion → ve y modifica ventas + admin, puede reabrir files cerrados, NO crea usuarios
--   supervisor    → ve todo en ventas (todos los files), puede cerrar a pérdidas,
--                   NO accede a tesorería ni pagos a proveedores, NO reabre cerrados
--   vendedor      → ve solo sus propios files, sin tesorería ni admin
-- ============================================================

-- No hay cambios estructurales en el schema, los roles son solo texto.
-- Esta migración documenta los roles y puede usarse para verificación futura.

-- Verificar constraint (SQLite no soporta CHECK en ALTER TABLE, pero lo documentamos aquí)
-- roles válidos: 'gerente', 'administracion', 'supervisor', 'vendedor'
SELECT 'Migración 0009: nuevos roles supervisor y administracion registrados.' as mensaje;
