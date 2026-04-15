// ============================================================
// Dr. Viaje ERP — Módulo de Autenticación Segura v3
// ============================================================
// Algoritmos usados:
//   - Passwords    : PBKDF2-SHA256, 100.000 iteraciones, salt aleatorio 16 bytes
//   - Sesión       : JWT con firma HMAC-SHA256 real (Web Crypto API)
//   - Expiración   : 1 hora desde última actividad (sliding session)
//   - Blacklist    : tokens revocados en D1 (logout real e inmediato)
//   - Secret       : leído desde variable de entorno JWT_SECRET
// ============================================================

import { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

const SESSION_DURATION = 60 * 60          // 1 hora en segundos
const COOKIE_DURATION  = 60 * 60          // 1 hora en segundos
const RENEW_THRESHOLD  = 60 * 15          // renovar si quedan menos de 15 min

// ── Helpers de encoding ──────────────────────────────────────
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}
function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return new Uint8Array([...atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '='))].map(c => c.charCodeAt(0)))
}

// ── SHA-256 de un string (para blacklist — no guardamos el token completo) ──
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return bufToHex(buf)
}

// ── Obtener clave JWT desde entorno ─────────────────────────
function getJwtSecret(c: Context): string {
  const env = (c.env as any)
  const secret = env?.JWT_SECRET || env?.Bindings?.JWT_SECRET
  if (!secret || secret.length < 32) {
    console.warn('[SECURITY] JWT_SECRET no configurado. Usando fallback de desarrollo — NO usar en producción.')
    return 'drviaje-dev-fallback-secret-needs-env-var-set-2026'
  }
  return secret
}

// ── PBKDF2: hash de contraseñas ──────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000
  const saltBytes  = crypto.getRandomValues(new Uint8Array(16))
  const salt       = bufToHex(saltBytes.buffer)
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, keyMaterial, 256
  )
  return `pbkdf2$${iterations}$${salt}$${bufToHex(derived)}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    if (!storedHash.startsWith('pbkdf2$')) return await verifyLegacyPassword(password, storedHash)
    const [, iterStr, salt, expectedHash] = storedHash.split('$')
    const iterations  = parseInt(iterStr, 10)
    const saltBytes   = hexToBuf(salt)
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    )
    const derived  = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, keyMaterial, 256
    )
    return constantTimeEqual(bufToHex(derived), expectedHash)
  } catch { return false }
}

async function verifyLegacyPassword(password: string, storedHash: string): Promise<boolean> {
  const LEGACY_SECRET = 'drviaje-erp-secret-2024-ultra-secure'
  const data          = new TextEncoder().encode(password + LEGACY_SECRET)
  const hashBuffer    = await crypto.subtle.digest('SHA-256', data)
  const computed      = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === storedHash
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── JWT con HMAC-SHA256 ──────────────────────────────────────
async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  )
}

export async function createToken(
  c: Context,
  payload: Record<string, unknown>
): Promise<string> {
  const secret = getJwtSecret(c)
  const now    = Math.floor(Date.now() / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body   = b64url(new TextEncoder().encode(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + SESSION_DURATION   // 1 hora
  })))
  const signingInput = `${header}.${body}`
  const key    = await getHmacKey(secret)
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${header}.${body}.${b64url(sigBuf)}`
}

export async function verifyToken(
  c: Context,
  token: string
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const secret       = getJwtSecret(c)
    const signingInput = `${parts[0]}.${parts[1]}`
    const key          = await getHmacKey(secret)

    const valid = await crypto.subtle.verify(
      'HMAC', key,
      b64urlDecode(parts[2]),
      new TextEncoder().encode(signingInput)
    )
    if (!valid) return null

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])))

    // Verificar expiración
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return payload
  } catch { return null }
}

// ── Crear tabla session_blacklist si no existe ───────────────
async function ensureBlacklistTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS session_blacklist (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT    NOT NULL UNIQUE,
      user_id    INTEGER NOT NULL,
      revoked_at DATETIME DEFAULT (datetime('now')),
      expires_at DATETIME NOT NULL
    )
  `).run()
  // índice para búsquedas rápidas (ignorar si ya existe)
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_sb_token ON session_blacklist(token_hash)`
  ).run()
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_sb_expires ON session_blacklist(expires_at)`
  ).run()
}

// ── Blacklist: revocar token en D1 ───────────────────────────
export async function revokeToken(c: Context, token: string, userId: number): Promise<void> {
  try {
    const db        = (c.env as any).DB as D1Database
    await ensureBlacklistTable(db)
    const tokenHash = await sha256(token)
    const now       = Math.floor(Date.now() / 1000)
    const expiresAt = new Date((now + SESSION_DURATION) * 1000).toISOString()

    // Limpiar tokens expirados (mantenimiento automático)
    await db.prepare(
      `DELETE FROM session_blacklist WHERE expires_at < datetime('now')`
    ).run()

    // Insertar token revocado
    await db.prepare(
      `INSERT OR IGNORE INTO session_blacklist (token_hash, user_id, expires_at) VALUES (?, ?, ?)`
    ).bind(tokenHash, userId, expiresAt).run()
  } catch (e: any) {
    console.error('[BLACKLIST] Error al revocar token:', e.message)
  }
}

// ── Verificar si un token está en la blacklist ───────────────
async function isTokenRevoked(c: Context, token: string): Promise<boolean> {
  try {
    const db        = (c.env as any).DB as D1Database
    await ensureBlacklistTable(db)
    const tokenHash = await sha256(token)
    const row       = await db.prepare(
      `SELECT id FROM session_blacklist WHERE token_hash = ? AND expires_at > datetime('now')`
    ).bind(tokenHash).first()
    return row !== null
  } catch { return false }
}

// ── Sliding session: renovar cookie si queda poco tiempo ─────
async function renewSessionIfNeeded(c: Context, token: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const exp       = payload.exp as number
    const now       = Math.floor(Date.now() / 1000)
    const remaining = exp - now

    // Si quedan menos de 15 minutos, emitir nuevo token
    if (remaining < RENEW_THRESHOLD) {
      const { exp: _exp, iat: _iat, ...userData } = payload
      const newToken = await createToken(c, userData)
      setAuthCookie(c, newToken)
    }
  } catch { /* silencioso */ }
}

// ── getUser: autenticación completa con blacklist + sliding ──
export async function getUser(
  c: Context
): Promise<{ id: number; nombre: string; email: string; rol: string } | null> {
  const token = getCookie(c, 'auth_token')
  if (!token) return null

  // 1. Verificar firma y expiración del JWT
  const payload = await verifyToken(c, token)
  if (!payload) return null

  // 2. Verificar que el token no esté revocado (logout real)
  const revoked = await isTokenRevoked(c, token)
  if (revoked) return null

  // 3. Sliding session: renovar automáticamente si queda poco tiempo
  await renewSessionIfNeeded(c, token, payload)

  return payload as { id: number; nombre: string; email: string; rol: string }
}

export async function requireAuth(c: Context): Promise<Response | null> {
  const user = await getUser(c)
  if (!user) return c.redirect('/login?error=expired') as unknown as Response
  return null
}

export async function requireGerente(c: Context): Promise<Response | null> {
  const user = await getUser(c)
  if (!user) return c.redirect('/login?error=expired') as unknown as Response
  if (user.rol !== 'gerente') return c.html('<h1>Acceso denegado</h1><a href="/">Volver</a>', 403) as unknown as Response
  return null
}

// ── Helpers de roles ─────────────────────────────────────────
// Jerarquía: gerente > administracion > supervisor > vendedor
//
// isGerente         : acceso total, único que crea usuarios
// isAdmin           : ve y modifica ventas + admin, puede reabrir cerrados
// isSupervisor      : ve ventas de todos, puede cerrar a pérdidas, SIN tesorería/pagos
// isVendedor        : ve solo sus files, sin tesorería ni admin
//
// canManageUsers    : solo gerente
// canAccessTesoreria: gerente y administracion (NO supervisor, NO vendedor)
// canReopenFile     : gerente y administracion
// canCloseAtLoss    : gerente, administracion y supervisor
// canSeeAllFiles    : gerente, administracion y supervisor
// canSeeReportes    : gerente, administracion y supervisor

export type UserRole = 'gerente' | 'administracion' | 'supervisor' | 'vendedor'

export function isGerente(rol: string): boolean {
  return rol === 'gerente'
}

export function isAdminOrAbove(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion'
}

export function isSupervisorOrAbove(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion' || rol === 'supervisor'
}

// Puede gestionar (crear/editar/eliminar) usuarios
export function canManageUsers(rol: string): boolean {
  return rol === 'gerente'
}

// Puede acceder a tesorería, movimientos de caja y pagos a proveedores
export function canAccessTesoreria(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion'
}

// Puede reabrir un file cerrado
export function canReopenFile(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion'
}

// Puede cerrar un file aunque tenga utilidad negativa
export function canCloseAtLoss(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion' || rol === 'supervisor'
}

// Puede ver files de todos los vendedores
export function canSeeAllFiles(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion' || rol === 'supervisor'
}

// Puede anular un file
export function canAnularFile(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion'
}

// Puede acceder a gastos administrativos
export function canAccessGastos(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion'
}

// Puede ver reportes de ventas
export function canSeeReportes(rol: string): boolean {
  return rol === 'gerente' || rol === 'administracion' || rol === 'supervisor'
}

// Etiqueta visual para el badge de rol
export function rolLabel(rol: string): string {
  const labels: Record<string, string> = {
    gerente:       'Gerente',
    administracion:'Administración',
    supervisor:    'Supervisor',
    vendedor:      'Vendedor',
  }
  return labels[rol] || rol
}

// Color del badge de rol
export function rolColor(rol: string): string {
  const colors: Record<string, string> = {
    gerente:        'linear-gradient(135deg,#7B3FA0,#EC008C)',
    administracion: 'linear-gradient(135deg,#1d4ed8,#0ea5e9)',
    supervisor:     'linear-gradient(135deg,#b45309,#f59e0b)',
    vendedor:       '#fff7ed',
  }
  return colors[rol] || '#f3f4f6'
}

export function rolTextColor(rol: string): string {
  return (rol === 'vendedor') ? '#c2410c' : 'white'
}

// ── Cookie segura ────────────────────────────────────────────
export function setAuthCookie(c: Context, token: string): void {
  setCookie(c, 'auth_token', token, {
    httpOnly:  true,          // JS no puede leer la cookie
    secure:    true,          // Solo HTTPS
    sameSite:  'Strict',      // Protección CSRF
    path:      '/',
    maxAge:    COOKIE_DURATION // 1 hora
  })
}

export function clearAuthCookie(c: Context): void {
  deleteCookie(c, 'auth_token', { path: '/' })
}

// Exportar sha256 para uso interno si se necesita
export { sha256 }
