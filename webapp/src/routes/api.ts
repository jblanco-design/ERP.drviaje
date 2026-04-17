// ============================================================
// Dr. Viaje ERP — API Externa v1
// Autenticación: header X-API-Key
// Base path: /api/v1/
// ============================================================

import { Hono } from 'hono'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }

const api = new Hono<{ Bindings: Bindings }>()

// ── Helper: verificar API key ─────────────────────────────────
async function verificarApiKey(c: any): Promise<{ valida: boolean; nombre?: string; error?: string }> {
  const apiKey = c.req.header('X-API-Key') || c.req.header('x-api-key')

  if (!apiKey) return { valida: false, error: 'Header X-API-Key requerido' }
  if (!apiKey.startsWith('drv_')) return { valida: false, error: 'API key con formato inválido' }

  // Verificar que la key existe y está activa
  const row = await c.env.DB.prepare(
    `SELECT id, nombre FROM api_keys WHERE key_hash = ? AND activa = 1 LIMIT 1`
  ).bind(apiKey).first() as any

  if (!row) return { valida: false, error: 'API key inválida o inactiva' }

  // Actualizar último uso
  await c.env.DB.prepare(
    `UPDATE api_keys SET ultimo_uso = datetime('now') WHERE id = ?`
  ).bind(row.id).run().catch(() => {})

  return { valida: true, nombre: row.nombre }
}

// ── Normalizar documento: sin puntos, guiones ni espacios ───────
function normalizarDoc(tipo: string, nro: string): string {
  if (!nro) return ''
  if (tipo === 'CI') return nro.replace(/[^0-9]/g, '')
  return nro.trim().toUpperCase().replace(/[.\-\s]/g, '')
}

// ── CORS para APIs externas ───────────────────────────────────
api.use('/api/v1/*', async (c, next) => {
  await next()
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key')
})

api.options('/api/v1/*', (c) => c.text('', 204))

// ══════════════════════════════════════════════════════════════
// GET /api/v1/customers/search?documentType=CI&documentNumber=4.587.757-9
// Busca un cliente por tipo y número de documento.
// Respuesta 200: { id, firstName, lastName, fullName, documentType, documentNumber, email, phone }
// Respuesta 404: { error: 'Not Found' }
// Respuesta 400: { error: '...' }
// Respuesta 401: { error: '...' }
// ══════════════════════════════════════════════════════════════
api.get('/api/v1/customers/search', async (c) => {
  const auth = await verificarApiKey(c)
  if (!auth.valida) {
    return c.json({ error: auth.error }, 401)
  }

  const tipoDoc = (c.req.query('documentType')   || '').trim().toUpperCase()
  const nroDoc  = (c.req.query('documentNumber') || '').trim()

  if (!tipoDoc || !nroDoc) {
    return c.json({ error: 'Required params: documentType and documentNumber' }, 400)
  }

  const TIPOS_VALIDOS = ['CI', 'PAS', 'DNI', 'RUT', 'NIF', 'OTRO']
  if (!TIPOS_VALIDOS.includes(tipoDoc)) {
    return c.json({ error: `Invalid documentType. Accepted values: ${TIPOS_VALIDOS.join(', ')}` }, 400)
  }

  const nroNormalizado = normalizarDoc(tipoDoc, nroDoc)

  try {
    const cliente = await c.env.DB.prepare(`
      SELECT id,
             COALESCE(nombre, '') as nombre,
             COALESCE(apellido, '') as apellido,
             COALESCE(nombre_completo, nombre || ' ' || apellido) as nombre_completo,
             tipo_documento,
             nro_documento,
             email,
             telefono
      FROM clientes
      WHERE tipo_documento = ? AND nro_documento = ?
      LIMIT 1
    `).bind(tipoDoc, nroNormalizado).first() as any

    if (!cliente) {
      return c.json({ error: 'Not Found' }, 404)
    }

    return c.json({
      id:             cliente.id,
      firstName:      cliente.nombre,
      lastName:       cliente.apellido,
      fullName:       cliente.nombre_completo,
      documentType:   cliente.tipo_documento,
      documentNumber: cliente.nro_documento,
      email:          cliente.email    || null,
      phone:          cliente.telefono || null,
    })
  } catch (e: any) {
    console.error('[API] customers/search error:', e.message)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// POST /api/v1/customers
// Crea un cliente nuevo.
// Body JSON: { firstName, lastName, clientType, documentType, documentNumber }
// Respuesta 201: { id, firstName, lastName, fullName, clientType, documentType, documentNumber }
// Respuesta 409: { error: 'Conflict', ... }  → documento duplicado
// Respuesta 400: { error: 'Bad Request', message: '...' }
// Respuesta 401: { error: '...' }
// ══════════════════════════════════════════════════════════════
api.post('/api/v1/customers', async (c) => {
  const auth = await verificarApiKey(c)
  if (!auth.valida) return c.json({ error: auth.error }, 401)

  let body: any
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400)
  }

  const firstName      = String(body.firstName      || '').trim()
  const lastName       = String(body.lastName       || '').trim()
  const clientType     = String(body.clientType     || '').trim()
  const documentType   = String(body.documentType   || '').trim().toUpperCase()
  const documentNumber = String(body.documentNumber || '').trim()

  if (!firstName)      return c.json({ error: 'Bad Request', message: 'firstName is required' }, 400)
  if (!documentType)   return c.json({ error: 'Bad Request', message: 'documentType is required' }, 400)
  if (!documentNumber) return c.json({ error: 'Bad Request', message: 'documentNumber is required' }, 400)

  const TIPOS_DOC = ['CI', 'PAS', 'DNI', 'RUT', 'NIF', 'OTRO']
  if (!TIPOS_DOC.includes(documentType)) {
    return c.json({ error: 'Bad Request', message: `Invalid documentType. Accepted: ${TIPOS_DOC.join(', ')}` }, 400)
  }

  const tipoCliente = clientType === 'empresa' ? 'empresa' : 'persona_fisica'
  const nroNorm     = normalizarDoc(documentType, documentNumber)

  try {
    const existe = await c.env.DB.prepare(
      `SELECT id FROM clientes WHERE tipo_documento = ? AND nro_documento = ? LIMIT 1`
    ).bind(documentType, nroNorm).first() as any

    if (existe) {
      return c.json({
        error:      'Conflict',
        message:    `A customer with ${documentType} ${nroNorm} already exists`,
        existingId: existe.id
      }, 409)
    }

    const fullName = lastName ? `${firstName} ${lastName}` : firstName

    await c.env.DB.prepare(`
      INSERT INTO clientes (nombre, apellido, nombre_completo, tipo_cliente, tipo_documento, nro_documento, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(firstName, lastName || '', fullName, tipoCliente, documentType, nroNorm).run()

    const nuevo = await c.env.DB.prepare(
      `SELECT id, nombre, apellido, nombre_completo, tipo_cliente, tipo_documento, nro_documento
       FROM clientes WHERE tipo_documento = ? AND nro_documento = ? ORDER BY id DESC LIMIT 1`
    ).bind(documentType, nroNorm).first() as any

    return c.json({
      id:             nuevo.id,
      firstName:      nuevo.nombre,
      lastName:       nuevo.apellido,
      fullName:       nuevo.nombre_completo,
      clientType:     nuevo.tipo_cliente,
      documentType:   nuevo.tipo_documento,
      documentNumber: nuevo.nro_documento,
    }, 201)

  } catch (e: any) {
    console.error('[API] create-customer error:', e.message)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// GET /api/v1/users/search?email=jblanco@drviaje.com
// Busca un usuario del sistema por email.
// Respuesta 200: { id, name, email, role }
// Respuesta 404: { error: 'Not Found' }
// Respuesta 400: { error: 'Bad Request', message: '...' }
// Respuesta 401: { error: '...' }
// ══════════════════════════════════════════════════════════════
api.get('/api/v1/users/search', async (c) => {
  const auth = await verificarApiKey(c)
  if (!auth.valida) return c.json({ error: auth.error }, 401)

  const email = (c.req.query('email') || '').trim().toLowerCase()
  if (!email) return c.json({ error: 'Bad Request', message: 'email param is required' }, 400)

  try {
    const user = await c.env.DB.prepare(
      `SELECT id, nombre, email FROM usuarios WHERE LOWER(email) = ? AND activo = 1 LIMIT 1`
    ).bind(email).first() as any

    if (!user) return c.json({ error: 'Not Found' }, 404)

    return c.json({
      id:    user.id,
      name:  user.nombre,
      email: user.email,
    })
  } catch (e: any) {
    console.error('[API] users/search error:', e.message)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// POST /api/v1/files
// Crea un file nuevo.
// Body JSON: { customerId, sellerId, destinationCode, travelDate }
// Respuesta 201: { fileId, fileNumber }
// Respuesta 400: { error: 'Bad Request', message: '...' }
// Respuesta 404: { error: 'Not Found', message: '...' }  → cliente o vendedor no existe
// Respuesta 401: { error: '...' }
// ══════════════════════════════════════════════════════════════
api.post('/api/v1/files', async (c) => {
  const auth = await verificarApiKey(c)
  if (!auth.valida) return c.json({ error: auth.error }, 401)

  let body: any
  try { body = await c.req.json() } catch {
    return c.json({ error: 'Bad Request', message: 'Invalid JSON body' }, 400)
  }

  const customerId      = Number(body.customerId)
  const sellerId        = Number(body.sellerId)
  const destinationCode = String(body.destinationCode || '').trim()
  const travelDate      = String(body.travelDate      || '').trim()

  // Validaciones
  if (!customerId || isNaN(customerId))
    return c.json({ error: 'Bad Request', message: 'customerId is required and must be a number' }, 400)
  if (!sellerId || isNaN(sellerId))
    return c.json({ error: 'Bad Request', message: 'sellerId is required and must be a number' }, 400)
  if (!destinationCode)
    return c.json({ error: 'Bad Request', message: 'destinationCode is required' }, 400)
  if (!travelDate)
    return c.json({ error: 'Bad Request', message: 'travelDate is required' }, 400)

  // Validar formato de fecha YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate))
    return c.json({ error: 'Bad Request', message: 'travelDate must be in YYYY-MM-DD format' }, 400)

  try {
    // Verificar que el cliente existe
    const cliente = await c.env.DB.prepare(
      `SELECT id FROM clientes WHERE id = ? LIMIT 1`
    ).bind(customerId).first() as any
    if (!cliente) return c.json({ error: 'Not Found', message: `Customer with id ${customerId} not found` }, 404)

    // Verificar que el vendedor existe y está activo
    const vendedor = await c.env.DB.prepare(
      `SELECT id FROM usuarios WHERE id = ? AND activo = 1 LIMIT 1`
    ).bind(sellerId).first() as any
    if (!vendedor) return c.json({ error: 'Not Found', message: `Seller with id ${sellerId} not found or inactive` }, 404)

    // Generar número de file
    const año  = new Date().getFullYear()
    const last = await c.env.DB.prepare(
      `SELECT numero FROM files WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`
    ).bind(`${año}%`).first() as any
    const numero = last
      ? `${año}${String(parseInt(last.numero.replace(String(año), '')) + 1).padStart(3, '0')}`
      : `${año}001`

    // Crear el file
    await c.env.DB.prepare(`
      INSERT INTO files (numero, cliente_id, vendedor_id, estado, destino_principal, fecha_viaje, moneda, created_at, updated_at)
      VALUES (?, ?, ?, 'en_proceso', ?, ?, 'USD', datetime('now'), datetime('now'))
    `).bind(numero, customerId, sellerId, destinationCode, travelDate).run()

    // Actualizar vendedor_id del cliente
    await c.env.DB.prepare(
      `UPDATE clientes SET vendedor_id = ? WHERE id = ?`
    ).bind(sellerId, customerId).run().catch(() => {})

    const newFile = await c.env.DB.prepare(
      `SELECT id FROM files WHERE numero = ? LIMIT 1`
    ).bind(numero).first() as any

    return c.json({
      fileId:     newFile.id,
      fileNumber: numero,
    }, 201)

  } catch (e: any) {
    console.error('[API] create-file error:', e.message)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// ── 404 para rutas de API no encontradas ─────────────────────
api.all('/api/v1/*', (c) => {
  return c.json({ error: 'Endpoint not found' }, 404)
})

export default api
