// ============================================================
// Dr. Viaje ERP — Escape HTML (protección XSS)
// ============================================================
// Usar SIEMPRE al renderizar datos provenientes de la base de
// datos o del usuario en plantillas HTML de servidor.
// ============================================================

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
}

/**
 * Escapa caracteres especiales HTML para prevenir XSS.
 * Usar en TODOS los valores de DB que se insertan en HTML.
 */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"'`=/]/g, c => HTML_ESCAPES[c] ?? c)
}

/**
 * Versión para atributos HTML (doble escape de comillas).
 */
export function escAttr(value: unknown): string {
  return esc(value).replace(/'/g, '&#39;')
}

/**
 * Parsea y limpia un número — nunca retorna NaN en el HTML.
 */
export function safeNum(value: unknown, decimals = 0): string {
  const n = Number(value)
  if (!isFinite(n)) return '0'
  return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n))
}
