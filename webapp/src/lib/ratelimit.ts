// ============================================================
// Dr. Viaje ERP — Rate Limiting para Login
// ============================================================
// Almacena intentos fallidos en D1. Bloquea 15 minutos
// tras 5 intentos consecutivos fallidos desde la misma IP.
// La tabla se crea automáticamente si no existe.
// ============================================================

const MAX_ATTEMPTS  = 5
const WINDOW_SEC    = 15 * 60  // 15 minutos de bloqueo

export interface RateLimitResult {
  blocked: boolean
  attemptsLeft: number
  retryAfterSec: number
}

// Asegura que la tabla existe (idempotente)
async function ensureTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ip        TEXT NOT NULL,
      email     TEXT NOT NULL DEFAULT '',
      success   INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run()
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, created_at)`
  ).run()
}

export async function checkRateLimit(
  db: D1Database,
  ip: string
): Promise<RateLimitResult> {
  await ensureTable(db)

  // Limpiar registros más viejos que la ventana (mantenimiento ligero)
  await db.prepare(
    `DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 hour')`
  ).run()

  // Contar intentos fallidos recientes desde esta IP
  const cutoff = new Date(Date.now() - WINDOW_SEC * 1000).toISOString()
  const row = await db.prepare(`
    SELECT COUNT(*) as cnt,
           MAX(created_at) as last_attempt
    FROM login_attempts
    WHERE ip = ? AND success = 0 AND created_at > ?
  `).bind(ip, cutoff).first() as any

  const cnt = Number(row?.cnt || 0)

  if (cnt >= MAX_ATTEMPTS) {
    const lastMs   = row?.last_attempt ? new Date(row.last_attempt).getTime() : Date.now()
    const elapsed  = Math.floor((Date.now() - lastMs) / 1000)
    const retryAfter = Math.max(0, WINDOW_SEC - elapsed)
    return { blocked: true, attemptsLeft: 0, retryAfterSec: retryAfter }
  }

  return { blocked: false, attemptsLeft: MAX_ATTEMPTS - cnt, retryAfterSec: 0 }
}

export async function recordAttempt(
  db: D1Database,
  ip: string,
  email: string,
  success: boolean
): Promise<void> {
  await ensureTable(db)
  await db.prepare(
    `INSERT INTO login_attempts (ip, email, success) VALUES (?, ?, ?)`
  ).bind(ip, email.toLowerCase(), success ? 1 : 0).run()
  // En login exitoso, borrar intentos fallidos previos de esta IP
  if (success) {
    await db.prepare(
      `DELETE FROM login_attempts WHERE ip = ? AND success = 0`
    ).bind(ip).run()
  }
}

export function getClientIp(c: { req: { header: (h: string) => string | undefined } }): string {
  // Cloudflare pone la IP real en CF-Connecting-IP
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0].trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  )
}
