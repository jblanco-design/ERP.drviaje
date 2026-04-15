import { Hono } from 'hono'
import { getUser } from './lib/auth'
import auth from './routes/auth'
import dashboard from './routes/dashboard'
import files from './routes/files'
import clientes from './routes/clientes'
import tesoreria from './routes/tesoreria'
import bancos from './routes/bancos'
import gastos from './routes/gastos'
import reportes from './routes/reportes'
import admin from './routes/admin'
import pasajeros from './routes/pasajeros'
import liquidaciones from './routes/liquidaciones'

type Bindings = { DB: D1Database; JWT_SECRET?: string }

const app = new Hono<{ Bindings: Bindings }>()

// ── Middleware 1: Security headers (todas las respuestas) ────
app.use('*', async (c, next) => {
  await next()
  // Previene que el navegador renderice la respuesta en un iframe (clickjacking)
  c.res.headers.set('X-Frame-Options', 'DENY')
  // Previene MIME-type sniffing
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  // Fuerza HTTPS por 1 año (solo activo en producción HTTPS)
  c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // Limita info del referrer
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Deshabilita características de navegador no necesarias
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Content Security Policy — solo recursos de orígenes conocidos
  c.res.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "font-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net data:",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '))
  // Eliminar header que revela tecnología
  c.res.headers.delete('X-Powered-By')
})

// ── Middleware 2: Log de acceso (solo errores 4xx/5xx) ───────
app.use('*', async (c, next) => {
  await next()
  const status = c.res.status
  if (status >= 400) {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown'
    console.warn(`[ACCESS] ${status} ${c.req.method} ${c.req.path} — IP: ${ip}`)
  }
})

// ── Rutas públicas ───────────────────────────────────────────
app.route('/', auth)

// Redirect raíz
app.get('/', async (c) => {
  const user = await getUser(c)
  if (user) return c.redirect('/dashboard')
  return c.redirect('/login')
})

// ── Rutas protegidas ─────────────────────────────────────────
app.route('/', dashboard)
app.route('/', files)
app.route('/', clientes)
app.route('/', tesoreria)
app.route('/', bancos)
app.route('/', gastos)
app.route('/', reportes)
app.route('/', admin)
app.route('/', pasajeros)
app.route('/', liquidaciones)

export default app
