import { Hono } from 'hono'
import { verifyPassword, createToken, setAuthCookie, clearAuthCookie, hashPassword, revokeToken, getUser } from '../lib/auth'
import { checkRateLimit, recordAttempt, getClientIp } from '../lib/ratelimit'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database; JWT_SECRET?: string }

const auth = new Hono<{ Bindings: Bindings }>()

// ── GET /login ───────────────────────────────────────────────
auth.get('/login', (c) => {
  const errorCode = c.req.query('error') || ''
  const errorMsg: Record<string, string> = {
    invalid:  'Email o contraseña incorrectos.',
    locked:   'Demasiados intentos fallidos. Esperá 15 minutos antes de volver a intentar.',
    noauth:   'Necesitás iniciar sesión para continuar.',
    inactive: 'Tu cuenta está desactivada. Contactá al administrador.',
    error:    'Error interno. Intentá de nuevo.',
    expired:  'Tu sesión expiró por inactividad. Iniciá sesión nuevamente.',
  }
  const msg = errorMsg[errorCode] || ''

  return c.html(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dr. Viaje ERP - Acceso</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .bg-gradient { background: linear-gradient(135deg, #5a2d75 0%, #7B3FA0 50%, #EC008C 100%); }
  </style>
</head>
<body class="bg-gradient min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-md">
    <div class="text-center mb-8">
      <div class="inline-flex items-center gap-3 mb-2">
        <i class="fas fa-heartbeat text-4xl text-orange-400"></i>
        <div>
          <span style="color:#F7941D;font-size:32px;font-weight:800;">Dr.</span>
          <span style="color:white;font-size:28px;font-weight:700;">Viaje</span>
          <span style="color:#EC008C;font-size:24px;font-weight:800;">.com</span>
        </div>
      </div>
      <p style="color:rgba(255,255,255,0.7);font-size:14px;letter-spacing:2px;">ERP SISTEMA DE GESTIÓN</p>
    </div>

    <div style="background:white;border-radius:20px;padding:40px;box-shadow:0 25px 60px rgba(0,0,0,0.3);">
      <h2 style="color:#5a2d75;font-size:22px;font-weight:700;margin-bottom:6px;">Bienvenido</h2>
      <p style="color:#6b7280;font-size:14px;margin-bottom:28px;">Ingresá tus credenciales para continuar</p>

      ${msg ? `
        <div style="background:#fee2e2;color:#991b1b;padding:12px;border-radius:8px;border-left:4px solid #ef4444;margin-bottom:20px;font-size:13px;">
          <i class="fas fa-exclamation-circle"></i> ${esc(msg)}
        </div>` : ''}

      <form method="POST" action="/login" autocomplete="on">
        <div style="margin-bottom:18px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#5a2d75;margin-bottom:5px;">
            <i class="fas fa-envelope"></i> EMAIL
          </label>
          <input type="email" name="email" required autocomplete="username"
            placeholder="tu@drviaje.com"
            style="width:100%;padding:11px 14px;border:1.5px solid #ddd6f0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;"
            onfocus="this.style.borderColor='#7B3FA0'" onblur="this.style.borderColor='#ddd6f0'">
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#5a2d75;margin-bottom:5px;">
            <i class="fas fa-lock"></i> CONTRASEÑA
          </label>
          <input type="password" name="password" required autocomplete="current-password"
            placeholder="••••••••"
            style="width:100%;padding:11px 14px;border:1.5px solid #ddd6f0;border-radius:8px;font-size:14px;outline:none;box-sizing:border-box;">
        </div>
        <button type="submit"
          style="width:100%;padding:13px;background:linear-gradient(135deg,#7B3FA0,#EC008C);color:white;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;">
          <i class="fas fa-sign-in-alt"></i> Ingresar al Sistema
        </button>
      </form>

      <div style="margin-top:20px;text-align:center;font-size:12px;color:#9ca3af;">
        <i class="fas fa-shield-alt"></i> Acceso seguro · Dr. Viaje ERP v2.0
      </div>
    </div>

    <div style="text-align:center;margin-top:16px;color:rgba(255,255,255,0.5);font-size:12px;">
      Colonia 820, Montevideo, Uruguay · +598 9668 3276
    </div>
  </div>
</body>
</html>`)
})

// ── POST /login ──────────────────────────────────────────────
auth.post('/login', async (c) => {
  const ip = getClientIp(c)
  let email = ''
  let password = ''

  // ── 1. Parsear body ──────────────────────────────────────
  try {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('application/json')) {
      const json = await c.req.json() as any
      email    = (json.email    || '').trim().toLowerCase()
      password = json.password  || ''
    } else {
      const body = await c.req.parseBody()
      email    = String(body.email    || '').trim().toLowerCase()
      password = String(body.password || '')
    }
  } catch {
    return c.redirect('/login?error=error')
  }

  if (!email || !password) return c.redirect('/login?error=invalid')

  // ── 2. Rate limit (tolerante a fallos) ───────────────────
  let attemptsLeft = 5
  try {
    const rl = await checkRateLimit(c.env.DB, ip)
    if (rl.blocked) {
      console.warn(`[SECURITY] Login bloqueado — IP: ${ip}`)
      return c.redirect('/login?error=locked')
    }
    attemptsLeft = rl.attemptsLeft
  } catch (e: any) {
    // Si el rate limit falla, continuamos sin bloquearlo
    console.warn('[RATELIMIT] Error no crítico:', e.message)
  }

  // ── 3. Verificar credenciales ────────────────────────────
  try {
    const user = await c.env.DB.prepare(
      'SELECT id, nombre, email, COALESCE(rol_extendido, rol) as rol, password_hash, activo FROM usuarios WHERE email = ? AND activo = 1'
    ).bind(email).first() as any

    if (!user) {
      try { await recordAttempt(c.env.DB, ip, email, false) } catch { /* ignorar */ }
      return c.redirect('/login?error=invalid')
    }

    const valid = await verifyPassword(password, user.password_hash)

    if (!valid) {
      try { await recordAttempt(c.env.DB, ip, email, false) } catch { /* ignorar */ }
      console.warn(`[SECURITY] Login fallido — IP: ${ip}, email: ${email}, intentos restantes: ${attemptsLeft - 1}`)
      return c.redirect('/login?error=invalid')
    }

    // ── Login exitoso ────────────────────────────────────
    try { await recordAttempt(c.env.DB, ip, email, true) } catch { /* ignorar */ }

    // Migrar hash legacy (SHA-256 → PBKDF2) al vuelo
    if (!user.password_hash.startsWith('pbkdf2$')) {
      try {
        const newHash = await hashPassword(password)
        await c.env.DB.prepare('UPDATE usuarios SET password_hash=? WHERE id=?')
          .bind(newHash, user.id).run()
        console.log(`[SECURITY] Password de ${email} migrado a PBKDF2`)
      } catch { /* no crítico */ }
    }

    const token = await createToken(c, {
      id: user.id, nombre: user.nombre, email: user.email, rol: user.rol
    })
    setAuthCookie(c, token)
    return c.redirect('/dashboard')

  } catch (e: any) {
    console.error('[LOGIN ERROR]', e.message)
    return c.redirect('/login?error=error')
  }
})

// ── GET /logout ──────────────────────────────────────────────
auth.get('/logout', async (c) => {
  try {
    const { getCookie } = await import('hono/cookie')
    const token = getCookie(c, 'auth_token')
    if (token) {
      // Decodificar payload sin verificar blacklist (evitar recursión)
      try {
        const parts = token.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(
            new TextDecoder().decode(
              new Uint8Array([...atob(parts[1].replace(/-/g,'+').replace(/_/g,'/').padEnd(
                parts[1].length + (4 - parts[1].length % 4) % 4, '='
              ))].map(c => c.charCodeAt(0)))
            )
          )
          if (payload?.id) {
            await revokeToken(c, token, payload.id as number)
          }
        }
      } catch { /* ignorar si el token está malformado */ }
    }
  } catch { /* ignorar */ }

  clearAuthCookie(c)
  return c.redirect('/login')
})

export default auth
