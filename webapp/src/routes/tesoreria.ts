import { Hono } from 'hono'
import { getUser, canAccessTesoreria, isAdminOrAbove } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }
const tesoreria = new Hono<{ Bindings: Bindings }>()

// ── Middleware de acceso: solo gerente y administración ──────
tesoreria.use('*', async (c, next) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!canAccessTesoreria(user.rol)) {
    return c.html(`
      <div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;">
        <div style="background:white;border-radius:12px;padding:40px;max-width:400px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          <div style="font-size:48px;margin-bottom:16px;">🔒</div>
          <h2 style="color:#dc2626;margin-bottom:12px;">Acceso restringido</h2>
          <p style="color:#6b7280;margin-bottom:24px;">El módulo de Tesorería y Pagos a Proveedores está disponible solo para Gerencia y Administración.</p>
          <a href="/dashboard" style="background:#7B3FA0;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">← Volver al Dashboard</a>
        </div>
      </div>
    `, 403)
  }
  return next()
})

tesoreria.get('/tesoreria', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const tipo   = c.req.query('tipo')   || ''
  const metodoF = c.req.query('metodo') || ''
  const desde  = c.req.query('desde')  || ''
  const hasta  = c.req.query('hasta')  || ''
  const isGerente = isAdminOrAbove(user.rol)

  try {
    let q = `SELECT m.*, f.numero as file_numero,
             COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo) as cliente_nombre,
             pr.nombre as proveedor_nombre, u.nombre as usuario_nombre, b.nombre_entidad as banco_nombre
             FROM movimientos_caja m 
             LEFT JOIN files f ON m.file_id = f.id
             LEFT JOIN clientes cl ON m.cliente_id = cl.id
             LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
             LEFT JOIN usuarios u ON m.usuario_id = u.id
             LEFT JOIN bancos b ON m.banco_id = b.id
             WHERE m.anulado = 0`
    const params: any[] = []
    if (!isGerente) { q += ' AND m.usuario_id = ?'; params.push(user.id) }
    if (tipo)    { q += ' AND m.tipo = ?';   params.push(tipo) }
    if (metodoF) { q += ' AND m.metodo = ?'; params.push(metodoF) }
    if (desde)   { q += ' AND DATE(m.fecha) >= ?'; params.push(desde) }
    if (hasta)   { q += ' AND DATE(m.fecha) <= ?'; params.push(hasta) }
    q += ' ORDER BY m.fecha DESC LIMIT 500'

    const movimientos = await c.env.DB.prepare(q).bind(...params).all()

    // Totales respetando el filtro aplicado
    const totalIngresosUSD  = movimientos.results.filter((m: any) => m.tipo === 'ingreso' && m.moneda === 'USD').reduce((s: number, m: any) => s + Number(m.monto), 0)
    const totalEgresosUSD   = movimientos.results.filter((m: any) => m.tipo === 'egreso'  && m.moneda === 'USD').reduce((s: number, m: any) => s + Number(m.monto), 0)
    const totalIngresosUYU  = movimientos.results.filter((m: any) => m.tipo === 'ingreso' && m.moneda === 'UYU').reduce((s: number, m: any) => s + Number(m.monto), 0)
    const totalEgresosUYU   = movimientos.results.filter((m: any) => m.tipo === 'egreso'  && m.moneda === 'UYU').reduce((s: number, m: any) => s + Number(m.monto), 0)
    const hayFiltroActivo   = !!(tipo || metodoF || desde || hasta)
    const metodoLabel: Record<string,string> = { transferencia:'Transferencia', efectivo:'Efectivo', cheque:'Cheque', tarjeta:'Tarjeta de Crédito', saldo_cc:'Saldo CC' }

    const clientes = await c.env.DB.prepare(`SELECT id, COALESCE(nombre || ' ' || apellido, nombre_completo) as nombre_completo FROM clientes ORDER BY apellido, nombre`).all()
    const proveedores = await c.env.DB.prepare('SELECT id, nombre FROM proveedores WHERE activo=1 ORDER BY nombre').all()
    const fileLista = await c.env.DB.prepare(`SELECT id, numero FROM files WHERE estado != 'anulado' ORDER BY numero DESC LIMIT 50`).all()
    const bancos = await c.env.DB.prepare('SELECT id, nombre_entidad, moneda, activo FROM bancos ORDER BY activo DESC, nombre_entidad ASC').all()

    const rows = movimientos.results.map((m: any) => `
      <tr>
        <td style="font-size:12px;">${esc(m.fecha?.split('T')[0])||''}</td>
        <td>
          <span class="badge ${m.tipo==='ingreso'?'badge-confirmado':'badge-anulado'}">
            ${m.tipo==='ingreso'?'↑ Ingreso':'↓ Egreso'}
          </span>
        </td>
        <td>${esc(m.concepto)}</td>
        <td style="font-size:12px;">${m.file_numero ? `#${esc(m.file_numero)}` : '—'}</td>
        <td style="font-size:12px;">${esc(m.cliente_nombre||m.proveedor_nombre||'—')}</td>
        <td style="font-size:12px;">${esc(m.metodo)}</td>
        <td style="font-size:12px;">${esc(m.banco_nombre)||'—'}</td>
        <td>
          <strong style="color:${m.tipo==='ingreso'?'#059669':'#dc2626'};">
            ${m.tipo==='ingreso'?'+':'-'}$${Number(m.monto).toLocaleString()} ${esc(m.moneda)}
          </strong>
        </td>
        <td style="font-size:11px;color:#9ca3af;">${esc(m.usuario_nombre)||''}</td>
        <td style="white-space:nowrap;">
          ${m.tipo === 'ingreso' && m.file_id ? `
            <a href="/tesoreria/recibo/${m.id}" target="_blank" title="Ver recibo"
               style="display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:600;color:#5a2d75;background:#f3e8ff;border:1px solid #e9d5ff;padding:3px 7px;border-radius:6px;text-decoration:none;margin-right:4px;">
              <i class="fas fa-receipt" style="font-size:10px;"></i> Recibo
            </a>
          ` : ''}
          <button onclick="anularMovimiento(${m.id})" class="btn btn-danger btn-sm" title="Anular">
            <i class="fas fa-ban"></i>
          </button>
        </td>
      </tr>
    `).join('')

    const content = `
      <!-- Stats rápidas -->
      <div class="grid-4" style="margin-bottom:20px;">
        <div class="stat-card" style="${hayFiltroActivo?'border:2px solid #7B3FA0;':''}" >
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">INGRESOS USD${hayFiltroActivo?' <span style="color:#7B3FA0;">(filtrado)</span>':''}</div>
          <div style="font-size:22px;font-weight:800;color:#059669;">$${totalIngresosUSD.toLocaleString()}</div>
          ${totalIngresosUYU > 0 ? `<div style="font-size:12px;color:#059669;margin-top:2px;">+ $${totalIngresosUYU.toLocaleString()} UYU</div>` : ''}
        </div>
        <div class="stat-card" style="${hayFiltroActivo?'border:2px solid #7B3FA0;':''}">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">EGRESOS USD${hayFiltroActivo?' <span style="color:#7B3FA0;">(filtrado)</span>':''}</div>
          <div style="font-size:22px;font-weight:800;color:#dc2626;">$${totalEgresosUSD.toLocaleString()}</div>
          ${totalEgresosUYU > 0 ? `<div style="font-size:12px;color:#dc2626;margin-top:2px;">+ $${totalEgresosUYU.toLocaleString()} UYU</div>` : ''}
        </div>
        <div class="stat-card" style="${hayFiltroActivo?'border:2px solid #7B3FA0;':''}">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">EGRESOS UYU${hayFiltroActivo?' <span style="color:#7B3FA0;">(filtrado)</span>':''}</div>
          <div style="font-size:22px;font-weight:800;color:#dc2626;">$${totalEgresosUYU.toLocaleString()}</div>
        </div>
        <div class="stat-card" style="${hayFiltroActivo?'border:2px solid #7B3FA0;':''}">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">SALDO NETO USD${hayFiltroActivo?' <span style="color:#7B3FA0;">(filtrado)</span>':''}</div>
          <div style="font-size:22px;font-weight:800;color:${(totalIngresosUSD-totalEgresosUSD)>=0?'#059669':'#dc2626'};">
            $${(totalIngresosUSD-totalEgresosUSD).toLocaleString()}
          </div>
        </div>
      </div>
      ${hayFiltroActivo ? `<div style="background:#f3e8ff;border:1px solid #e9d5ff;border-radius:8px;padding:10px 16px;margin-bottom:14px;font-size:13px;color:#7B3FA0;font-weight:600;">
        <i class="fas fa-filter"></i> Mostrando ${movimientos.results.length} movimiento(s) filtrado(s)${metodoF ? ` — Método: <strong>${metodoLabel[metodoF]||metodoF}</strong>` : ''}${tipo ? ` — Tipo: <strong>${tipo}</strong>` : ''}${desde||hasta ? ` — Período: ${desde||'inicio'} → ${hasta||'hoy'}` : ''}
        &nbsp;<a href="/tesoreria" style="color:#7B3FA0;font-weight:700;">[Limpiar filtros]</a>
      </div>` : ''}

      <!-- Filtros -->
      <form method="GET" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:flex-end;">
        <div>
          <label class="form-label">Tipo</label>
          <select name="tipo" class="form-control" style="width:130px;">
            <option value="">Todos</option>
            <option value="ingreso" ${tipo==='ingreso'?'selected':''}>Ingreso</option>
            <option value="egreso"  ${tipo==='egreso'?'selected':''}>Egreso</option>
          </select>
        </div>
        <div>
          <label class="form-label">Método de Pago</label>
          <select name="metodo" class="form-control" style="width:180px;">
            <option value="">Todos los métodos</option>
            <option value="efectivo"      ${metodoF==='efectivo'?'selected':''}>💵 Efectivo</option>
            <option value="transferencia" ${metodoF==='transferencia'?'selected':''}>🏦 Transferencia</option>
            <option value="cheque"        ${metodoF==='cheque'?'selected':''}>📄 Cheque</option>
            <option value="tarjeta"       ${metodoF==='tarjeta'?'selected':''}>💳 Tarjeta de Crédito</option>
            <option value="saldo_cc"      ${metodoF==='saldo_cc'?'selected':''}>🔄 Saldo CC</option>
          </select>
        </div>
        <div>
          <label class="form-label">Desde</label>
          <input type="date" name="desde" value="${desde}" class="form-control">
        </div>
        <div>
          <label class="form-label">Hasta</label>
          <input type="date" name="hasta" value="${hasta}" class="form-control">
        </div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-filter"></i> Filtrar</button>
        <a href="/tesoreria" class="btn btn-outline">Limpiar</a>
        <a href="/tesoreria/proveedores" class="btn btn-outline" style="margin-left:auto;">
          <i class="fas fa-handshake"></i> Pagos a Proveedores
        </a>
        <a href="/tesoreria/tarjetas" class="btn btn-outline" style="color:#d97706;border-color:#d97706;">
          <i class="fas fa-credit-card"></i> Tarjetas en Cartera
        </a>
        <button type="button" onclick="document.getElementById('modal-mov').classList.add('active')" class="btn btn-orange">
          <i class="fas fa-plus"></i> Nuevo Movimiento
        </button>
      </form>

      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-dollar-sign" style="color:#059669"></i> Movimientos de Caja (${movimientos.results.length})</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>File</th><th>Contraparte</th><th>Método</th><th>Banco</th><th>Monto</th><th>Operador</th><th>Acc.</th></tr></thead>
            <tbody>
              ${rows || `<tr><td colspan="10" style="text-align:center;padding:20px;color:#9ca3af;">Sin movimientos</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal -->
      <div class="modal-overlay" id="modal-mov">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">Nuevo Movimiento de Caja</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-mov').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/tesoreria/movimiento">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">TIPO *</label>
                  <select name="tipo" required class="form-control">
                    <option value="ingreso">Ingreso (Recibo)</option>
                    <option value="egreso">Egreso (Pago)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">MÉTODO *</label>
                  <select name="metodo" required class="form-control">
                    <option value="transferencia">Transferencia</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">CONCEPTO *</label>
                <input type="text" name="concepto" required class="form-control" placeholder="Ej: Cobro File #2026001">
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">MONTO *</label>
                  <input type="number" name="monto" required min="0" step="0.01" class="form-control" id="tes-monto">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA</label>
                  <select name="moneda" class="form-control" id="tes-moneda" onchange="tesCambioMoneda(this.value)">
                    <option value="USD">USD — Dólar</option>
                    <option value="UYU">UYU — Peso Uruguayo</option>
                  </select>
                </div>
              </div>
              <!-- Panel cotización: aparece al seleccionar UYU -->
              <div id="tes-panel-cot" style="display:none;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                  <div>
                    <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:4px;"><i class="fas fa-exchange-alt"></i> COTIZACIÓN UYU/USD</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <input type="number" name="cotizacion" id="tes-cot-input" step="0.0001" min="0.0001" class="form-control" style="width:120px;font-weight:700;font-size:15px;" placeholder="43.5000">
                      <span id="tes-cot-badge" style="font-size:11px;color:#0369a1;"></span>
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Equivale a</div>
                    <div id="tes-equiv-usd" style="font-size:18px;font-weight:800;color:#059669;">—</div>
                    <div style="font-size:10px;color:#9ca3af;">USD</div>
                  </div>
                </div>
              </div>
              <input type="hidden" name="cotizacion" id="tes-cot-hidden" value="1">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">FILE (opcional)</label>
                  <select name="file_id" class="form-control">
                    <option value="">— Sin file —</option>
                    ${fileLista.results.map((f: any) => `<option value="${f.id}">#${f.numero}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">BANCO</label>
                  <select name="banco_id" class="form-control">
                    <option value="">— Sin banco —</option>
                    ${bancos.results.map((b: any) => `<option value="${b.id}" ${b.activo===0?'disabled style="color:#9ca3af;"':''} >${b.nombre_entidad} (${b.moneda})${b.activo===0?' — CERRADA':''}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">CLIENTE</label>
                  <select name="cliente_id" class="form-control">
                    <option value="">— Sin cliente —</option>
                    ${clientes.results.map((cl: any) => `<option value="${cl.id}">${cl.nombre_completo}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">PROVEEDOR</label>
                  <select name="proveedor_id" class="form-control">
                    <option value="">— Sin proveedor —</option>
                    ${proveedores.results.map((p: any) => `<option value="${p.id}">${p.nombre}</option>`).join('')}
                  </select>
                </div>
              </div>

              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Registrar</button>
                <button type="button" onclick="document.getElementById('modal-mov').classList.remove('active')" class="btn btn-outline">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
        // ── Cotizaciones del día (cargadas al abrir la página) ────────
        let _cotizacionesHoy = {}
        ;(async function cargarCotizaciones() {
          try {
            const r = await fetch('/api/cotizacion-hoy')
            const d = await r.json()
            if (d.ok) _cotizacionesHoy = d.cotizaciones
          } catch(e) {}
        })()

        function tesCambioMoneda(moneda) {
          const panel  = document.getElementById('tes-panel-cot')
          const hidden = document.getElementById('tes-cot-hidden')
          const input  = document.getElementById('tes-cot-input')
          const badge  = document.getElementById('tes-cot-badge')
          if (moneda === 'UYU') {
            panel.style.display = 'block'
            const cot = _cotizacionesHoy['USD_UYU'] || ''
            input.value = cot ? Number(cot).toFixed(4) : ''
            hidden.value = cot || 1
            badge.textContent = cot ? '✓ Cotización de hoy' : '⚠ No hay cotización para hoy'
            badge.style.color = cot ? '#059669' : '#d97706'
            calcEquivUSD()
          } else {
            panel.style.display = 'none'
            hidden.value = 1
          }
        }

        function calcEquivUSD() {
          const monto = parseFloat(document.getElementById('tes-monto')?.value || '0')
          const cot   = parseFloat(document.getElementById('tes-cot-input')?.value || '0')
          const hidden = document.getElementById('tes-cot-hidden')
          const equiv  = document.getElementById('tes-equiv-usd')
          if (hidden) hidden.value = cot || 1
          if (equiv) {
            if (monto > 0 && cot > 0) {
              equiv.textContent = 'US$ ' + (monto / cot).toLocaleString('es-UY', {minimumFractionDigits:2, maximumFractionDigits:2})
            } else {
              equiv.textContent = '—'
            }
          }
        }

        // Actualizar equivalente cuando cambia monto o cotización
        document.addEventListener('DOMContentLoaded', () => {
          document.getElementById('tes-monto')?.addEventListener('input', calcEquivUSD)
          document.getElementById('tes-cot-input')?.addEventListener('input', () => {
            const hidden = document.getElementById('tes-cot-hidden')
            const v = parseFloat(document.getElementById('tes-cot-input')?.value || '0')
            if (hidden) hidden.value = v || 1
            calcEquivUSD()
          })
        })

        async function anularMovimiento(id) {
          const motivo = prompt('Motivo de anulación:')
          if (!motivo) return
          const r = await fetch('/tesoreria/anular/' + id, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({motivo})})
          if(r.ok) location.reload()
          else alert('Error al anular')
        }
      </script>
    `
    return c.html(baseLayout('Tesorería', content, user, 'tesoreria'))
  } catch (e: any) {
    return c.html(baseLayout('Tesorería', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'tesoreria'))
  }
})

tesoreria.post('/tesoreria/movimiento', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const b = await c.req.parseBody()

  // ── Validación de enums ──────────────────────────────────────
  const TIPOS_VALIDOS   = ['ingreso', 'egreso']
  const METODOS_VALIDOS = ['transferencia', 'efectivo', 'tarjeta', 'cheque']
  const MONEDAS_VALIDAS = ['USD', 'UYU']
  const tipo   = String(b.tipo   || '').trim()
  const metodo = String(b.metodo || '').trim()
  const moneda = String(b.moneda || 'USD').trim()
  if (!TIPOS_VALIDOS.includes(tipo) || !METODOS_VALIDOS.includes(metodo) || !MONEDAS_VALIDAS.includes(moneda)) {
    return c.redirect('/tesoreria?error=datos_invalidos')
  }

  // ── Validación de monto ──────────────────────────────────────
  const monto = Number(b.monto)
  const cot   = Math.max(Number(b.cotizacion || 1), 0.0001)
  if (!isFinite(monto) || monto <= 0) {
    return c.redirect('/tesoreria?error=monto_invalido')
  }

  // ── Validar file_id pertenece al usuario (si aplica) ────────
  const fileIdRaw = b.file_id ? Number(b.file_id) : null
  const safeFileId = (fileIdRaw && Number.isInteger(fileIdRaw) && fileIdRaw > 0) ? fileIdRaw : null
  const redirectTo = safeFileId ? `/files/${safeFileId}` : '/tesoreria'

  if (safeFileId) {
    const fileCheck = await c.env.DB.prepare(
      `SELECT id, vendedor_id FROM files WHERE id = ?`
    ).bind(safeFileId).first() as any
    if (!fileCheck) return c.redirect('/tesoreria?error=file_no_encontrado')
    if (!isAdminOrAbove(user.rol) && fileCheck.vendedor_id != user.id) {
      return c.redirect('/tesoreria?error=sin_permiso')
    }
  }

  try {
    // pasajero_pagador_id: solo para ingresos cuando hay múltiples titulares
    const pagadorId = tipo === 'ingreso' && b.pasajero_pagador_id
      ? Number(b.pasajero_pagador_id) || null
      : null
    const concepto = String(b.concepto || '').trim().substring(0, 500)
    const clienteIdRaw  = b.cliente_id  ? Number(b.cliente_id)  : null
    const proveedorIdRaw = b.proveedor_id ? Number(b.proveedor_id) : null
    const bancoIdRaw    = b.banco_id    ? Number(b.banco_id)    : null

    const res = await c.env.DB.prepare(`
      INSERT INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, proveedor_id, banco_id, concepto, usuario_id, pasajero_pagador_id, fecha)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    `).bind(tipo, metodo, moneda, monto, cot, monto * cot,
      safeFileId, clienteIdRaw, proveedorIdRaw, bancoIdRaw,
      concepto, user.id, pagadorId
    ).run()

    const movId = res.meta?.last_row_id as number

    // Si es INGRESO con TC → registrar tarjetas en cliente_tarjetas
    if (tipo === 'ingreso' && metodo === 'tarjeta' && movId) {
      const tc4Raw  = b['tc_ultimos4']
      const tcMRaw  = b['tc_monto']
      const tcBRaw  = b['tc_banco']
      const tc4List = (Array.isArray(tc4Raw)  ? tc4Raw  : tc4Raw  ? [tc4Raw]  : []).map(String)
      const tcMList = (Array.isArray(tcMRaw)  ? tcMRaw  : tcMRaw  ? [tcMRaw]  : []).map(Number)
      const tcBList = (Array.isArray(tcBRaw)  ? tcBRaw  : tcBRaw  ? [tcBRaw]  : []).map(String)
      // Si solo hay campos simples (sin array), usar el total como una sola tarjeta
      const tieneDetalle = tc4List.length > 0 && tc4List[0]?.trim()
      if (tieneDetalle) {
        for (let i = 0; i < tc4List.length; i++) {
          const ult4  = tc4List[i]?.trim()
          const tmonto = tcMList[i] || 0
          const tbanco = tcBList[i]?.trim() || null
          if (!ult4 || tmonto <= 0) continue
          await c.env.DB.prepare(`
            INSERT INTO cliente_tarjetas (cliente_id, movimiento_id, file_id, ultimos_4, banco_emisor, monto, moneda, concepto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(clienteIdRaw, movId, safeFileId, ult4, tbanco, tmonto, moneda, concepto).run()
        }
      } else {
        // Registrar como una sola tarjeta con los datos del movimiento
        const ultimos4Simple = String(b['tc_ultimos4_simple'] || b['tc_ultimos4'] || '????').trim().substring(0,4)
        const bancoSimple    = String(b['tc_banco_simple']    || b['tc_banco']    || '').trim() || null
        await c.env.DB.prepare(`
          INSERT INTO cliente_tarjetas (cliente_id, movimiento_id, file_id, ultimos_4, banco_emisor, monto, moneda, concepto)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(clienteIdRaw, movId, safeFileId, ultimos4Simple, bancoSimple, monto, moneda, concepto).run()
      }
    }

    // Si es un INGRESO vinculado a un file → redirigir al recibo
    if (tipo === 'ingreso' && safeFileId && movId) {
      return c.redirect(`/tesoreria/recibo/${movId}`)
    }
    return c.redirect(redirectTo)
  } catch (e: any) {
    console.error('[MOVIMIENTO] Error al registrar:', e.message)
    return c.redirect(redirectTo + '?error=movimiento_fallido')
  }
})

// ══════════════════════════════════════════════════════════════
// GET /tesoreria/recibo/:id  — Recibo de pago imprimible
// ══════════════════════════════════════════════════════════════
tesoreria.get('/tesoreria/recibo/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const movIdRaw = Number(c.req.param('id'))
  if (!Number.isInteger(movIdRaw) || movIdRaw <= 0) return c.redirect('/tesoreria')
  const movId = movIdRaw

  try {
    // Datos del movimiento
    const mov = await c.env.DB.prepare(`
      SELECT m.*,
             f.numero   as file_numero,
             f.id       as file_id,
             f.vendedor_id,
             f.destino_principal,
             f.total_venta,
             f.moneda   as file_moneda,
             f.estado   as file_estado,
             f.notas    as file_notas,
             f.fecha_apertura,
             COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente_nombre,
             cl.email   as cliente_email,
             cl.telefono as cliente_tel,
             cl.tipo_documento,
             cl.nro_documento,
             b.nombre_entidad as banco_nombre,
             u.nombre   as operador_nombre,
             pas.nombre_completo as pagador_nombre
      FROM movimientos_caja m
      LEFT JOIN files   f   ON m.file_id    = f.id
      LEFT JOIN clientes cl ON m.cliente_id = cl.id
      LEFT JOIN bancos   b  ON m.banco_id   = b.id
      LEFT JOIN usuarios u  ON m.usuario_id = u.id
      LEFT JOIN pasajeros pas ON m.pasajero_pagador_id = pas.id
      WHERE m.id = ?
    `).bind(movId).first() as any

    if (!mov) return c.redirect('/tesoreria')
    if (mov.tipo !== 'ingreso') return c.redirect(`/files/${mov.file_id || ''}`)

    // Control de acceso: solo el gerente o el vendedor del file puede ver el recibo
    if (!isAdminOrAbove(user.rol) && mov.vendedor_id != null && mov.vendedor_id != user.id) {
      return c.redirect('/tesoreria')
    }

    // Todos los ingresos del file para calcular totales y número correlativo
    const todosIngresos = await c.env.DB.prepare(`
      SELECT id, monto, moneda, fecha
      FROM movimientos_caja
      WHERE file_id = ? AND tipo = 'ingreso' AND (anulado IS NULL OR anulado = 0)
      ORDER BY fecha ASC, id ASC
    `).bind(mov.file_id).all()

    // Número correlativo del recibo dentro del file (posición en la lista)
    const posicion = (todosIngresos.results as any[]).findIndex((r: any) => r.id === Number(movId)) + 1
    const nroRecibo = `${mov.file_numero}-${String(posicion).padStart(2, '0')}`

    // Total cobrado hasta ahora (ingresos anteriores + este)
    const totalCobrado = (todosIngresos.results as any[]).reduce((s: number, r: any) => s + Number(r.monto || 0), 0)
    const saldoPendiente = Math.max(0, Number(mov.total_venta || 0) - totalCobrado)

    // Pagos anteriores (sin este)
    const cobradoAnterior = totalCobrado - Number(mov.monto || 0)

    const metodosLabel: Record<string, string> = {
      efectivo: '💵 Efectivo',
      transferencia: '🏦 Transferencia bancaria',
      tarjeta: '💳 Tarjeta',
      cheque: '📄 Cheque'
    }

    const fechaFormato = new Date(mov.fecha || Date.now()).toLocaleDateString('es-UY', {
      day: '2-digit', month: 'long', year: 'numeric'
    })
    const horaFormato = (mov.fecha || '').substring(11, 16) || new Date().toTimeString().substring(0, 5)

    const reciboHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recibo #${nroRecibo} - Dr. Viaje</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    @media print {
      .no-print { display: none !important; }
      body { margin: 0 !important; background: white !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .recibo-wrap { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; }
      .page-break { page-break-after: always; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      background: #f0ebf8;
      color: #1a1a2e;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* ── Barra top (no imprime) ── */
    .topbar {
      background: #5a2d75;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }

    /* ── Contenedor ── */
    .recibo-wrap {
      max-width: 760px;
      margin: 24px auto;
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(90,45,117,0.15);
    }

    /* ── Header degradado ── */
    .recibo-header {
      background: linear-gradient(135deg, #5a2d75 0%, #7B3FA0 50%, #EC008C 100%) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      padding: 28px 36px;
      position: relative;
      overflow: hidden;
    }
    .recibo-header::before {
      content: 'RECIBO';
      position: absolute;
      right: -10px;
      top: 50%;
      transform: translateY(-50%) rotate(-12deg);
      font-size: 96px;
      font-weight: 900;
      color: rgba(255,255,255,0.05);
      letter-spacing: -4px;
      pointer-events: none;
    }
    .logo-text {
      font-size: 26px;
      font-weight: 900;
      color: white;
      line-height: 1;
    }
    .logo-text span.dot { color: #F7941D; }
    .logo-text span.com { color: #EC008C; }

    /* ── Body ── */
    .recibo-body { padding: 32px 36px; }

    /* ── Número y fecha ── */
    .recibo-id-band {
      background: linear-gradient(90deg, #f3e8ff, #fce7f3) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      border: 1.5px solid #e9d5ff;
      border-radius: 10px;
      padding: 14px 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .nro-recibo {
      font-size: 22px;
      font-weight: 800;
      color: #5a2d75;
    }

    /* ── Secciones ── */
    .section { margin-bottom: 22px; }
    .section-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.5px;
      color: #9ca3af;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .info-box {
      background: #faf7ff !important;
      border: 1.5px solid #e9d5ff;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      border-radius: 10px;
      padding: 14px 18px;
    }
    .client-name {
      font-size: 18px;
      font-weight: 700;
      color: #5a2d75;
      margin-bottom: 4px;
    }
    .client-detail {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.6;
    }

    /* ── Monto destacado ── */
    .monto-band {
      background: linear-gradient(135deg, #5a2d75, #7B3FA0) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      border-radius: 12px;
      padding: 20px 24px;
      text-align: center;
      margin-bottom: 20px;
    }
    .monto-label { color: rgba(255,255,255,0.7); font-size: 12px; letter-spacing: 2px; margin-bottom: 6px; }
    .monto-valor { color: white; font-size: 36px; font-weight: 900; letter-spacing: -1px; }
    .monto-moneda { color: #F7941D; font-size: 18px; font-weight: 700; margin-left: 6px; }
    .monto-letras { color: rgba(255,255,255,0.65); font-size: 11px; margin-top: 4px; font-style: italic; }

    /* ── Tabla de detalle ── */
    .det-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    .det-table td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
    .det-table td:first-child { color: #6b7280; font-weight: 500; width: 45%; }
    .det-table td:last-child { font-weight: 600; color: #1a1a2e; text-align: right; }

    /* ── Resumen de cuenta ── */
    .cuenta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }
    .cuenta-item {
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .cuenta-item .ci-label { font-size: 10px; color: #9ca3af; font-weight: 600; letter-spacing: 1px; margin-bottom: 4px; }
    .cuenta-item .ci-valor { font-size: 16px; font-weight: 800; }

    /* ── Firma ── */
    .firma-area {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 24px;
      padding-top: 20px;
      border-top: 2px dashed #e9d5ff;
    }
    .firma-box {
      text-align: center;
    }
    .firma-linea {
      height: 48px;
      border-bottom: 1.5px solid #d1d5db;
      margin-bottom: 6px;
    }
    .firma-texto { font-size: 11px; color: #9ca3af; }

    /* ── Footer ── */
    .recibo-footer {
      background: #f8f3ff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      border-top: 2px solid #e9d5ff;
      padding: 16px 36px;
      text-align: center;
      font-size: 11px;
      color: #9ca3af;
      line-height: 1.6;
    }

    /* ── Sello PAGADO ── */
    .sello-pagado {
      position: absolute;
      top: 24px;
      right: 36px;
      border: 4px solid #059669;
      color: #059669;
      border-radius: 8px;
      padding: 4px 16px;
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 3px;
      transform: rotate(-12deg);
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <!-- Barra de acción (no imprime) -->
  <div class="topbar no-print">
    <button onclick="window.print()"
      style="background:#F7941D;color:white;border:none;padding:10px 28px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
      🖨 Imprimir / Guardar PDF
    </button>
    <a href="/files/${mov.file_id}"
      style="color:white;font-size:13px;text-decoration:none;opacity:0.8;">
      ← File #${mov.file_numero}
    </a>
    ${mov.cliente_id ? `
    <a href="/clientes/${mov.cliente_id}/cuenta-corriente"
      style="color:rgba(255,255,255,0.85);font-size:13px;text-decoration:none;background:rgba(255,255,255,0.1);padding:6px 14px;border-radius:6px;">
      📋 Cta. Cte. del cliente
    </a>
    ` : ''}
  </div>

  <div class="recibo-wrap" style="position:relative;">

    ${saldoPendiente === 0 ? `<div class="sello-pagado no-print">SALDADO</div>` : ''}

    <!-- ── HEADER ── -->
    <div class="recibo-header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="logo-text">Dr<span class="dot">.</span>Viaje<span class="com">.com</span></div>
          <div style="color:rgba(255,255,255,0.6);font-size:11px;margin-top:4px;">Agencia de Viajes · Montevideo, Uruguay</div>
        </div>
        <div style="text-align:right;">
          <div style="color:rgba(255,255,255,0.65);font-size:10px;letter-spacing:2px;margin-bottom:4px;">DOCUMENTO</div>
          <div style="color:white;font-size:14px;font-weight:700;letter-spacing:1px;">RECIBO DE PAGO</div>
          <div style="color:#F7941D;font-size:11px;margin-top:4px;">drviaje.com · @drviaje.uy</div>
          <div style="color:rgba(255,255,255,0.6);font-size:11px;">+598 9668 3276</div>
        </div>
      </div>
    </div>

    <!-- ── BODY ── -->
    <div class="recibo-body">

      <!-- Nro y fecha -->
      <div class="recibo-id-band">
        <div>
          <div style="font-size:10px;color:#9ca3af;letter-spacing:1px;margin-bottom:2px;">RECIBO Nº</div>
          <div class="nro-recibo">${nroRecibo}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:#9ca3af;letter-spacing:1px;margin-bottom:2px;">FECHA Y HORA</div>
          <div style="font-size:14px;font-weight:700;color:#374151;">${fechaFormato}</div>
          <div style="font-size:12px;color:#9ca3af;">${horaFormato} hs</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:10px;color:#9ca3af;letter-spacing:1px;margin-bottom:2px;">FILE</div>
          <div style="font-size:14px;font-weight:700;color:#7B3FA0;">#${esc(mov.file_numero)}</div>
          ${mov.destino_principal ? `<div style="font-size:11px;color:#9ca3af;">✈ ${esc(mov.destino_principal)}</div>` : ''}
        </div>
      </div>

      <!-- Cliente -->
      <div class="section">
        <div class="section-label">Recibido de</div>
        <div class="info-box">
          <div class="client-name">${esc(mov.pagador_nombre || mov.cliente_nombre)}</div>
          <div class="client-detail">
            ${mov.tipo_documento && mov.nro_documento ? `${esc(mov.tipo_documento)}: <strong>${esc(mov.nro_documento)}</strong>` : ''}
            ${mov.cliente_email ? ` &nbsp;·&nbsp; 📧 ${esc(mov.cliente_email)}` : ''}
            ${mov.cliente_tel   ? ` &nbsp;·&nbsp; 📱 ${esc(mov.cliente_tel)}`   : ''}
            ${mov.pagador_nombre && mov.pagador_nombre !== mov.cliente_nombre
              ? `<br><span style="font-size:11px;color:#7B3FA0;">Pagador del grupo: <strong>${esc(mov.pagador_nombre)}</strong> (file a nombre de ${esc(mov.cliente_nombre)})</span>`
              : ''}
          </div>
        </div>
      </div>

      <!-- Monto destacado -->
      <div class="monto-band">
        <div class="monto-label">LA SUMA DE</div>
        <div class="monto-valor">
          $${Number(mov.monto || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span class="monto-moneda">${esc(mov.moneda || 'USD')}</span>
        </div>
        <div class="monto-letras">${esc(mov.concepto || 'Cobro')}</div>
      </div>

      <!-- Detalle del pago -->
      <div class="section">
        <div class="section-label">Detalle del pago</div>
        <div class="info-box" style="padding:0;">
          <table class="det-table">
            <tr>
              <td>Concepto</td>
              <td>${esc(mov.concepto || '—')}</td>
            </tr>
            <tr>
              <td>Método de pago</td>
              <td>${metodosLabel[mov.metodo] || esc(mov.metodo)}</td>
            </tr>
            ${mov.banco_nombre ? `<tr><td>Banco / Cuenta</td><td>${esc(mov.banco_nombre)}</td></tr>` : ''}
            ${mov.moneda === 'UYU' && mov.cotizacion && mov.cotizacion !== 1 ? `
              <tr>
                <td>Cotización USD</td>
                <td>$${Number(mov.cotizacion).toFixed(2)} UYU</td>
              </tr>
              <tr>
                <td>Equivalente USD</td>
                <td>$${(Number(mov.monto || 0) / Number(mov.cotizacion)).toFixed(2)} USD</td>
              </tr>
            ` : ''}
            <tr>
              <td>Operador que registró</td>
              <td>${esc(mov.operador_nombre || '—')}</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- Resumen de cuenta del file -->
      <div class="section">
        <div class="section-label">Estado de cuenta — File #${esc(mov.file_numero)}</div>
        <div class="cuenta-grid">
          <div class="cuenta-item">
            <div class="ci-label">TOTAL VIAJE</div>
            <div class="ci-valor" style="color:#5a2d75;">$${Number(mov.total_venta || 0).toLocaleString('es-UY', {minimumFractionDigits:2})}</div>
            <div style="font-size:10px;color:#9ca3af;">${esc(mov.file_moneda || 'USD')}</div>
          </div>
          <div class="cuenta-item">
            <div class="ci-label">COBRADO TOTAL</div>
            <div class="ci-valor" style="color:#059669;">$${totalCobrado.toLocaleString('es-UY', {minimumFractionDigits:2})}</div>
            <div style="font-size:10px;color:#9ca3af;">incluye este pago</div>
          </div>
          <div class="cuenta-item">
            <div class="ci-label">SALDO PENDIENTE</div>
            <div class="ci-valor" style="color:${saldoPendiente > 0 ? '#dc2626' : '#059669'};">
              ${saldoPendiente > 0 ? '$' + saldoPendiente.toLocaleString('es-UY', {minimumFractionDigits:2}) : '✓ SALDADO'}
            </div>
            <div style="font-size:10px;color:#9ca3af;">${saldoPendiente === 0 ? 'Pago completo' : esc(mov.file_moneda || 'USD')}</div>
          </div>
        </div>
        ${cobradoAnterior > 0 ? `
          <div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:-8px;margin-bottom:8px;">
            Pagos anteriores: $${cobradoAnterior.toLocaleString('es-UY', {minimumFractionDigits:2})} · 
            Este pago: $${Number(mov.monto||0).toLocaleString('es-UY', {minimumFractionDigits:2})}
          </div>
        ` : ''}
      </div>

      <!-- Firma -->
      <div class="firma-area">
        <div class="firma-box">
          <div class="firma-linea"></div>
          <div class="firma-texto">Firma del cliente / pagador</div>
          <div style="font-size:12px;font-weight:600;color:#374151;margin-top:4px;">${esc(mov.pagador_nombre || mov.cliente_nombre)}</div>
        </div>
        <div class="firma-box">
          <div class="firma-linea"></div>
          <div class="firma-texto">Sello y firma — Dr. Viaje</div>
          <div style="font-size:12px;font-weight:600;color:#374151;margin-top:4px;">${esc(mov.operador_nombre || 'Agente')}</div>
        </div>
      </div>

    </div><!-- /recibo-body -->

    <!-- ── FOOTER ── -->
    <div class="recibo-footer">
      <strong>Dr. Viaje</strong> · Agencia de Viajes · Colonia 820, Montevideo, Uruguay<br>
      📱 +598 9668 3276 &nbsp;·&nbsp; 🌐 drviaje.com &nbsp;·&nbsp; 📸 @drviaje.uy<br>
      <span style="font-size:10px;color:#c4b5d6;margin-top:4px;display:block;">
        Este recibo es comprobante válido de pago. Conserve este documento. Recibo Nº ${nroRecibo} — ${fechaFormato}
      </span>
    </div>

  </div><!-- /recibo-wrap -->

  <script>
    // Auto-imprimir si viene con ?print=1
    if (new URLSearchParams(location.search).get('print') === '1') {
      window.addEventListener('load', () => setTimeout(() => window.print(), 500))
    }
  </script>
</body>
</html>`

    return c.html(reciboHtml)
  } catch (e: any) {
    return c.redirect('/tesoreria')
  }
})

tesoreria.post('/tesoreria/anular/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'ID inválido' }, 400)

  // Verificar que el movimiento existe y el usuario tiene permiso
  const mov = await c.env.DB.prepare(
    `SELECT m.id, f.vendedor_id FROM movimientos_caja m LEFT JOIN files f ON m.file_id = f.id WHERE m.id = ?`
  ).bind(id).first() as any
  if (!mov) return c.json({ error: 'Movimiento no encontrado' }, 404)

  // Solo gerente o el vendedor dueño del file puede anular
  if (!isAdminOrAbove(user.rol) && mov.vendedor_id != null && mov.vendedor_id != user.id) {
    return c.json({ error: 'Sin permiso para anular este movimiento' }, 403)
  }

  const body = await c.req.json() as any
  const motivo = String(body.motivo || 'Anulado').trim().substring(0, 500)
  await c.env.DB.prepare(`UPDATE movimientos_caja SET anulado=1, motivo_anulacion=? WHERE id=?`).bind(motivo, id).run()
  return c.json({ ok: true })
})

// ============================================================
// PAGOS A PROVEEDORES (gestión múltiple y filtrable)
// ============================================================
tesoreria.get('/tesoreria/proveedores', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const provId    = c.req.query('proveedor_id') || ''
  const errorMsg  = c.req.query('error') || ''
  const okMsg     = c.req.query('ok') || ''

  try {
    const proveedores = await c.env.DB.prepare('SELECT id, nombre FROM proveedores WHERE activo=1 ORDER BY nombre').all()
    const bancos = await c.env.DB.prepare('SELECT id, nombre_entidad, moneda, activo FROM bancos ORDER BY activo DESC, nombre_entidad ASC').all()

    // TC Pendientes de autorización (todas, para el panel global)
    const tcPendientesGlobal = await c.env.DB.prepare(`
      SELECT pt.*, p.nombre as proveedor_nombre
      FROM proveedor_tarjetas pt
      JOIN proveedores p ON p.id = pt.proveedor_id
      WHERE pt.estado = 'pendiente'
      ORDER BY pt.created_at DESC
    `).all()

    // Resumen de deuda por proveedor (servicios con costo pendiente de pago)
    const resumenDeuda = await c.env.DB.prepare(`
      SELECT 
        p.id as proveedor_id,
        p.nombre as proveedor_nombre,
        COUNT(DISTINCT s.id) as total_servicios,
        COALESCE(SUM(s.costo_original), 0) as total_costo,
        COALESCE(SUM(CASE WHEN s.prepago_realizado = 1 THEN s.costo_original ELSE 0 END), 0) as total_pagado,
        COALESCE(SUM(CASE WHEN s.prepago_realizado = 0 THEN s.costo_original ELSE 0 END), 0) as total_pendiente,
        s.moneda_origen as moneda
      FROM servicios s
      JOIN proveedores p ON s.proveedor_id = p.id
      JOIN files f ON s.file_id = f.id
      WHERE f.estado != 'anulado' AND s.estado != 'cancelado'
      GROUP BY p.id, p.nombre, s.moneda_origen
      ORDER BY total_pendiente DESC
    `).all()

    // Si hay proveedor seleccionado, traer sus servicios pendientes
    let serviciosPendientes: any[] = []
    let proveedorSeleccionado: any = null
    let saldosPorFile: Record<number, { ingresado: number, gastado: number, disponible: number, moneda: string }> = {}
    if (provId) {
      proveedorSeleccionado = proveedores.results.find((p: any) => p.id == provId)
      const res = await c.env.DB.prepare(`
        SELECT 
          s.id, s.tipo_servicio, s.descripcion, s.nro_ticket, s.costo_original, s.moneda_origen,
          s.fecha_inicio, s.fecha_limite_prepago, s.prepago_realizado,
          s.estado_pago_proveedor, COALESCE(s.monto_tc_asignado,0) as monto_tc_asignado,
          f.numero as file_numero, f.id as file_id,
          COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo, '(sin cliente)') as cliente_nombre
        FROM servicios s
        JOIN files f ON s.file_id = f.id
        LEFT JOIN clientes c ON f.cliente_id = c.id
        WHERE s.proveedor_id = ?
          AND f.estado != 'anulado'
          AND s.estado != 'cancelado'
        ORDER BY s.prepago_realizado ASC, s.fecha_limite_prepago ASC NULLS LAST, f.numero ASC
      `).bind(provId).all()
      serviciosPendientes = res.results as any[]

      // Calcular saldo disponible por file (ingresos cobrados - pagos a proveedores ya realizados)
      const fileIds = [...new Set(serviciosPendientes.map((s: any) => s.file_id))] as number[]
      for (const fid of fileIds) {
        const saldoRow = await c.env.DB.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) as total_ingresado,
            COALESCE(SUM(CASE WHEN tipo = 'egreso'  THEN monto ELSE 0 END), 0) as total_gastado,
            (SELECT moneda FROM files WHERE id = ?) as moneda_file
          FROM movimientos_caja
          WHERE file_id = ? AND anulado = 0
        `).bind(fid, fid).first() as any
        const ingresado = Number(saldoRow?.total_ingresado || 0)
        const gastado   = Number(saldoRow?.total_gastado   || 0)
        saldosPorFile[fid] = {
          ingresado,
          gastado,
          disponible: ingresado - gastado,
          moneda: saldoRow?.moneda_file || 'USD'
        }
      }
    }

    const totalPendienteProveedor = serviciosPendientes
      .filter((s: any) => !s.prepago_realizado)
      .reduce((acc: number, s: any) => acc + Number(s.costo_original || 0), 0)

    const totalPagadoProveedor = serviciosPendientes
      .filter((s: any) => s.prepago_realizado)
      .reduce((acc: number, s: any) => acc + Number(s.costo_original || 0), 0)

    const monedasProveedorSet = new Set(serviciosPendientes.map((s: any) => s.moneda_origen))
    const monedasProveedor = Array.from(monedasProveedorSet).join(' / ')

    // Saldo de cuenta corriente del proveedor seleccionado (para opción saldo_cc en el modal)
    let saldoDisponible = 0
    if (provId) {
      const saldoRow = await c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN tipo='credito' AND estado='confirmado' THEN monto ELSE 0 END),0) as cred,
          COALESCE(SUM(CASE WHEN tipo='debito'  AND estado='confirmado' THEN monto ELSE 0 END),0) as deb
        FROM proveedor_cuenta_corriente WHERE proveedor_id = ?
      `).bind(provId).first() as any
      saldoDisponible = Number(saldoRow?.cred || 0) - Number(saldoRow?.deb || 0)
      if (saldoDisponible < 0) saldoDisponible = 0
    }

    // TCs asignadas a este proveedor (pendientes de autorización o ya autorizadas con saldo)
    let tcAsignadasProveedor: any[] = []
    if (provId) {
      const tcRows = await c.env.DB.prepare(`
        SELECT
          ta.id, ta.monto, ta.moneda, ta.estado as asig_estado,
          ta.servicio_id, ta.file_id,
          COALESCE('****'||ct.ultimos_4, '****'||pt.ultimos_4) as ultimos_4,
          COALESCE(ct.estado, pt.estado) as tc_estado,
          COALESCE(ct.monto, pt.monto) as tc_monto,
          COALESCE(ct.moneda, pt.moneda) as tc_moneda,
          f.numero as file_numero,
          COALESCE(cl.nombre||' '||cl.apellido, cl.nombre_completo) as cliente_nombre,
          s.tipo_servicio, s.descripcion as svc_desc
        FROM tarjeta_asignaciones ta
        LEFT JOIN cliente_tarjetas ct   ON ct.id = ta.cliente_tarjeta_id
        LEFT JOIN proveedor_tarjetas pt ON pt.id = ta.proveedor_tarjeta_id
        LEFT JOIN files f    ON f.id = ta.file_id
        LEFT JOIN clientes cl ON cl.id = f.cliente_id
        LEFT JOIN servicios s ON s.id = ta.servicio_id
        WHERE ta.proveedor_id = ?
          AND ta.estado IN ('tc_enviada','pagado')
        ORDER BY ta.created_at DESC
        LIMIT 100
      `).bind(provId).all().catch(() => ({ results: [] }))
      tcAsignadasProveedor = tcRows.results as any[]
    }

    const iconoServicio: Record<string, string> = {
      aereo: 'fa-plane', hotel: 'fa-bed', traslado: 'fa-car',
      tour: 'fa-map-marked-alt', seguro: 'fa-shield-alt', otro: 'fa-concierge-bell'
    }

    const hoy = new Date().toISOString().split('T')[0]

    // Tarjetas de resumen por proveedor
    const resumenCards = resumenDeuda.results.map((r: any) => `
      <div onclick="window.location.href='/tesoreria/proveedor/${r.proveedor_id}/cuenta'"
           class="proveedor-card"
           style="cursor:pointer;border:2px solid ${Number(r.total_pendiente)>0?'#fecaca':'#d1fae5'};
                  border-radius:12px;padding:16px;background:white;transition:all 0.2s;
                  box-shadow:0 1px 4px rgba(0,0,0,0.06);"
           onmouseover="this.style.borderColor='#7B3FA0';this.style.boxShadow='0 4px 16px rgba(123,63,160,0.15)'"
           onmouseout="this.style.borderColor='${Number(r.total_pendiente)>0?'#fecaca':'#d1fae5'}';this.style.boxShadow='0 1px 4px rgba(0,0,0,0.06)'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-weight:800;color:#1a1a2e;font-size:14px;">${esc(r.proveedor_nombre)}</div>
            <div style="font-size:11px;color:#9ca3af;">${r.total_servicios} servicio(s) · ${r.moneda}</div>
          </div>
          <div style="text-align:right;">
            ${Number(r.total_pendiente) > 0 
              ? `<div style="font-size:16px;font-weight:800;color:#dc2626;">$${Number(r.total_pendiente).toLocaleString()}</div>
                 <div style="font-size:10px;color:#dc2626;font-weight:600;">PENDIENTE</div>`
              : `<div style="font-size:14px;font-weight:700;color:#059669;">✓ Sin deuda</div>`
            }
          </div>
        </div>
        <div style="display:flex;gap:12px;font-size:11px;flex-wrap:wrap;align-items:center;">
          <span style="color:#6b7280;">Costo total: <strong>$${Number(r.total_costo).toLocaleString()}</strong></span>
          <span style="color:#059669;">Pagado: <strong>$${Number(r.total_pagado).toLocaleString()}</strong></span>
          <span style="font-size:10px;color:#7B3FA0;background:#f3e8ff;padding:2px 8px;border-radius:8px;font-weight:700;margin-left:auto;">
            <i class="fas fa-book"></i> Ver Cta. Cte. →
          </span>
        </div>
      </div>
    `).join('')

    // Tabla de servicios del proveedor seleccionado
    const serviciosRows = serviciosPendientes.map((s: any) => {
      const vencido = s.fecha_limite_prepago && s.fecha_limite_prepago < hoy && !s.prepago_realizado
      const epProv  = s.estado_pago_proveedor || 'pendiente'
      const estadoRow = epProv
      // Colores de fila según estado
      let bgFila = 'white'
      if (epProv === 'pagado') bgFila = '#f0fdf4'
      else if (epProv === 'tc_negada') bgFila = '#fff5f5'
      else if (epProv === 'tc_enviada') bgFila = '#fffbeb'
      else if (vencido) bgFila = '#fff5f5'
      // data-* en minúsculas para búsqueda case-insensitive
      const dataFile    = s.file_numero.toLowerCase()
      const dataCliente = s.cliente_nombre.toLowerCase()
      const dataDesc    = s.descripcion.toLowerCase()
      const dataTick    = (s.nro_ticket || '').toLowerCase()
      const dataTipo    = s.tipo_servicio.toLowerCase()
      return `
        <tr data-file="${dataFile}" data-cliente="${dataCliente}" data-desc="${dataDesc}"
            data-ticket="${dataTick}" data-tipo="${dataTipo}" data-estado="${estadoRow}"
            style="background:${bgFila};">
          <td style="padding:8px 12px;">
            ${(epProv !== 'pagado' && epProv !== 'tc_enviada' && epProv !== 'tc_negada') ? `
              <input type="checkbox" class="servicio-check" value="${s.id}" 
                     data-monto="${s.costo_original}" data-moneda="${s.moneda_origen}"
                     data-desc="${s.descripcion.replace(/"/g,'&quot;')}"
                     data-file="#${s.file_numero}"
                     data-file-id="${s.file_id}"
                     data-saldo-disponible="${saldosPorFile[s.file_id]?.disponible ?? 0}"
                     data-saldo-ingresado="${saldosPorFile[s.file_id]?.ingresado ?? 0}"
                     data-saldo-gastado="${saldosPorFile[s.file_id]?.gastado ?? 0}"
                     onchange="actualizarSeleccion()"
                     style="width:16px;height:16px;cursor:pointer;accent-color:#7B3FA0;">
            ` : (epProv === 'pagado' ? `<i class="fas fa-check-circle" style="color:#059669;" title="Pagado"></i>`
                : epProv === 'tc_enviada' ? `<i class="fas fa-paper-plane" style="color:#d97706;" title="TC Enviada"></i>`
                : epProv === 'tc_negada' ? `<i class="fas fa-times-circle" style="color:#dc2626;" title="TC Negada"></i>`
                : `<i class="fas fa-circle" style="color:#9ca3af;" title="${epProv}"></i>`)}
          </td>
          <td>
            <span class="badge badge-cotizacion" style="font-size:10px;">
              <i class="fas ${iconoServicio[s.tipo_servicio] || 'fa-cog'}"></i> ${s.tipo_servicio}
            </span>
          </td>
          <td>
            <div style="font-weight:600;font-size:13px;">${esc(s.descripcion)}</div>
            ${s.nro_ticket ? `<div style="font-size:11px;color:#7B3FA0;margin-top:2px;">🎫 ${esc(s.nro_ticket)}</div>` : ''}
            ${Number(s.monto_tc_asignado||0) > 0 ? `<div style="font-size:10px;color:#d97706;margin-top:1px;"><i class="fas fa-credit-card"></i> TC asignada: $${Number(s.monto_tc_asignado).toFixed(2)}</div>` : ''}
          </td>
          <td style="font-size:12px;">
            <a href="/files/${s.file_id}" style="color:#7B3FA0;font-weight:700;">#${esc(s.file_numero)}</a>
            <div style="font-size:11px;color:#9ca3af;">${esc(s.cliente_nombre)}</div>
            ${(() => {
              const sf = saldosPorFile[s.file_id]
              if (!sf) return ''
              const disp = sf.disponible
              const color = disp >= Number(s.costo_original) ? '#059669' : disp > 0 ? '#d97706' : '#dc2626'
              return `<div style="font-size:10px;font-weight:700;color:${color};margin-top:2px;">
                Disp: $${disp.toLocaleString()} ${sf.moneda}
              </div>`
            })()}
          </td>
          <td style="font-size:12px;color:#6b7280;">${s.fecha_inicio || '—'}</td>
          <td>
            ${s.fecha_limite_prepago ? `
              <span style="font-size:11px;font-weight:700;color:${vencido && epProv==='pendiente' ? '#dc2626' : '#6b7280'};">
                ${vencido && epProv==='pendiente' ? '⚠ ' : ''}${s.fecha_limite_prepago}
              </span>
            ` : `<span style="color:#9ca3af;font-size:11px;">—</span>`}
          </td>
          <td>
            <strong style="color:${epProv==='pagado' ? '#059669' : epProv==='tc_negada' ? '#dc2626' : epProv==='tc_enviada' ? '#d97706' : '#dc2626'};font-size:13px;">
              $${Number(s.costo_original).toLocaleString()} ${s.moneda_origen}
            </strong>
          </td>
          <td>
            ${epProv === 'pagado'
              ? `<span class="badge badge-confirmado" style="font-size:10px;">✓ PAGADO</span>`
              : epProv === 'tc_enviada'
              ? `<span class="badge" style="font-size:10px;background:#fffbeb;color:#92400e;border:1px solid #f59e0b;">⏳ TC Enviada</span>`
              : epProv === 'tc_negada'
              ? `<span class="badge" style="font-size:10px;background:#fff5f5;color:#dc2626;border:1px solid #fca5a5;">✗ TC Negada</span>`
              : `<span class="badge badge-anulado" style="font-size:10px;">PENDIENTE</span>`
            }
          </td>
        </tr>
      `
    }).join('')

    const content = `
      ${okMsg === '1' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> <strong>Pago registrado correctamente.</strong> Los servicios fueron marcados como pagados.</div>` : ''}
      ${okMsg === 'tc_pendiente' ? `<div style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#92400e;">
        <i class="fas fa-credit-card"></i> <strong>Tarjeta asignada al proveedor.</strong> La TC queda registrada como enviada. Un gerente deberá autorizarla o rechazarla desde esta vista.
      </div>` : ''}
      ${okMsg === 'tc_autorizada' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> <strong>Tarjeta autorizada.</strong> Los servicios asociados fueron marcados como pagados y se registró el egreso en caja.</div>` : ''}
      ${okMsg === 'tc_rechazada' ? `<div style="background:#fff5f5;border:2px solid #fca5a5;border-radius:8px;padding:12px 16px;margin-bottom:16px;color:#dc2626;">
        <i class="fas fa-times-circle"></i> <strong>Tarjeta rechazada.</strong> Los servicios asociados fueron marcados como TC Negada y se generaron alertas para el vendedor.
      </div>` : ''}
      ${errorMsg === 'sin_servicios' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> <strong>Seleccioná al menos un servicio</strong> de la tabla antes de registrar el pago.</div>` : ''}
      ${errorMsg === 'monto_invalido' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> <strong>El monto debe ser mayor a cero.</strong></div>` : ''}
      ${errorMsg === 'saldo_cc_insuficiente' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> <strong>Saldo insuficiente en Cuenta Corriente.</strong> El monto ingresado supera el saldo disponible del proveedor.</div>` : ''}
      ${errorMsg && errorMsg !== 'sin_servicios' && errorMsg !== 'monto_invalido' && errorMsg !== 'saldo_cc_insuficiente' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> Error: ${esc(errorMsg)}</div>` : ''}
      <div style="margin-bottom:20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <a href="/tesoreria" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver a Tesorería</a>
        <span style="color:#9ca3af;">|</span>
        <span style="font-size:16px;font-weight:700;color:#1a1a2e;"><i class="fas fa-handshake" style="color:#F7941D;"></i> Gestión de Pagos a Proveedores</span>
        ${tcPendientesGlobal.results.length > 0 ? `
          <a href="#panel-tc-pendientes" style="margin-left:auto;background:#fff3cd;color:#92400e;border:1.5px solid #f59e0b;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;text-decoration:none;">
            <i class="fas fa-credit-card"></i> ${tcPendientesGlobal.results.length} TC Pendiente(s)
          </a>
        ` : ''}
      </div>

      ${tcPendientesGlobal.results.length > 0 && isAdminOrAbove(user.rol) ? `
        <!-- Panel TC Pendientes Globales (solo gerente) -->
        <div id="panel-tc-pendientes" class="card" style="margin-bottom:24px;border:2px solid #f59e0b;">
          <div class="card-header" style="background:#fffbeb;">
            <span class="card-title"><i class="fas fa-credit-card" style="color:#d97706;"></i> Tarjetas de Crédito Pendientes de Autorización</span>
            <span style="font-size:12px;color:#92400e;font-weight:700;">${tcPendientesGlobal.results.length} tarjeta(s) esperando confirmación del proveedor</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#fef3c7;font-size:11px;color:#6b7280;text-transform:uppercase;">
                  <th style="padding:8px 12px;text-align:left;">Proveedor</th>
                  <th style="padding:8px 12px;text-align:left;">Tarjeta</th>
                  <th style="padding:8px 12px;text-align:left;">Banco Emisor</th>
                  <th style="padding:8px 12px;text-align:left;">Monto</th>
                  <th style="padding:8px 12px;text-align:left;">Fecha Cargo</th>
                  <th style="padding:8px 12px;text-align:left;">Acción</th>
                </tr>
              </thead>
              <tbody>
                ${tcPendientesGlobal.results.map((t: any) => `
                  <tr style="background:#fffbeb;border-bottom:1px solid #fde68a;">
                    <td style="padding:8px 12px;">
                      <a href="/tesoreria/proveedor/${t.proveedor_id}/cuenta" style="color:#7B3FA0;font-weight:700;font-size:13px;">
                        ${esc(t.proveedor_nombre)}
                      </a>
                    </td>
                    <td style="padding:8px 12px;font-size:13px;font-weight:700;">
                      <i class="fas fa-credit-card" style="color:#EC008C;"></i> TC **** ${esc(t.ultimos_4)}
                    </td>
                    <td style="padding:8px 12px;font-size:12px;color:#6b7280;">${esc(t.banco_emisor || '—')}</td>
                    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#d97706;">
                      $${Number(t.monto).toLocaleString('es-UY',{minimumFractionDigits:2})} ${t.moneda}
                    </td>
                    <td style="padding:8px 12px;font-size:12px;color:#6b7280;">${t.fecha_cargo || ''}</td>
                    <td style="padding:8px 12px;">
                      <div style="display:flex;gap:6px;">
                        <form method="POST" action="/tesoreria/proveedor/${t.proveedor_id}/cuenta/autorizar-tc" style="display:inline;">
                          <input type="hidden" name="tc_id" value="${t.id}">
                          <input type="hidden" name="accion" value="autorizar">
                          <button type="submit" style="padding:4px 10px;background:#059669;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;">
                            <i class="fas fa-check"></i> Autorizada
                          </button>
                        </form>
                        <form method="POST" action="/tesoreria/proveedor/${t.proveedor_id}/cuenta/autorizar-tc" style="display:inline;">
                          <input type="hidden" name="tc_id" value="${t.id}">
                          <input type="hidden" name="accion" value="rechazar">
                          <button type="submit" style="padding:4px 10px;background:#dc2626;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;">
                            <i class="fas fa-times"></i> Rechazada
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : (tcPendientesGlobal.results.length > 0 ? `
        <div style="background:#fff3cd;border:1.5px solid #f59e0b;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#92400e;">
          <i class="fas fa-credit-card"></i> Hay <strong>${tcPendientesGlobal.results.length} tarjeta(s)</strong> pendientes de autorización. Un gerente debe revisarlas en la Cuenta Corriente de cada proveedor.
        </div>
      ` : '')}

      <!-- Selector de proveedor (top) -->
      <form method="GET" style="margin-bottom:24px;">
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
          <div>
            <label class="form-label">FILTRAR POR PROVEEDOR</label>
            <select name="proveedor_id" class="form-control" style="width:280px;" onchange="this.form.submit()">
              <option value="">— Ver resumen de todos —</option>
              ${proveedores.results.map((p: any) => `<option value="${p.id}" ${provId == p.id ? 'selected' : ''}>${p.nombre}</option>`).join('')}
            </select>
          </div>
          ${provId ? `<a href="/tesoreria/proveedores" class="btn btn-outline"><i class="fas fa-times"></i> Limpiar</a>` : ''}
        </div>
      </form>

      ${!provId ? `
        <!-- Vista resumen general -->
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-chart-pie" style="color:#7B3FA0"></i> Resumen de Deuda por Proveedor</span>
          </div>
          <div class="card-body">
            ${resumenDeuda.results.length === 0 
              ? `<div style="text-align:center;padding:30px;color:#9ca3af;">Sin servicios registrados</div>`
              : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">${resumenCards}</div>`
            }
          </div>
        </div>
      ` : `
        <!-- Vista detalle de proveedor seleccionado -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:20px;">
          <div class="stat-card">
            <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">PROVEEDOR</div>
            <div style="font-size:18px;font-weight:800;color:#7B3FA0;">${esc(proveedorSeleccionado?.nombre) || '—'}</div>
          </div>
          <div class="stat-card">
            <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">TOTAL PENDIENTE</div>
            <div style="font-size:22px;font-weight:800;color:#dc2626;">$${totalPendienteProveedor.toLocaleString()} <span style="font-size:13px;">${monedasProveedor}</span></div>
          </div>
          <div class="stat-card">
            <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">YA PAGADO</div>
            <div style="font-size:22px;font-weight:800;color:#059669;">$${totalPagadoProveedor.toLocaleString()}</div>
          </div>
        </div>

        <!-- ── SECCIÓN: Tarjetas de Crédito asignadas a este proveedor ── -->
        ${tcAsignadasProveedor.length > 0 ? `
        <div class="card" style="margin-bottom:20px;border:2px solid #c4b5fd;">
          <div class="card-header" style="background:#faf5ff;">
            <span class="card-title"><i class="fas fa-credit-card" style="color:#EC008C;"></i> Tarjetas de Crédito — ${esc(proveedorSeleccionado?.nombre||'')}</span>
            <span style="font-size:12px;color:#7B3FA0;font-weight:700;">${tcAsignadasProveedor.length} registro(s)</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:#f3e8ff;font-size:11px;color:#6b7280;text-transform:uppercase;">
                  <th style="padding:8px 12px;text-align:left;">Tarjeta</th>
                  <th style="padding:8px 12px;text-align:left;">File / Cliente</th>
                  <th style="padding:8px 12px;text-align:left;">Servicio</th>
                  <th style="padding:8px 12px;text-align:right;">Monto Asignado</th>
                  <th style="padding:8px 12px;text-align:left;">Estado TC</th>
                  <th style="padding:8px 12px;text-align:left;">Estado Asig.</th>
                  ${isAdminOrAbove(user.rol) ? '<th style="padding:8px 12px;text-align:left;">Acciones</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${tcAsignadasProveedor.map((ta: any) => {
                  const estadoTC = ta.tc_estado || 'pendiente'
                  const estadoAsig = ta.asig_estado || 'tc_enviada'
                  const colTC = estadoTC==='autorizada' ? '#059669' : estadoTC==='rechazada' ? '#dc2626' : '#d97706'
                  const bgTC  = estadoTC==='autorizada' ? '#f0fdf4' : estadoTC==='rechazada' ? '#fff5f5' : '#fffbeb'
                  const labelTC = estadoTC==='autorizada' ? '✓ Autorizada' : estadoTC==='rechazada' ? '✗ Rechazada' : '⏳ Pendiente'
                  const labelAsig = estadoAsig==='pagado' ? '✓ Pagado' : estadoAsig==='tc_negada' ? '✗ TC Negada' : '⏳ TC Enviada'
                  const colAsig = estadoAsig==='pagado' ? '#059669' : estadoAsig==='tc_negada' ? '#dc2626' : '#d97706'
                  const tcIdNum = ta.cliente_tarjeta_id || ta.proveedor_tarjeta_id
                  const tcTipo  = ta.cliente_tarjeta_id ? 'cliente' : 'proveedor'
                  return `<tr style="border-bottom:1px solid #f3f4f6;background:${bgTC};">
                    <td style="padding:8px 12px;font-weight:700;white-space:nowrap;">
                      <i class="fas fa-credit-card" style="color:#EC008C;margin-right:4px;"></i>
                      TC **** ${esc(ta.ultimos_4||'????')}
                    </td>
                    <td style="padding:8px 12px;">
                      ${ta.file_id ? `<a href="/files/${ta.file_id}" style="color:#7B3FA0;font-weight:700;">#${esc(ta.file_numero||'—')}</a>` : `<span style="color:#9ca3af;">Saldo a favor</span>`}
                      ${ta.cliente_nombre ? `<div style="font-size:11px;color:#9ca3af;">${esc(ta.cliente_nombre)}</div>` : ''}
                    </td>
                    <td style="padding:8px 12px;max-width:220px;">
                      ${ta.servicio_id ? `<span style="font-size:11px;">${esc((ta.tipo_servicio||'').toUpperCase())} ${ta.svc_desc ? '– '+ta.svc_desc.substring(0,40) : ''}</span>` : `<span style="color:#9ca3af;font-style:italic;font-size:11px;">Saldo a favor proveedor</span>`}
                    </td>
                    <td style="padding:8px 12px;text-align:right;font-weight:700;font-size:13px;color:#1e3a5f;">
                      $${Number(ta.monto||0).toLocaleString('es-UY',{minimumFractionDigits:2})} ${esc(ta.moneda||'USD')}
                    </td>
                    <td style="padding:8px 12px;">
                      <span style="font-size:11px;font-weight:700;color:${colTC};background:${bgTC};border:1px solid ${colTC}33;padding:2px 8px;border-radius:12px;">${labelTC}</span>
                    </td>
                    <td style="padding:8px 12px;">
                      <span style="font-size:11px;font-weight:700;color:${colAsig};padding:2px 8px;border-radius:12px;background:${colAsig}15;border:1px solid ${colAsig}33;">${labelAsig}</span>
                    </td>
                    ${isAdminOrAbove(user.rol) ? `<td style="padding:8px 12px;">
                      ${estadoTC === 'pendiente' ? `
                        <div style="display:flex;gap:5px;flex-wrap:nowrap;">
                          <form method="POST" action="/tesoreria/tc/autorizar" style="display:inline;">
                            <input type="hidden" name="tc_id" value="${tcIdNum}">
                            <input type="hidden" name="tc_tipo" value="${tcTipo}">
                            <input type="hidden" name="accion" value="autorizar">
                            <input type="hidden" name="proveedor_id" value="${provId}">
                            <button type="submit" style="padding:3px 9px;background:#059669;color:white;border:none;border-radius:5px;font-size:10px;cursor:pointer;white-space:nowrap;">
                              <i class="fas fa-check"></i> Autorizar
                            </button>
                          </form>
                          <form method="POST" action="/tesoreria/tc/autorizar" style="display:inline;">
                            <input type="hidden" name="tc_id" value="${tcIdNum}">
                            <input type="hidden" name="tc_tipo" value="${tcTipo}">
                            <input type="hidden" name="accion" value="rechazar">
                            <input type="hidden" name="proveedor_id" value="${provId}">
                            <button type="submit" style="padding:3px 9px;background:#dc2626;color:white;border:none;border-radius:5px;font-size:10px;cursor:pointer;white-space:nowrap;">
                              <i class="fas fa-times"></i> Rechazar
                            </button>
                          </form>
                        </div>
                      ` : `<span style="font-size:11px;color:#9ca3af;">—</span>`}
                    </td>` : ''}
                  </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : (provId ? `
        <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#0369a1;">
          <i class="fas fa-info-circle"></i> No hay tarjetas de crédito asignadas a <strong>${esc(proveedorSeleccionado?.nombre||'')}</strong> en este momento.
        </div>
        ` : '')}

        <!-- Barra de selección y pago -->
        <div id="barra-pago" style="display:none;position:sticky;top:0;z-index:100;background:white;border:2px solid #7B3FA0;border-radius:12px;padding:14px 20px;margin-bottom:16px;box-shadow:0 4px 20px rgba(123,63,160,0.2);">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
            <div>
              <span style="font-weight:700;color:#7B3FA0;" id="txt-seleccion">0 servicios seleccionados</span>
              <span style="margin-left:16px;font-size:18px;font-weight:800;color:#F7941D;" id="txt-monto">$0</span>
              <span style="font-size:12px;color:#9ca3af;" id="txt-moneda"></span>
            </div>
            <div style="display:flex;gap:8px;">
              <button onclick="seleccionarTodos()" class="btn btn-outline btn-sm"><i class="fas fa-check-double"></i> Seleccionar pendientes</button>
              <button onclick="abrirModalPago()" class="btn btn-primary btn-sm" id="btn-pagar">
                <i class="fas fa-money-bill-wave"></i> Registrar Pago
              </button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-list-check" style="color:#F7941D"></i> Servicios de ${esc(proveedorSeleccionado?.nombre) || ''} (${serviciosPendientes.length})</span>
            <div style="display:flex;gap:8px;">
              <span style="font-size:12px;color:#6b7280;align-self:center;" id="txt-contador-pendientes">${serviciosPendientes.filter((s: any) => !s.prepago_realizado).length} pendientes de pago</span>
            </div>
          </div>

          <!-- Buscador interno de servicios -->
          <div style="padding:12px 16px;border-bottom:1px solid #ede5f5;background:#faf7ff;">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <div style="position:relative;flex:1;min-width:200px;">
                <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:13px;"></i>
                <input type="text" id="buscador-servicios" 
                       placeholder="Buscar por Nº file, cliente, descripción, ticket..."
                       oninput="filtrarServicios(this.value)"
                       style="width:100%;padding:8px 12px 8px 32px;border:1.5px solid #d8b4fe;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"
                       onfocus="this.style.borderColor='#7B3FA0'" 
                       onblur="this.style.borderColor='#d8b4fe'">
              </div>
              <!-- Filtro rápido por file -->
              <div>
                <select id="filtro-file-select" class="form-control" style="min-width:160px;padding:7px 10px;font-size:13px;" onchange="filtrarPorFile(this.value)">
                  <option value="">— Todos los files —</option>
                  ${[...new Map((serviciosPendientes as any[]).map(s => [s.file_id, s])).values()].map((s: any) => `<option value="${s.file_numero.toLowerCase()}">#${s.file_numero}</option>`).join('')}
                </select>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <button onclick="limpiarBusqueda()" class="btn btn-outline btn-sm" id="btn-limpiar-busqueda" style="display:none;">
                  <i class="fas fa-times"></i> Limpiar
                </button>
                <span id="txt-resultados-filtro" style="font-size:12px;color:#7B3FA0;font-weight:600;"></span>
              </div>
              <div style="display:flex;gap:6px;">
                <button onclick="filtrarSoloEstado('pendiente')" class="btn btn-sm" style="background:#fff5f5;color:#dc2626;border:1px solid #fecaca;">
                  <i class="fas fa-clock"></i> Solo pendientes
                </button>
                <button onclick="filtrarSoloEstado('pagado')" class="btn btn-sm" style="background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;">
                  <i class="fas fa-check"></i> Solo pagados
                </button>
                <button onclick="filtrarSoloEstado('')" class="btn btn-outline btn-sm">
                  <i class="fas fa-list"></i> Todos
                </button>
              </div>
            </div>
          </div>

          <div class="table-wrapper">
            <table id="tabla-servicios-prov">
              <thead>
                <tr>
                  <th style="width:40px;">
                    <input type="checkbox" id="chk-todos" onchange="toggleTodosVisibles(this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:#7B3FA0;" title="Seleccionar/deseleccionar filas visibles">
                  </th>
                  <th>Tipo</th>
                  <th>Servicio / Ticket</th>
                  <th>File / Cliente</th>
                  <th>F. Servicio</th>
                  <th>F. Límite Prepago</th>
                  <th>Costo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody id="tbody-servicios">
                ${serviciosRows || `<tr><td colspan="8" style="text-align:center;padding:30px;color:#9ca3af;">Sin servicios para este proveedor</td></tr>`}
              </tbody>
            </table>
            <div id="sin-resultados" style="display:none;text-align:center;padding:30px;color:#9ca3af;">
              <i class="fas fa-search" style="font-size:24px;margin-bottom:8px;display:block;"></i>
              Sin resultados para esa búsqueda. Los checkboxes marcados se conservan aunque no aparezcan.
            </div>
          </div>
        </div>

        <!-- Modal Pago Múltiple -->
        <div class="modal-overlay" id="modal-pago-multiple">
          <div class="modal" style="max-width:600px;">
            <div class="modal-header">
              <span class="modal-title"><i class="fas fa-money-bill-wave" style="color:#059669"></i> Registrar Pago a ${esc(proveedorSeleccionado?.nombre) || ''}</span>
              <button type="button" class="modal-close" onclick="document.getElementById('modal-pago-multiple').classList.remove('active')">&times;</button>
            </div>
            <div class="modal-body">
              <div id="resumen-pago" style="background:#f8f3ff;border-radius:10px;padding:14px;margin-bottom:16px;">
                <div style="font-size:12px;font-weight:700;color:#7B3FA0;margin-bottom:8px;">SERVICIOS A PAGAR:</div>
                <div id="lista-servicios-pago" style="font-size:13px;color:#374151;"></div>
                <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;">
                  <span style="font-weight:700;color:#374151;">TOTAL:</span>
                  <span style="font-size:18px;font-weight:800;color:#F7941D;" id="total-modal">$0</span>
                </div>
              </div>
              <form method="POST" action="/tesoreria/pago-proveedor" id="form-pago-multiple" onsubmit="return validarFormPago(event)">
                <input type="hidden" name="proveedor_id" value="${provId}">
                <input type="hidden" name="servicios_ids" id="input-servicios-ids">
                <!-- Aviso si no hay servicios seleccionados -->
                <div id="aviso-sin-servicios" style="display:none;background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#dc2626;">
                  <i class="fas fa-exclamation-circle"></i> Seleccioná al menos un servicio de la tabla para asociar al pago.
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">MÉTODO DE PAGO *</label>
                    <select name="metodo" required class="form-control" id="modal-sel-metodo" onchange="toggleModalMetodo(this.value)">
                      <option value="transferencia">Transferencia Bancaria</option>
                      <option value="efectivo">Efectivo</option>
                      <option value="cheque">Cheque</option>
                      <option value="tarjeta">Tarjeta de Crédito (múltiples)</option>
                      ${saldoDisponible > 0 ? `<option value="saldo_cc">Saldo Cuenta Corriente (disponible: $${saldoDisponible.toLocaleString('es-UY',{minimumFractionDigits:2})} USD)</option>` : ''}
                    </select>
                  </div>
                  <div class="form-group" id="modal-campo-banco">
                    <label class="form-label">BANCO / CUENTA DE SALIDA *</label>
                    <select name="banco_id" class="form-control">
                      <option value="">— Sin banco —</option>
                      ${bancos.results.map((b: any) => `<option value="${b.id}" ${b.activo===0?'disabled style="color:#9ca3af;"':''} >${b.nombre_entidad} (${b.moneda})${b.activo===0?' — CERRADA':''}</option>`).join('')}
                    </select>
                  </div>
                </div>
                <!-- Panel Saldo CC (solo si método = saldo_cc) -->
                <div id="modal-panel-saldo-cc" style="display:none;background:#d1fae5;border:2px solid #6ee7b7;border-radius:10px;padding:14px;margin-bottom:14px;">
                  <div style="font-size:12px;font-weight:700;color:#065f46;margin-bottom:6px;">
                    <i class="fas fa-wallet" style="color:#059669;"></i> SALDO DISPONIBLE EN CUENTA CORRIENTE
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <div>
                      <div style="font-size:22px;font-weight:900;color:#059669;">$${saldoDisponible.toLocaleString('es-UY',{minimumFractionDigits:2})} USD</div>
                      <div style="font-size:11px;color:#065f46;">Saldo a favor disponible para descontar</div>
                    </div>
                    <div style="font-size:12px;color:#065f46;max-width:280px;line-height:1.4;">
                      <i class="fas fa-info-circle"></i> Al confirmar, se creará un débito en la Cuenta Corriente del proveedor por el monto indicado.
                    </div>
                  </div>
                  <div style="margin-top:10px;padding-top:10px;border-top:1px solid #6ee7b7;">
                    <label style="font-size:11px;font-weight:700;color:#065f46;display:block;margin-bottom:4px;">MONTO A USAR DEL SALDO CC</label>
                    <input type="number" name="monto_saldo_cc" id="modal-monto-saldo-cc"
                      min="0.01" step="0.01" max="${saldoDisponible.toFixed(2)}"
                      class="form-control" placeholder="0.00"
                      style="max-width:180px;"
                      oninput="calcularRestantePago()">
                    <div style="font-size:11px;color:#065f46;margin-top:4px;">
                      Restante a pagar por otro medio: <strong id="txt-restante-pago">$0.00</strong>
                    </div>
                  </div>
                </div>
                <!-- Panel TCs múltiples (solo si método = tarjeta) -->
                <div id="modal-panel-tc" style="display:none;border:2px solid #c4b5fd;border-radius:10px;padding:14px;margin-bottom:14px;background:#faf7ff;">
                  <div style="font-size:12px;font-weight:700;color:#5a2d75;margin-bottom:10px;">
                    <i class="fas fa-credit-card" style="color:#EC008C;"></i> TARJETAS DE CRÉDITO
                    <span style="font-size:11px;font-weight:400;color:#6b7280;"> — Ingresá cada TC</span>
                  </div>
                  <div id="modal-lista-tc">
                    <div class="modal-fila-tc" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px;">
                      <div>
                        <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">ÚLTIMOS 4</label>
                        <input type="text" name="tc_ultimos4" class="form-control modal-tc-ult4" maxlength="4" placeholder="1234"
                          style="padding:5px 8px;letter-spacing:2px;font-weight:700;" oninput="calcularTotalModalTC()">
                      </div>
                      <div>
                        <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">BANCO</label>
                        <input type="text" name="tc_banco" class="form-control" placeholder="Santander" style="padding:5px 8px;">
                      </div>
                      <div>
                        <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">MONTO</label>
                        <input type="number" name="tc_monto" class="form-control modal-tc-monto" min="0.01" step="0.01" placeholder="0.00"
                          style="padding:5px 8px;" oninput="calcularTotalModalTC()">
                      </div>
                      <div>
                        <button type="button" onclick="eliminarModalTC(this)"
                          style="padding:6px 9px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-size:12px;margin-top:18px;">
                          <i class="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                    <button type="button" onclick="agregarModalTC()"
                      style="padding:5px 12px;background:#7B3FA0;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;">
                      <i class="fas fa-plus"></i> Agregar TC
                    </button>
                    <span style="font-size:12px;font-weight:700;color:#5a2d75;">
                      Total TC: <span id="modal-txt-total-tc" style="color:#EC008C;">$0.00</span>
                    </span>
                  </div>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">MONTO TOTAL A PAGAR *</label>
                    <input type="number" name="monto" id="input-monto-pago" required min="0.01" step="0.01" class="form-control" placeholder="0.00">
                  </div>
                  <div class="form-group">
                    <label class="form-label">MONEDA</label>
                    <select name="moneda" class="form-control">
                      <option value="USD">USD</option>
                      <option value="UYU">UYU</option>
                    </select>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">CONCEPTO / REFERENCIA *</label>
                  <input type="text" name="concepto" required class="form-control" 
                         value="${esc('Pago a ' + (proveedorSeleccionado?.nombre || ''))}" 
                         placeholder="Ej: Pago factura Mayo 2026">
                </div>
                <div class="form-group">
                  <label class="form-label">Nº COMPROBANTE / FACTURA</label>
                  <input type="text" name="referencia" class="form-control" placeholder="Opcional: Nº factura del proveedor">
                </div>
                <!-- Alerta de saldo insuficiente -->
                <div id="alerta-saldo" style="display:none;background:#fff3cd;border:1.5px solid #f59e0b;border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:13px;color:#92400e;">
                  <div style="font-weight:700;margin-bottom:6px;"><i class="fas fa-exclamation-triangle"></i> Saldo insuficiente en algunos files</div>
                  <div id="alerta-saldo-detalle" style="font-size:12px;margin-bottom:8px;"></div>
                  <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;">
                    <input type="checkbox" id="chk-autorizar-saldo" onchange="toggleAutorizacion(this)" style="width:15px;height:15px;">
                    Autorizo continuar con saldo insuficiente
                  </label>
                </div>
                <!-- Campo autorizado por (se muestra si hay saldo insuficiente) -->
                <div id="campo-autorizado-por" style="display:none;" class="form-group">
                  <label class="form-label">AUTORIZADO POR *</label>
                  <input type="text" name="autorizado_por" id="input-autorizado-por" class="form-control"
                    placeholder="Nombre del gerente que autoriza" value="${esc(user.nombre)}">
                  <div style="font-size:11px;color:#6b7280;margin-top:3px;">
                    <i class="fas fa-info-circle"></i> Este pago quedará registrado con la autorización correspondiente.
                  </div>
                </div>
                <div style="display:flex;gap:10px;margin-top:8px;">
                  <button type="submit" class="btn btn-primary" id="btn-confirmar-pago"><i class="fas fa-save"></i> Confirmar Pago</button>
                  <button type="button" onclick="document.getElementById('modal-pago-multiple').classList.remove('active')" class="btn btn-outline">Cancelar</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      `}

      <script>
        function selectProveedor(id) {
          window.location.href = '/tesoreria/proveedores?proveedor_id=' + id
        }

        // ── Buscador de servicios ────────────────────────────────────────
        // Filtra las filas de la tabla pero CONSERVA los checkboxes marcados
        // aunque la fila esté oculta (la selección es persistente).

        function filtrarServicios(texto) {
          const q = texto.trim().toLowerCase()
          const filas = document.querySelectorAll('#tbody-servicios tr[data-file]')
          let visibles = 0

          filas.forEach(function(tr) {
            const hayq = !q
              || tr.dataset.file.includes(q)
              || tr.dataset.cliente.includes(q)
              || tr.dataset.desc.includes(q)
              || tr.dataset.ticket.includes(q)
              || tr.dataset.tipo.includes(q)
            tr.style.display = hayq ? '' : 'none'
            if (hayq) visibles++
          })

          // Feedback visual
          const btn = document.getElementById('btn-limpiar-busqueda')
          const info = document.getElementById('txt-resultados-filtro')
          const sinRes = document.getElementById('sin-resultados')
          if (btn) btn.style.display = q ? 'inline-flex' : 'none'
          if (info) info.textContent = q ? visibles + ' resultado(s)' : ''
          if (sinRes) sinRes.style.display = (q && visibles === 0) ? 'block' : 'none'
        }

        function limpiarBusqueda() {
          const inp = document.getElementById('buscador-servicios')
          const sel = document.getElementById('filtro-file-select')
          if (inp) { inp.value = ''; filtrarServicios('') }
          if (sel) sel.value = ''
        }

        function filtrarPorFile(fileNumero) {
          // Limpia el buscador de texto y filtra exclusivamente por file
          const inp = document.getElementById('buscador-servicios')
          if (inp) inp.value = ''
          const filas = document.querySelectorAll('#tbody-servicios tr[data-file]')
          let visibles = 0
          filas.forEach(function(tr) {
            const match = !fileNumero || tr.dataset.file === fileNumero
            tr.style.display = match ? '' : 'none'
            if (match) visibles++
          })
          const sinRes = document.getElementById('sin-resultados')
          const info   = document.getElementById('txt-resultados-filtro')
          if (info) info.textContent = fileNumero ? visibles + ' resultado(s)' : ''
          if (sinRes) sinRes.style.display = (fileNumero && visibles === 0) ? 'block' : 'none'
          const btn = document.getElementById('btn-limpiar-busqueda')
          if (btn) btn.style.display = fileNumero ? 'inline-flex' : 'none'
        }

        function filtrarSoloEstado(estado) {
          // Limpia búsqueda de texto y filtra por estado
          limpiarBusqueda()
          const filas = document.querySelectorAll('#tbody-servicios tr[data-file]')
          filas.forEach(function(tr) {
            if (!estado) { tr.style.display = ''; return }
            tr.style.display = tr.dataset.estado === estado ? '' : 'none'
          })
          const sinRes = document.getElementById('sin-resultados')
          const visibles = Array.from(filas).filter(tr => tr.style.display !== 'none').length
          if (sinRes) sinRes.style.display = visibles === 0 ? 'block' : 'none'
        }

        // ── Selección y totales ──────────────────────────────────────────
        function actualizarSeleccion() {
          const checks = document.querySelectorAll('.servicio-check:checked')
          const total = Array.from(checks).reduce(function(s, c) {
            return s + parseFloat(c.dataset.monto || '0')
          }, 0)
          const monedas = [...new Set(Array.from(checks).map(function(c) { return c.dataset.moneda }))].join('/')

          const elSel   = document.getElementById('txt-seleccion')
          const elMonto = document.getElementById('txt-monto')
          const elMoneda = document.getElementById('txt-moneda')
          const elBarra = document.getElementById('barra-pago')

          if (elSel) elSel.textContent = checks.length + ' servicio(s) seleccionados'
          if (elMonto) elMonto.textContent = '$' + total.toLocaleString('es-UY', {minimumFractionDigits:2, maximumFractionDigits:2})
          if (elMoneda) elMoneda.textContent = monedas
          if (elBarra) elBarra.style.display = checks.length > 0 ? 'block' : 'none'

          // Detalle en modal
          const lista = Array.from(checks).map(function(c) {
            return '• <strong>' + c.dataset.file + '</strong> — ' + c.dataset.desc
              + ' <span style="color:#7B3FA0;font-weight:700;">$'
              + parseFloat(c.dataset.monto).toLocaleString('es-UY',{minimumFractionDigits:2})
              + ' ' + c.dataset.moneda + '</span>'
          }).join('<br>')

          const elLista   = document.getElementById('lista-servicios-pago')
          const elTotal   = document.getElementById('total-modal')
          const elMontoPago = document.getElementById('input-monto-pago')
          const elIds     = document.getElementById('input-servicios-ids')

          if (elLista) elLista.innerHTML = lista || '<em style="color:#9ca3af;">Ningún servicio seleccionado</em>'
          if (elTotal) elTotal.textContent = '$' + total.toLocaleString('es-UY', {minimumFractionDigits:2, maximumFractionDigits:2})
          if (elMontoPago) elMontoPago.value = total.toFixed(2)
          if (elIds) elIds.value = Array.from(checks).map(function(c) { return c.value }).join(',')

          // ── Verificar saldo disponible por file ──────────────────────────
          const saldosPorFile = {}
          checks.forEach(function(c) {
            const fid = c.dataset.fileId
            if (!fid) return
            if (!saldosPorFile[fid]) {
              saldosPorFile[fid] = {
                file: c.dataset.file,
                disponible: parseFloat(c.dataset.saldoDisponible || '0'),
                ingresado:  parseFloat(c.dataset.saldoIngresado  || '0'),
                gastado:    parseFloat(c.dataset.saldoGastado    || '0'),
                totalServ:  0
              }
            }
            saldosPorFile[fid].totalServ += parseFloat(c.dataset.monto || '0')
          })

          const filesInsuficientes = Object.values(saldosPorFile).filter(function(sf) {
            return sf.disponible < sf.totalServ
          })

          const alertaSaldo   = document.getElementById('alerta-saldo')
          const alertaDetalle = document.getElementById('alerta-saldo-detalle')
          const chkAutorizar  = document.getElementById('chk-autorizar-saldo')
          const campoPor      = document.getElementById('campo-autorizado-por')

          if (filesInsuficientes.length > 0) {
            const detalle = filesInsuficientes.map(function(sf) {
              return '<b>' + sf.file + '</b>: disponible $' + sf.disponible.toLocaleString('es-UY',{minimumFractionDigits:2})
                + ' — cobro servicios $' + sf.totalServ.toLocaleString('es-UY',{minimumFractionDigits:2})
                + ' — <b style="color:#dc2626;">faltan $' + (sf.totalServ - sf.disponible).toLocaleString('es-UY',{minimumFractionDigits:2}) + '</b>'
            }).join('<br>')
            if (alertaSaldo)   alertaSaldo.style.display = 'block'
            if (alertaDetalle) alertaDetalle.innerHTML = detalle
            if (chkAutorizar)  chkAutorizar.checked = false
            if (campoPor)      campoPor.style.display = 'none'
          } else {
            if (alertaSaldo) alertaSaldo.style.display = 'none'
            if (campoPor)    campoPor.style.display = 'none'
          }
        }

        function toggleAutorizacion(chk) {
          const campoPor = document.getElementById('campo-autorizado-por')
          if (campoPor) campoPor.style.display = chk.checked ? 'block' : 'none'
        }

        function toggleModalMetodo(val) {
          const panelTC      = document.getElementById('modal-panel-tc')
          const panelSaldoCC = document.getElementById('modal-panel-saldo-cc')
          const campoBanco   = document.getElementById('modal-campo-banco')
          panelTC.style.display      = val === 'tarjeta'   ? 'block' : 'none'
          panelSaldoCC.style.display = val === 'saldo_cc'  ? 'block' : 'none'
          campoBanco.style.display   = (val === 'tarjeta' || val === 'saldo_cc') ? 'none' : 'block'
          if (val === 'saldo_cc') calcularRestantePago()
        }

        function calcularRestantePago() {
          const totalEl  = document.getElementById('input-monto-pago')
          const ccEl     = document.getElementById('modal-monto-saldo-cc')
          const restEl   = document.getElementById('txt-restante-pago')
          if (!totalEl || !ccEl || !restEl) return
          const total  = parseFloat(totalEl.value) || 0
          const cc     = parseFloat(ccEl.value)    || 0
          const rest   = Math.max(0, total - cc)
          restEl.textContent = '$' + rest.toLocaleString('es-UY', {minimumFractionDigits: 2})
        }

        function agregarModalTC() {
          const lista = document.getElementById('modal-lista-tc')
          const div = document.createElement('div')
          div.className = 'modal-fila-tc'
          div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px;'
          div.innerHTML = \`
            <div>
              <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">ÚLTIMOS 4</label>
              <input type="text" name="tc_ultimos4" class="form-control modal-tc-ult4" maxlength="4" placeholder="1234"
                style="padding:5px 8px;letter-spacing:2px;font-weight:700;" oninput="calcularTotalModalTC()">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">BANCO</label>
              <input type="text" name="tc_banco" class="form-control" placeholder="Santander" style="padding:5px 8px;">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">MONTO</label>
              <input type="number" name="tc_monto" class="form-control modal-tc-monto" min="0.01" step="0.01" placeholder="0.00"
                style="padding:5px 8px;" oninput="calcularTotalModalTC()">
            </div>
            <div>
              <button type="button" onclick="eliminarModalTC(this)"
                style="padding:6px 9px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-size:12px;margin-top:18px;">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          \`
          lista.appendChild(div)
        }

        function eliminarModalTC(btn) {
          const filas = document.querySelectorAll('.modal-fila-tc')
          if (filas.length <= 1) { alert('Debe haber al menos una tarjeta.'); return }
          btn.closest('.modal-fila-tc').remove()
          calcularTotalModalTC()
        }

        function calcularTotalModalTC() {
          let total = 0
          document.querySelectorAll('.modal-tc-monto').forEach(function(i) { total += parseFloat(i.value||'0') })
          const el = document.getElementById('modal-txt-total-tc')
          if (el) el.textContent = '$' + total.toLocaleString('es-UY',{minimumFractionDigits:2})
          // Sincronizar con monto total del formulario
          const inpMonto = document.getElementById('input-monto-pago')
          if (inpMonto && total > 0) inpMonto.value = total.toFixed(2)
        }

        // Selecciona/deselecciona sólo las filas VISIBLES
        function toggleTodosVisibles(checked) {
          const filas = document.querySelectorAll('#tbody-servicios tr[data-file]')
          filas.forEach(function(tr) {
            if (tr.style.display === 'none') return
            const chk = tr.querySelector('.servicio-check')
            if (chk) chk.checked = checked
          })
          actualizarSeleccion()
        }

        // Compatibilidad con botón "Seleccionar pendientes"
        function seleccionarTodos() {
          document.querySelectorAll('.servicio-check').forEach(function(c) { c.checked = true })
          const chkTodos = document.getElementById('chk-todos')
          if (chkTodos) chkTodos.checked = true
          actualizarSeleccion()
        }

        // Al cargar la página: seleccionar automáticamente todos los servicios pendientes
        document.addEventListener('DOMContentLoaded', function() {
          const checks = document.querySelectorAll('.servicio-check')
          if (checks.length > 0) {
            checks.forEach(function(c) { c.checked = true })
            const chkTodos = document.getElementById('chk-todos')
            if (chkTodos) chkTodos.checked = true
            actualizarSeleccion()
          }
        })

        // Abrir modal de pago: actualiza ids y valida que haya selección
        function abrirModalPago() {
          actualizarSeleccion()  // sincronizar el campo hidden antes de abrir
          const ids = document.getElementById('input-servicios-ids')?.value || ''
          const aviso = document.getElementById('aviso-sin-servicios')
          const btnConfirmar = document.getElementById('btn-confirmar-pago')
          if (!ids) {
            if (aviso) aviso.style.display = 'block'
            if (btnConfirmar) btnConfirmar.disabled = true
          } else {
            if (aviso) aviso.style.display = 'none'
            if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.innerHTML = '<i class="fas fa-save"></i> Confirmar Pago' }
          }
          document.getElementById('modal-pago-multiple').classList.add('active')
        }

        // Validación en submit: asegurar que haya servicios seleccionados y monto > 0
        function validarFormPago(e) {
          actualizarSeleccion()
          const ids   = document.getElementById('input-servicios-ids')?.value || ''
          const monto = parseFloat(document.getElementById('input-monto-pago')?.value || '0')
          const aviso = document.getElementById('aviso-sin-servicios')

          if (!ids) {
            if (aviso) aviso.style.display = 'block'
            e.preventDefault(); return false
          }
          if (monto <= 0) {
            alert('El monto debe ser mayor a cero.')
            e.preventDefault(); return false
          }
          if (aviso) aviso.style.display = 'none'

          // Verificar si hay saldo insuficiente sin autorizar
          const alertaSaldo  = document.getElementById('alerta-saldo')
          const chkAutorizar = document.getElementById('chk-autorizar-saldo')
          if (alertaSaldo && alertaSaldo.style.display !== 'none') {
            if (!chkAutorizar || !chkAutorizar.checked) {
              alert('Hay files con saldo insuficiente. Debés marcar la casilla de autorización para continuar.')
              e.preventDefault(); return false
            }
            const autorizadoPor = document.getElementById('input-autorizado-por')?.value?.trim()
            if (!autorizadoPor) {
              alert('Ingresá el nombre del responsable que autoriza el pago con saldo insuficiente.')
              e.preventDefault(); return false
            }
          }

          const btn = document.getElementById('btn-confirmar-pago')
          if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...' }
          return true
        }
      </script>
    `
    return c.html(baseLayout('Pagos a Proveedores', content, user, 'tesoreria'))
  } catch (e: any) {
    return c.html(baseLayout('Pagos a Proveedores', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'tesoreria'))
  }
})

// POST: Registrar pago múltiple a proveedor
tesoreria.post('/tesoreria/pago-proveedor', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const body = await c.req.parseBody()

  try {
    const MONEDAS_V = ['USD', 'UYU']
    const METODOS_V = ['transferencia', 'efectivo', 'tarjeta', 'cheque', 'saldo_cc']
    const proveedorId   = body.proveedor_id ? Number(body.proveedor_id) : null
    const serviciosStr  = String(body.servicios_ids || '').trim()
    // Solo IDs enteros positivos
    const serviciosIds  = serviciosStr.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n > 0)
    const monto         = Number(body.monto || 0)
    const moneda        = MONEDAS_V.includes(String(body.moneda)) ? String(body.moneda) : 'USD'
    const metodo        = METODOS_V.includes(String(body.metodo)) ? String(body.metodo) : 'transferencia'
    const bancoId       = body.banco_id ? Number(body.banco_id) : null
    const bancoCuenta   = body.banco_cuenta ? String(body.banco_cuenta).trim().substring(0, 100) : null
    const concepto      = String(body.concepto || 'Pago a proveedor').trim().substring(0, 500)
    const referencia    = body.referencia ? String(body.referencia).trim().substring(0, 200) : ''
    const autorizadoPor = body.autorizado_por ? String(body.autorizado_por).trim().substring(0, 200) : null

    if (serviciosIds.length === 0) {
      const baseUrl = proveedorId ? `/tesoreria/proveedores?proveedor_id=${proveedorId}&error=sin_servicios` : '/tesoreria/proveedores?error=sin_servicios'
      return c.redirect(baseUrl)
    }
    if (monto <= 0 && metodo !== 'saldo_cc') {
      const baseUrl = proveedorId ? `/tesoreria/proveedores?proveedor_id=${proveedorId}&error=monto_invalido` : '/tesoreria/proveedores?error=monto_invalido'
      return c.redirect(baseUrl)
    }

    const refSufijo = referencia ? ` | Ref: ${referencia}` : ''
    const autSufijo = autorizadoPor ? ` | Autorizado por: ${autorizadoPor}` : ''
    const conceptoCompleto = `${concepto}${refSufijo}${autSufijo} (${serviciosIds.length} servicio(s))`

    // Si el método es tarjeta: registrar en cuenta corriente con estado 'pendiente'
    // y las TCs individuales — el egreso real se registra al autorizar
    if (metodo === 'tarjeta') {
      // Parsear las TCs enviadas (campo tc_ultimos4[] y tc_monto[])
      const tc4Raw   = body['tc_ultimos4']
      const tcMRaw   = body['tc_monto']
      const tcBRaw   = body['tc_banco']
      const tc4List  = (Array.isArray(tc4Raw)  ? tc4Raw  : tc4Raw  ? [tc4Raw]  : []).map(String)
      const tcMList  = (Array.isArray(tcMRaw)  ? tcMRaw  : tcMRaw  ? [tcMRaw]  : []).map(Number)
      const tcBList  = (Array.isArray(tcBRaw)  ? tcBRaw  : tcBRaw  ? [tcBRaw]  : []).map(String)

      // Crear movimiento en cuenta corriente (estado pendiente)
      const ccResult = await c.env.DB.prepare(`
        INSERT INTO proveedor_cuenta_corriente
          (proveedor_id, tipo, metodo, monto, moneda, concepto, referencia, estado, usuario_id, servicios_ids)
        VALUES (?, 'credito', 'tarjeta', ?, ?, ?, ?, 'pendiente', ?, ?)
      `).bind(proveedorId, monto, moneda, conceptoCompleto, referencia, user.id, serviciosStr).run()

      const ccId = ccResult.meta.last_row_id as number

      // Registrar cada TC individual
      for (let i = 0; i < tc4List.length; i++) {
        const ult4  = tc4List[i]?.trim()
        const tmonto = tcMList[i] || 0
        const tbanco = tcBList[i]?.trim() || null
        if (!ult4 || tmonto <= 0) continue
        await c.env.DB.prepare(`
          INSERT INTO proveedor_tarjetas
            (proveedor_id, cuenta_corriente_id, ultimos_4, banco_emisor, monto, moneda, fecha_cargo, estado, concepto, servicios_ids)
          VALUES (?, ?, ?, ?, ?, ?, date('now'), 'pendiente', ?, ?)
        `).bind(proveedorId, ccId, ult4, tbanco, tmonto, moneda, conceptoCompleto, serviciosStr).run()
      }

      // NO marcar servicios como pagados aún — se hará al autorizar
      const backUrl = proveedorId
        ? `/tesoreria/proveedores?proveedor_id=${proveedorId}&ok=tc_pendiente`
        : `/tesoreria/proveedores?ok=tc_pendiente`
      return c.redirect(backUrl)
    }

    // Pago con saldo CC: débito en cuenta corriente sin movimiento de caja
    if (metodo === 'saldo_cc') {
      const montoCCRaw = Number(body.monto_saldo_cc || body.monto || 0)
      const montoCC = montoCCRaw > 0 ? montoCCRaw : monto

      // Verificar saldo disponible
      const saldoRow = await c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN tipo='credito' AND estado='confirmado' THEN monto ELSE 0 END),0) as cred,
          COALESCE(SUM(CASE WHEN tipo='debito'  AND estado='confirmado' THEN monto ELSE 0 END),0) as deb
        FROM proveedor_cuenta_corriente WHERE proveedor_id = ?
      `).bind(proveedorId).first() as any
      const saldoDisp = Number(saldoRow?.cred || 0) - Number(saldoRow?.deb || 0)

      if (montoCC > saldoDisp + 0.001) {
        const backUrl = proveedorId
          ? `/tesoreria/proveedores?proveedor_id=${proveedorId}&error=saldo_cc_insuficiente`
          : `/tesoreria/proveedores?error=saldo_cc_insuficiente`
        return c.redirect(backUrl)
      }

      // Registrar débito en cuenta corriente (usa el saldo a favor)
      await c.env.DB.prepare(`
        INSERT INTO proveedor_cuenta_corriente
          (proveedor_id, tipo, metodo, monto, moneda, concepto, referencia, estado, usuario_id, servicios_ids)
        VALUES (?, 'debito', 'saldo_cc', ?, ?, ?, ?, 'confirmado', ?, ?)
      `).bind(proveedorId, montoCC, moneda, conceptoCompleto, referencia, user.id, serviciosStr).run()

      // Marcar servicios como pagados
      for (const sId of serviciosIds) {
        await c.env.DB.prepare(
          `UPDATE servicios SET prepago_realizado = 1, estado_pago_proveedor = 'pagado' WHERE id = ?`
        ).bind(sId).run()
      }

      const backUrl = proveedorId
        ? `/tesoreria/proveedores?proveedor_id=${proveedorId}&ok=1`
        : `/tesoreria/proveedores?ok=1`
      return c.redirect(backUrl)
    }

    // Pago normal (no TC, no saldo_cc): registrar egreso y marcar servicios
    const cajaResult = await c.env.DB.prepare(`
      INSERT INTO movimientos_caja
        (tipo, metodo, moneda, monto, cotizacion, monto_uyu, proveedor_id, banco_id, concepto, usuario_id, fecha, autorizado_por, banco_cuenta)
      VALUES ('egreso', ?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
    `).bind(metodo, moneda, monto, monto, proveedorId, bancoId, conceptoCompleto, user.id, autorizadoPor, bancoCuenta).run()

    const cajaId = cajaResult.meta.last_row_id as number

    // Registrar en cuenta corriente del proveedor (débito confirmado)
    await c.env.DB.prepare(`
      INSERT INTO proveedor_cuenta_corriente
        (proveedor_id, tipo, metodo, monto, moneda, concepto, referencia, estado, usuario_id, movimiento_caja_id, servicios_ids)
      VALUES (?, 'debito', ?, ?, ?, ?, ?, 'confirmado', ?, ?, ?)
    `).bind(proveedorId, metodo, monto, moneda, conceptoCompleto, referencia, user.id, cajaId, serviciosStr).run()

    for (const sId of serviciosIds) {
      await c.env.DB.prepare(
        `UPDATE servicios SET prepago_realizado = 1, estado_pago_proveedor = 'pagado' WHERE id = ?`
      ).bind(sId).run()
    }

    const backUrl = proveedorId
      ? `/tesoreria/proveedores?proveedor_id=${proveedorId}&ok=1`
      : `/tesoreria/proveedores?ok=1`
    return c.redirect(backUrl)
  } catch (e: any) {
    const provId2 = body.proveedor_id ? `&proveedor_id=${body.proveedor_id}` : ''
    return c.redirect('/tesoreria/proveedores?error=' + encodeURIComponent('error_interno') + provId2)
  }
})

// ── GET: Cuenta corriente de un proveedor ──────────────────────
tesoreria.get('/tesoreria/proveedor/:id/cuenta', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const provId = c.req.param('id')
  const ok  = c.req.query('ok') || ''
  const err = c.req.query('error') || ''

  try {
    const proveedor = await c.env.DB.prepare('SELECT * FROM proveedores WHERE id = ?').bind(provId).first() as any
    if (!proveedor) return c.redirect('/tesoreria/proveedores')

    const bancos = await c.env.DB.prepare('SELECT id, nombre_entidad, moneda, activo FROM bancos ORDER BY activo DESC, nombre_entidad ASC').all()

    // Movimientos cuenta corriente
    const movimientos = await c.env.DB.prepare(`
      SELECT pcc.*, u.nombre as usuario_nombre
      FROM proveedor_cuenta_corriente pcc
      LEFT JOIN usuarios u ON u.id = pcc.usuario_id
      WHERE pcc.proveedor_id = ?
      ORDER BY pcc.created_at DESC LIMIT 50
    `).bind(provId).all()

    // Todas las TCs del proveedor (para el panel mejorado)
    const tarjetasPendientes = await c.env.DB.prepare(`
      SELECT pt.*, u.nombre as autorizado_nombre,
             f.numero as file_numero
      FROM proveedor_tarjetas pt
      LEFT JOIN usuarios u ON u.id = pt.autorizado_por_usuario
      LEFT JOIN files f ON f.id = pt.file_id
      WHERE pt.proveedor_id = ? AND pt.estado = 'pendiente'
      ORDER BY pt.created_at DESC
    `).bind(provId).all()

    // Todas las TCs recientes (para mostrar historial en panel)
    const todasTarjetas = await c.env.DB.prepare(`
      SELECT pt.*, u.nombre as autorizado_nombre,
             f.numero as file_numero
      FROM proveedor_tarjetas pt
      LEFT JOIN usuarios u ON u.id = pt.autorizado_por_usuario
      LEFT JOIN files f ON f.id = pt.file_id
      WHERE pt.proveedor_id = ?
      ORDER BY pt.created_at DESC
      LIMIT 20
    `).bind(provId).all()

    // Saldo de cuenta corriente
    const saldoRow = await c.env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='credito' AND estado='confirmado' THEN monto ELSE 0 END),0) as total_credito,
        COALESCE(SUM(CASE WHEN tipo='debito'  AND estado='confirmado' THEN monto ELSE 0 END),0) as total_debito,
        COALESCE(SUM(CASE WHEN tipo='credito' AND estado='pendiente'  THEN monto ELSE 0 END),0) as total_pendiente
      FROM proveedor_cuenta_corriente WHERE proveedor_id = ?
    `).bind(provId).first() as any

    const saldoDisponible = Number(saldoRow?.total_credito || 0) - Number(saldoRow?.total_debito || 0)
    const saldoPendiente  = Number(saldoRow?.total_pendiente || 0)
    const totalCreditos   = Number(saldoRow?.total_credito || 0)
    const totalDebitos    = Number(saldoRow?.total_debito  || 0)

    // Servicios pendientes de pago del proveedor
    const serviciosPendientes = await c.env.DB.prepare(`
      SELECT
        s.id, s.tipo_servicio, s.descripcion, s.nro_ticket,
        s.costo_original, s.moneda_origen, s.fecha_inicio,
        s.fecha_limite_prepago, s.prepago_realizado,
        f.numero as file_numero, f.id as file_id,
        COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo, '(sin cliente)') as cliente_nombre
      FROM servicios s
      JOIN files f ON s.file_id = f.id
      LEFT JOIN clientes c ON f.cliente_id = c.id
      WHERE s.proveedor_id = ?
        AND f.estado != 'anulado'
        AND s.estado != 'cancelado'
      ORDER BY s.prepago_realizado ASC, s.fecha_limite_prepago ASC NULLS LAST, f.numero ASC
    `).bind(provId).all()

    const totalPendiente = (serviciosPendientes.results as any[])
      .filter((s: any) => !s.prepago_realizado)
      .reduce((acc: number, s: any) => acc + Number(s.costo_original || 0), 0)
    const totalPagado = (serviciosPendientes.results as any[])
      .filter((s: any) => s.prepago_realizado)
      .reduce((acc: number, s: any) => acc + Number(s.costo_original || 0), 0)

    const hoy = new Date().toISOString().split('T')[0]

    const iconoServicio: Record<string, string> = {
      aereo: 'fa-plane', hotel: 'fa-bed', traslado: 'fa-car',
      tour: 'fa-map-marked-alt', seguro: 'fa-shield-alt', otro: 'fa-concierge-bell'
    }

    // Filas de servicios
    const rowsServicios = (serviciosPendientes.results as any[]).map((s: any) => {
      const vencido = s.fecha_limite_prepago && s.fecha_limite_prepago < hoy && !s.prepago_realizado
      return `
        <tr style="background:${s.prepago_realizado ? '#f0fdf4' : vencido ? '#fff5f5' : 'white'};border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 12px;">
            ${!s.prepago_realizado ? `
              <input type="checkbox" class="svc-check" value="${s.id}"
                data-monto="${s.costo_original}" data-moneda="${s.moneda_origen}"
                data-desc="${esc(s.descripcion)}" data-file="#${s.file_numero}"
                onchange="recalcPago()"
                style="width:15px;height:15px;cursor:pointer;accent-color:#7B3FA0;">
            ` : `<i class="fas fa-check-circle" style="color:#059669;" title="Pagado"></i>`}
          </td>
          <td style="padding:8px 12px;">
            <span style="font-size:11px;background:#f3e8ff;color:#7B3FA0;padding:2px 7px;border-radius:8px;font-weight:700;">
              <i class="fas ${iconoServicio[s.tipo_servicio] || 'fa-cog'}"></i> ${s.tipo_servicio}
            </span>
          </td>
          <td style="padding:8px 12px;">
            <div style="font-weight:600;font-size:13px;">${esc(s.descripcion)}</div>
            ${s.nro_ticket ? `<div style="font-size:11px;color:#7B3FA0;">🎫 ${esc(s.nro_ticket)}</div>` : ''}
          </td>
          <td style="padding:8px 12px;font-size:12px;">
            <a href="/files/${s.file_id}" style="color:#7B3FA0;font-weight:700;">#${esc(s.file_numero)}</a>
            <div style="font-size:11px;color:#9ca3af;">${esc(s.cliente_nombre)}</div>
          </td>
          <td style="padding:8px 12px;font-size:12px;color:#6b7280;">${s.fecha_inicio || '—'}</td>
          <td style="padding:8px 12px;">
            ${s.fecha_limite_prepago ? `
              <span style="font-size:11px;font-weight:700;color:${vencido && !s.prepago_realizado ? '#dc2626' : '#6b7280'};">
                ${vencido && !s.prepago_realizado ? '⚠ ' : ''}${s.fecha_limite_prepago}
              </span>
            ` : `<span style="color:#9ca3af;font-size:11px;">—</span>`}
          </td>
          <td style="padding:8px 12px;">
            <strong style="color:${s.prepago_realizado ? '#059669' : '#dc2626'};font-size:13px;">
              $${Number(s.costo_original).toLocaleString('es-UY',{minimumFractionDigits:2})} ${s.moneda_origen}
            </strong>
          </td>
          <td style="padding:8px 12px;">
            ${s.prepago_realizado
              ? `<span style="font-size:10px;background:#d1fae5;color:#059669;padding:2px 8px;border-radius:8px;font-weight:700;">✓ PAGADO</span>`
              : `<span style="font-size:10px;background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:8px;font-weight:700;">PENDIENTE</span>`
            }
          </td>
        </tr>
      `
    }).join('')

    // Filas historial cuenta corriente
    const rowsMovs = (movimientos.results as any[]).map((m: any) => {
      const esCredito = m.tipo === 'credito'
      const estadoColor = m.estado === 'pendiente' ? '#d97706' : m.estado === 'confirmado' ? '#059669' : '#dc2626'
      const estadoBg    = m.estado === 'pendiente' ? '#fef3c7'  : m.estado === 'confirmado' ? '#d1fae5'  : '#fee2e2'
      const estadoLabel = m.estado === 'pendiente' ? '⏳ Pendiente TC' : m.estado === 'confirmado' ? '✓ Confirmado' : '✗ Anulado'
      const metodoIcon: Record<string,string> = { transferencia:'fa-exchange-alt', efectivo:'fa-money-bill', cheque:'fa-file-alt', tarjeta:'fa-credit-card' }
      return `
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:8px 12px;font-size:12px;color:#6b7280;white-space:nowrap;">${(m.created_at||'').substring(0,16)}</td>
          <td style="padding:8px 12px;">
            <span style="font-size:11px;font-weight:700;color:${esCredito?'#7B3FA0':'#374151'};
              background:${esCredito?'#f3e8ff':'#f3f4f6'};padding:2px 8px;border-radius:8px;">
              ${esCredito ? '↑ CRÉDITO' : '↓ DÉBITO'}
            </span>
          </td>
          <td style="padding:8px 12px;">
            <i class="fas ${metodoIcon[m.metodo]||'fa-dollar-sign'}" style="color:#9ca3af;font-size:11px;"></i>
            <span style="font-size:13px;margin-left:4px;">${esc(m.concepto||'')}</span>
          </td>
          <td style="padding:8px 12px;font-size:13px;font-weight:800;color:${esCredito?'#7B3FA0':'#dc2626'};white-space:nowrap;">
            ${esCredito?'+':'-'}$${Number(m.monto).toLocaleString('es-UY',{minimumFractionDigits:2})} <span style="font-size:11px;font-weight:400;">${m.moneda}</span>
          </td>
          <td style="padding:8px 12px;">
            <span style="font-size:11px;font-weight:700;color:${estadoColor};background:${estadoBg};padding:2px 8px;border-radius:8px;">${estadoLabel}</span>
          </td>
          <td style="padding:8px 12px;font-size:11px;color:#9ca3af;">${esc(m.usuario_nombre||'')}</td>
          <td style="padding:8px 12px;">
            ${m.estado === 'pendiente' && isAdminOrAbove(user.rol) ? `
              <form method="POST" action="/tesoreria/proveedor/${provId}/cuenta/autorizar" style="display:inline;">
                <input type="hidden" name="cc_id" value="${m.id}">
                <button type="submit" style="padding:3px 8px;background:#059669;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;">
                  <i class="fas fa-check"></i> Autorizar
                </button>
              </form>
            ` : ''}
          </td>
        </tr>
      `
    }).join('')

    // Filas TC — todas con estado y acciones
    const rowsTarjetas = (todasTarjetas.results as any[]).map((t: any) => {
      const estadoColor = t.estado === 'pendiente' ? '#d97706' : t.estado === 'autorizada' ? '#059669' : '#dc2626'
      const estadoBg    = t.estado === 'pendiente' ? '#fef3c7' : t.estado === 'autorizada' ? '#d1fae5' : '#fee2e2'
      const estadoLabel = t.estado === 'pendiente' ? '⏳ Pendiente' : t.estado === 'autorizada' ? '✓ Autorizada' : '✗ Rechazada'
      return `
      <tr style="border-bottom:1px solid #f3f4f6;${t.estado==='pendiente'?'background:#fffbeb;':''}">
        <td style="padding:7px 10px;font-size:12px;color:#6b7280;">${(t.fecha_cargo||'').substring(0,10)}</td>
        <td style="padding:7px 10px;font-size:13px;font-weight:700;">
          <i class="fas fa-credit-card" style="color:#EC008C;"></i> **** ${esc(t.ultimos_4)}
          ${t.banco_emisor ? `<div style="font-size:11px;color:#9ca3af;">${esc(t.banco_emisor)}</div>` : ''}
        </td>
        <td style="padding:7px 10px;font-size:13px;font-weight:800;color:${estadoColor};">
          $${Number(t.monto).toLocaleString('es-UY',{minimumFractionDigits:2})} <span style="font-size:11px;font-weight:400;">${t.moneda}</span>
        </td>
        <td style="padding:7px 10px;">
          ${t.file_numero ? `<a href="/files/${t.file_id}" style="font-size:11px;color:#7B3FA0;">#${esc(t.file_numero)}</a>` : '<span style="color:#9ca3af;font-size:11px;">—</span>'}
        </td>
        <td style="padding:7px 10px;">
          <span style="font-size:11px;font-weight:700;color:${estadoColor};background:${estadoBg};padding:2px 8px;border-radius:8px;">${estadoLabel}</span>
        </td>
        ${isAdminOrAbove(user.rol) ? `
          <td style="padding:7px 10px;">
            ${t.estado === 'pendiente' ? `
              <div style="display:flex;gap:4px;">
                <form method="POST" action="/tesoreria/proveedor/${provId}/cuenta/autorizar-tc" style="display:inline;">
                  <input type="hidden" name="tc_id" value="${t.id}">
                  <input type="hidden" name="accion" value="autorizar">
                  <button type="submit" style="padding:3px 8px;background:#059669;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;"><i class="fas fa-check"></i> Autorizar</button>
                </form>
                <form method="POST" action="/tesoreria/proveedor/${provId}/cuenta/autorizar-tc" style="display:inline;">
                  <input type="hidden" name="tc_id" value="${t.id}">
                  <input type="hidden" name="accion" value="rechazar">
                  <button type="submit" style="padding:3px 8px;background:#dc2626;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;"><i class="fas fa-times"></i> Rechazar</button>
                </form>
              </div>
            ` : `<span style="font-size:11px;color:#6b7280;">${t.autorizado_nombre||'—'}</span>`}
          </td>
        ` : '<td></td>'}
      </tr>
    `}).join('')

    const content = `
      <!-- Encabezado -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
        <div>
          <a href="/tesoreria/proveedores" style="color:#7B3FA0;font-size:13px;">
            <i class="fas fa-arrow-left"></i> Volver a Pagos a Proveedores
          </a>
          <h2 style="margin:6px 0 2px;color:#1a1a2e;font-size:22px;font-weight:800;">
            <i class="fas fa-building" style="color:#7B3FA0;margin-right:8px;"></i>${esc(proveedor.nombre)}
          </h2>
          <div style="font-size:13px;color:#6b7280;">Cuenta Corriente &amp; Gestión de Pagos</div>
        </div>
        <button onclick="document.getElementById('modal-pago-cuenta').classList.add('active')" class="btn btn-primary">
          <i class="fas fa-plus"></i> Ingreso a Cuenta
        </button>
      </div>

      ${ok === '1' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> Movimiento registrado correctamente.</div>` : ''}
      ${ok === 'tc_autorizada' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> Tarjeta autorizada. Servicios marcados como pagados.</div>` : ''}
      ${err ? `<div class="alert alert-danger" style="margin-bottom:16px;">${esc(err)}</div>` : ''}

      <!-- Balance cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:24px;">
        <!-- Saldo disponible — grande y destacado -->
        <div style="background:${saldoDisponible>0?'linear-gradient(135deg,#059669,#047857)':saldoDisponible<0?'linear-gradient(135deg,#dc2626,#b91c1c)':'linear-gradient(135deg,#6b7280,#4b5563)'};
          border-radius:14px;padding:20px;color:white;grid-column:span 1;">
          <div style="font-size:11px;font-weight:700;opacity:0.85;letter-spacing:1px;margin-bottom:6px;">SALDO DISPONIBLE</div>
          <div style="font-size:28px;font-weight:900;">${saldoDisponible<0?'-':''}$${Math.abs(saldoDisponible).toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
          <div style="font-size:11px;opacity:0.75;margin-top:4px;">${saldoDisponible>0?'A favor del proveedor':saldoDisponible<0?'Saldo deudor':'Sin movimientos'}</div>
        </div>
        <div style="background:white;border-radius:14px;padding:16px;border:1.5px solid #e5e7eb;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">SERVICIOS PENDIENTES</div>
          <div style="font-size:22px;font-weight:800;color:#dc2626;">$${totalPendiente.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${(serviciosPendientes.results as any[]).filter((s:any)=>!s.prepago_realizado).length} servicio(s) sin pagar</div>
        </div>
        <div style="background:white;border-radius:14px;padding:16px;border:1.5px solid #e5e7eb;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">YA PAGADO</div>
          <div style="font-size:22px;font-weight:800;color:#059669;">$${totalPagado.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${(serviciosPendientes.results as any[]).filter((s:any)=>s.prepago_realizado).length} servicio(s) pagados</div>
        </div>
        ${saldoPendiente > 0 ? `
          <div style="background:white;border-radius:14px;padding:16px;border:1.5px solid #fde68a;">
            <div style="font-size:11px;font-weight:700;color:#d97706;letter-spacing:1px;margin-bottom:6px;">TC PENDIENTE AUTORIZACIÓN</div>
            <div style="font-size:22px;font-weight:800;color:#d97706;">$${saldoPendiente.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${tarjetasPendientes.results.length} tarjeta(s)</div>
          </div>
        ` : ''}
      </div>

      <!-- Layout 2 columnas: Servicios | Cuenta Corriente -->
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:20px;align-items:start;">

        <!-- Columna izquierda: Servicios -->
        <div>
          <!-- Selección rápida para pagar -->
          <div id="barra-pago-cuenta" style="display:none;position:sticky;top:0;z-index:50;background:white;border:2px solid #7B3FA0;border-radius:12px;padding:12px 16px;margin-bottom:12px;box-shadow:0 4px 16px rgba(123,63,160,0.15);">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <div>
                <span style="font-weight:700;color:#7B3FA0;" id="txt-svc-sel">0 servicios</span>
                <span style="font-size:18px;font-weight:800;color:#F7941D;margin-left:12px;" id="txt-svc-monto">$0</span>
              </div>
              <button onclick="abrirModalPagoCuenta()" class="btn btn-primary btn-sm">
                <i class="fas fa-money-bill-wave"></i> Pagar Seleccionados
              </button>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title"><i class="fas fa-list-check" style="color:#F7941D;"></i> Servicios (${serviciosPendientes.results.length})</span>
              <div style="display:flex;gap:6px;">
                <button onclick="selTodosServ()" class="btn btn-outline btn-sm" style="font-size:11px;">
                  <i class="fas fa-check-double"></i> Sel. pendientes
                </button>
              </div>
            </div>
            <div class="table-wrapper" style="max-height:500px;overflow-y:auto;">
              <table style="width:100%;">
                <thead style="position:sticky;top:0;z-index:10;">
                  <tr style="background:#f8f3ff;font-size:11px;color:#6b7280;text-transform:uppercase;">
                    <th style="padding:8px 12px;width:36px;"></th>
                    <th style="padding:8px 12px;">Tipo</th>
                    <th style="padding:8px 12px;">Descripción</th>
                    <th style="padding:8px 12px;">File</th>
                    <th style="padding:8px 12px;">F. Serv.</th>
                    <th style="padding:8px 12px;">F. Límite</th>
                    <th style="padding:8px 12px;">Costo</th>
                    <th style="padding:8px 12px;">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsServicios || `<tr><td colspan="8" style="text-align:center;padding:30px;color:#9ca3af;">Sin servicios registrados</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Columna derecha: Cuenta Corriente -->
        <div>
          <!-- Panel de Tarjetas (siempre visible si hay alguna) -->
          ${todasTarjetas.results.length > 0 ? `
            <div class="card" style="margin-bottom:16px;border:2px solid ${tarjetasPendientes.results.length > 0 ? '#fde68a' : '#e5e7eb'};">
              <div class="card-header" style="background:${tarjetasPendientes.results.length > 0 ? '#fffbeb' : '#f9fafb'};">
                <span class="card-title" style="font-size:13px;">
                  <i class="fas fa-credit-card" style="color:#d97706;"></i> Tarjetas de Crédito
                  ${tarjetasPendientes.results.length > 0 ? `<span style="background:#f59e0b;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:6px;">${tarjetasPendientes.results.length} pendiente(s)</span>` : ''}
                </span>
                <a href="/tesoreria/tarjetas?tipo=proveedor&entidad_id=${provId}" 
                   style="font-size:11px;color:#7B3FA0;font-weight:700;text-decoration:none;background:#f3e8ff;padding:3px 8px;border-radius:6px;">
                  <i class="fas fa-external-link-alt"></i> Ver en Tarjetas en Cartera
                </a>
              </div>
              <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                  <thead>
                    <tr style="background:#f9fafb;font-size:10px;color:#6b7280;text-transform:uppercase;">
                      <th style="padding:6px 10px;text-align:left;">Fecha</th>
                      <th style="padding:6px 10px;text-align:left;">Tarjeta</th>
                      <th style="padding:6px 10px;text-align:left;">Monto</th>
                      <th style="padding:6px 10px;text-align:left;">File</th>
                      <th style="padding:6px 10px;text-align:left;">Estado</th>
                      ${isAdminOrAbove(user.rol) ? '<th style="padding:6px 10px;text-align:left;">Acción</th>' : ''}
                    </tr>
                  </thead>
                  <tbody>${rowsTarjetas || '<tr><td colspan="6" style="text-align:center;padding:12px;color:#9ca3af;font-size:12px;">Sin tarjetas</td></tr>'}</tbody>
                </table>
              </div>
            </div>
          ` : ''}

          <!-- Historial cuenta corriente -->
          <div class="card">
            <div class="card-header">
              <span class="card-title" style="font-size:13px;"><i class="fas fa-history" style="color:#7B3FA0;"></i> Historial Cuenta Corriente</span>
              <button onclick="document.getElementById('modal-pago-cuenta').classList.add('active')"
                style="padding:4px 10px;background:#7B3FA0;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;">
                <i class="fas fa-plus"></i> Nuevo
              </button>
            </div>
            <!-- Mini resumen créditos/débitos -->
            <div style="display:flex;gap:0;border-bottom:1px solid #e5e7eb;">
              <div style="flex:1;padding:10px 14px;text-align:center;border-right:1px solid #e5e7eb;">
                <div style="font-size:10px;color:#6b7280;font-weight:700;margin-bottom:2px;">CRÉDITOS</div>
                <div style="font-size:16px;font-weight:800;color:#7B3FA0;">+$${totalCreditos.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
              </div>
              <div style="flex:1;padding:10px 14px;text-align:center;">
                <div style="font-size:10px;color:#6b7280;font-weight:700;margin-bottom:2px;">DÉBITOS</div>
                <div style="font-size:16px;font-weight:800;color:#dc2626;">-$${totalDebitos.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
              </div>
            </div>
            <div style="max-height:380px;overflow-y:auto;">
              <table style="width:100%;border-collapse:collapse;">
                <tbody>
                  ${rowsMovs || '<tr><td colspan="7" style="text-align:center;padding:24px;color:#9ca3af;font-size:13px;">Sin movimientos registrados</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal: Nuevo ingreso a cuenta / pago a cuenta -->
      <div class="modal-overlay" id="modal-pago-cuenta">
        <div class="modal" style="max-width:640px;">
          <div class="modal-header">
            <span class="modal-title">
              <i class="fas fa-plus-circle" style="color:#F7941D;"></i>
              Ingreso a Cuenta — ${esc(proveedor.nombre)}
            </span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-pago-cuenta').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/tesoreria/proveedor/${provId}/cuenta/nuevo" id="form-cc-modal">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">TIPO DE MOVIMIENTO *</label>
                  <select name="tipo" required class="form-control">
                    <option value="credito">Crédito — Pago/saldo a favor</option>
                    <option value="debito">Débito — Uso de saldo existente</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">MÉTODO DE PAGO *</label>
                  <select name="metodo" required class="form-control" id="modal-metodo-cc" onchange="toggleModalMetodoCC(this.value)">
                    <option value="transferencia">Transferencia Bancaria</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="cheque">Cheque</option>
                    <option value="tarjeta">Tarjeta de Crédito (múltiples)</option>
                  </select>
                </div>
              </div>

              <!-- Banco (solo si no es TC) -->
              <div class="form-group" id="modal-campo-banco-cc">
                <label class="form-label">BANCO / CUENTA</label>
                <select name="banco_id" class="form-control">
                  <option value="">— Sin banco —</option>
                  ${(bancos.results as any[]).map((b: any) => `<option value="${b.id}" ${b.activo===0?'disabled style="color:#9ca3af;"':''} >${esc(b.nombre_entidad)} (${b.moneda})${b.activo===0?' — CERRADA':''}</option>`).join('')}
                </select>
              </div>

              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">MONTO TOTAL *</label>
                  <input type="number" name="monto" id="modal-monto-cc" required min="0.01" step="0.01" class="form-control" placeholder="0.00" oninput="calcTotalTCCC()">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA *</label>
                  <select name="moneda" class="form-control">
                    <option value="USD">USD</option>
                    <option value="UYU">UYU</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">CONCEPTO *</label>
                <input type="text" name="concepto" required class="form-control"
                  value="${esc('Pago a ' + proveedor.nombre)}" placeholder="Ej: Pago anticipado servicios Mayo 2026">
              </div>
              <div class="form-group">
                <label class="form-label">Nº COMPROBANTE / REFERENCIA</label>
                <input type="text" name="referencia" class="form-control" placeholder="Opcional: Nº factura">
              </div>

              <!-- Panel TCs múltiples -->
              <div id="modal-panel-tc-cc" style="display:none;border:2px solid #c4b5fd;border-radius:10px;padding:14px;margin-bottom:14px;background:#faf7ff;">
                <div style="font-size:12px;font-weight:700;color:#5a2d75;margin-bottom:10px;">
                  <i class="fas fa-credit-card" style="color:#EC008C;"></i> TARJETAS DE CRÉDITO
                  <span style="font-size:11px;font-weight:400;color:#6b7280;"> — Ingresá cada TC por separado</span>
                </div>
                <div id="modal-lista-tc-cc">
                  <div class="modal-fila-tc-cc" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px;">
                    <div>
                      <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">ÚLTIMOS 4</label>
                      <input type="text" name="tc_ultimos4" class="form-control modal-tc-ult4-cc" maxlength="4" placeholder="1234"
                        style="padding:5px 8px;letter-spacing:2px;font-weight:700;" oninput="calcTotalTCCC()">
                    </div>
                    <div>
                      <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">BANCO</label>
                      <input type="text" name="tc_banco" class="form-control" placeholder="Santander" style="padding:5px 8px;">
                    </div>
                    <div>
                      <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">MONTO</label>
                      <input type="number" name="tc_monto" class="form-control modal-tc-monto-cc" min="0.01" step="0.01" placeholder="0.00"
                        style="padding:5px 8px;" oninput="calcTotalTCCC()">
                    </div>
                    <div>
                      <button type="button" onclick="eliminarTCCC(this)"
                        style="padding:6px 9px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-size:12px;margin-top:18px;">
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                  <button type="button" onclick="agregarTCCC()"
                    style="padding:5px 12px;background:#7B3FA0;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;">
                    <i class="fas fa-plus"></i> Agregar TC
                  </button>
                  <span style="font-size:12px;font-weight:700;color:#5a2d75;">
                    Total TC: <span id="modal-txt-total-tc-cc" style="color:#EC008C;">$0.00</span>
                  </span>
                </div>
              </div>

              <div style="display:flex;gap:10px;margin-top:8px;">
                <button type="submit" class="btn btn-primary" onclick="return validarFormCC()">
                  <i class="fas fa-save"></i> Registrar
                </button>
                <button type="button" onclick="document.getElementById('modal-pago-cuenta').classList.remove('active')" class="btn btn-outline">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal: Pagar servicios seleccionados -->
      <div class="modal-overlay" id="modal-pagar-servicios">
        <div class="modal" style="max-width:580px;">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-money-bill-wave" style="color:#059669;"></i> Pagar Servicios Seleccionados</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-pagar-servicios').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <div style="background:#f8f3ff;border-radius:10px;padding:12px;margin-bottom:14px;">
              <div style="font-size:12px;font-weight:700;color:#7B3FA0;margin-bottom:6px;">SERVICIOS A PAGAR:</div>
              <div id="lista-svc-pagar" style="font-size:13px;color:#374151;"></div>
              <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;">
                <span style="font-weight:700;">TOTAL:</span>
                <span style="font-size:16px;font-weight:800;color:#F7941D;" id="total-svc-pagar">$0</span>
              </div>
            </div>
            <form method="POST" action="/tesoreria/pago-proveedor" id="form-pagar-svc">
              <input type="hidden" name="proveedor_id" value="${provId}">
              <input type="hidden" name="servicios_ids" id="svc-ids-hidden">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">MÉTODO DE PAGO *</label>
                  <select name="metodo" required class="form-control" id="svc-metodo" onchange="toggleSvcMetodo(this.value)">
                    <option value="transferencia">Transferencia</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="cheque">Cheque</option>
                    <option value="tarjeta">Tarjeta de Crédito</option>
                    ${saldoDisponible > 0 ? `<option value="saldo_cc" style="color:#059669;font-weight:700;">💳 Saldo Cuenta Corriente (disponible: $${saldoDisponible.toLocaleString('es-UY',{minimumFractionDigits:2})})</option>` : ''}
                  </select>
                </div>
                <div class="form-group" id="svc-campo-banco">
                  <label class="form-label">BANCO *</label>
                  <select name="banco_id" class="form-control">
                    <option value="">— Sin banco —</option>
                    ${(bancos.results as any[]).map((b: any) => `<option value="${b.id}" ${b.activo===0?'disabled style="color:#9ca3af;"':''} >${esc(b.nombre_entidad)} (${b.moneda})${b.activo===0?' — CERRADA':''}</option>`).join('')}
                  </select>
                </div>
              </div>
              <!-- Panel Saldo CC -->
              <div id="svc-panel-saldo-cc" style="display:none;background:#ecfdf5;border:2px solid #6ee7b7;border-radius:10px;padding:14px;margin-bottom:12px;">
                <div style="font-size:12px;font-weight:700;color:#047857;margin-bottom:8px;"><i class="fas fa-piggy-bank" style="color:#059669;"></i> PAGO CON SALDO DE CUENTA CORRIENTE</div>
                <div style="font-size:13px;color:#065f46;margin-bottom:10px;">
                  Saldo disponible: <strong style="color:#059669;">$${saldoDisponible.toLocaleString('es-UY',{minimumFractionDigits:2})}</strong>
                </div>
                <div class="form-group" style="margin-bottom:8px;">
                  <label class="form-label" style="color:#065f46;">MONTO A USAR DEL SALDO CC *</label>
                  <input type="number" name="monto_saldo_cc" id="svc-monto-saldo-cc" min="0.01" step="0.01" max="${saldoDisponible.toFixed(2)}" class="form-control" placeholder="0.00" oninput="calcSvcResto()">
                </div>
                <div id="svc-resto-info" style="font-size:12px;color:#374151;"></div>
              </div>
              <!-- Panel TCs inline -->
              <div id="svc-panel-tc" style="display:none;border:2px solid #c4b5fd;border-radius:10px;padding:12px;margin-bottom:12px;background:#faf7ff;">
                <div style="font-size:12px;font-weight:700;color:#5a2d75;margin-bottom:8px;"><i class="fas fa-credit-card" style="color:#EC008C;"></i> TARJETAS DE CRÉDITO</div>
                <div id="svc-lista-tc">
                  <div class="svc-fila-tc" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px;">
                    <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:2px;">ÚLTIMOS 4</label>
                      <input type="text" name="tc_ultimos4" class="form-control svc-tc-ult4" maxlength="4" placeholder="1234" style="padding:4px 7px;letter-spacing:2px;font-weight:700;" oninput="calcSvcTC()"></div>
                    <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:2px;">BANCO</label>
                      <input type="text" name="tc_banco" class="form-control" placeholder="Santander" style="padding:4px 7px;"></div>
                    <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:2px;">MONTO</label>
                      <input type="number" name="tc_monto" class="form-control svc-tc-monto" min="0.01" step="0.01" placeholder="0.00" style="padding:4px 7px;" oninput="calcSvcTC()"></div>
                    <div><button type="button" onclick="elimSvcTC(this)" style="padding:5px 8px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:5px;cursor:pointer;font-size:11px;margin-top:16px;"><i class="fas fa-trash"></i></button></div>
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
                  <button type="button" onclick="addSvcTC()" style="padding:4px 10px;background:#7B3FA0;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;"><i class="fas fa-plus"></i> Agregar TC</button>
                  <span style="font-size:12px;font-weight:700;color:#5a2d75;">Total TC: <span id="svc-txt-total-tc" style="color:#EC008C;">$0.00</span></span>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">MONTO TOTAL *</label>
                  <input type="number" name="monto" id="svc-monto-total" required min="0.01" step="0.01" class="form-control" placeholder="0.00">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA</label>
                  <select name="moneda" class="form-control"><option value="USD">USD</option><option value="UYU">UYU</option></select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">CONCEPTO *</label>
                <input type="text" name="concepto" required class="form-control" value="${esc('Pago a ' + proveedor.nombre)}">
              </div>
              <div class="form-group">
                <label class="form-label">Nº COMPROBANTE</label>
                <input type="text" name="referencia" class="form-control" placeholder="Opcional">
              </div>
              <div style="display:flex;gap:10px;margin-top:8px;">
                <button type="submit" class="btn btn-primary" id="btn-confirmar-svc"><i class="fas fa-save"></i> Confirmar Pago</button>
                <button type="button" onclick="document.getElementById('modal-pagar-servicios').classList.remove('active')" class="btn btn-outline">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
        // ── Selección de servicios ───────────────────────────────────────
        function recalcPago() {
          const checks = document.querySelectorAll('.svc-check:checked')
          const total  = Array.from(checks).reduce((s,c) => s + parseFloat(c.dataset.monto||'0'), 0)
          const barra  = document.getElementById('barra-pago-cuenta')
          const elSel  = document.getElementById('txt-svc-sel')
          const elMon  = document.getElementById('txt-svc-monto')
          if (elSel) elSel.textContent = checks.length + ' servicio(s) seleccionado(s)'
          if (elMon) elMon.textContent = '$' + total.toLocaleString('es-UY',{minimumFractionDigits:2})
          if (barra) barra.style.display = checks.length > 0 ? 'block' : 'none'
        }

        function selTodosServ() {
          document.querySelectorAll('.svc-check').forEach(c => c.checked = true)
          recalcPago()
        }

        function abrirModalPagoCuenta() {
          const checks = document.querySelectorAll('.svc-check:checked')
          if (checks.length === 0) { alert('Seleccioná al menos un servicio pendiente.'); return }
          const total  = Array.from(checks).reduce((s,c) => s + parseFloat(c.dataset.monto||'0'), 0)
          const ids    = Array.from(checks).map(c => c.value).join(',')
          const lista  = Array.from(checks).map(c =>
            '• <strong>' + c.dataset.file + '</strong> — ' + c.dataset.desc
            + ' <span style="color:#7B3FA0;font-weight:700;">$'
            + parseFloat(c.dataset.monto).toLocaleString('es-UY',{minimumFractionDigits:2})
            + ' ' + c.dataset.moneda + '</span>'
          ).join('<br>')
          const elLista = document.getElementById('lista-svc-pagar')
          const elTotal = document.getElementById('total-svc-pagar')
          const elMonto = document.getElementById('svc-monto-total')
          const elIds   = document.getElementById('svc-ids-hidden')
          if (elLista) elLista.innerHTML = lista
          if (elTotal) elTotal.textContent = '$' + total.toLocaleString('es-UY',{minimumFractionDigits:2})
          if (elMonto) elMonto.value = total.toFixed(2)
          if (elIds)   elIds.value   = ids
          document.getElementById('modal-pagar-servicios').classList.add('active')
        }

        // ── Modal Ingreso a Cuenta ───────────────────────────────────────
        function toggleModalMetodoCC(val) {
          const panelTC   = document.getElementById('modal-panel-tc-cc')
          const campoBanco = document.getElementById('modal-campo-banco-cc')
          if (panelTC)    panelTC.style.display   = val === 'tarjeta' ? 'block' : 'none'
          if (campoBanco) campoBanco.style.display = val === 'tarjeta' ? 'none'  : 'block'
          if (val === 'tarjeta') calcTotalTCCC()
        }

        function agregarTCCC() {
          const lista = document.getElementById('modal-lista-tc-cc')
          const div = document.createElement('div')
          div.className = 'modal-fila-tc-cc'
          div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px;'
          div.innerHTML = \`
            <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">ÚLTIMOS 4</label>
              <input type="text" name="tc_ultimos4" class="form-control modal-tc-ult4-cc" maxlength="4" placeholder="1234" style="padding:5px 8px;letter-spacing:2px;font-weight:700;" oninput="calcTotalTCCC()"></div>
            <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">BANCO</label>
              <input type="text" name="tc_banco" class="form-control" placeholder="Santander" style="padding:5px 8px;"></div>
            <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">MONTO</label>
              <input type="number" name="tc_monto" class="form-control modal-tc-monto-cc" min="0.01" step="0.01" placeholder="0.00" style="padding:5px 8px;" oninput="calcTotalTCCC()"></div>
            <div><button type="button" onclick="eliminarTCCC(this)" style="padding:6px 9px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-size:12px;margin-top:18px;"><i class="fas fa-trash"></i></button></div>
          \`
          lista.appendChild(div)
        }

        function eliminarTCCC(btn) {
          const filas = document.querySelectorAll('.modal-fila-tc-cc')
          if (filas.length <= 1) { alert('Debe haber al menos una tarjeta.'); return }
          btn.closest('.modal-fila-tc-cc').remove()
          calcTotalTCCC()
        }

        function calcTotalTCCC() {
          let total = 0
          document.querySelectorAll('.modal-tc-monto-cc').forEach(i => { total += parseFloat(i.value||'0') })
          const el = document.getElementById('modal-txt-total-tc-cc')
          if (el) el.textContent = '$' + total.toLocaleString('es-UY',{minimumFractionDigits:2})
          const inpMonto = document.getElementById('modal-monto-cc')
          if (inpMonto && total > 0) inpMonto.value = total.toFixed(2)
        }

        function validarFormCC() {
          const metodo = document.getElementById('modal-metodo-cc')?.value
          if (metodo === 'tarjeta') {
            const montos = document.querySelectorAll('.modal-tc-monto-cc')
            const ult4s  = document.querySelectorAll('.modal-tc-ult4-cc')
            let totalTC = 0, valido = true
            montos.forEach((i,idx) => {
              const m = parseFloat(i.value||'0')
              const d = ult4s[idx]?.value?.trim()
              if (!d || m <= 0) valido = false
              totalTC += m
            })
            if (!valido) { alert('Completá los últimos 4 dígitos y el monto de cada tarjeta.'); return false }
            const montoTotal = parseFloat(document.getElementById('modal-monto-cc')?.value || '0')
            if (Math.abs(totalTC - montoTotal) > 0.01) {
              if (!confirm('El total de TCs (' + totalTC.toFixed(2) + ') no coincide con el monto total (' + montoTotal.toFixed(2) + '). ¿Continuar igual?')) return false
            }
          }
          return true
        }

        // ── Modal Pagar Servicios ────────────────────────────────────────
        function toggleSvcMetodo(val) {
          const panelTC      = document.getElementById('svc-panel-tc')
          const campoBanco   = document.getElementById('svc-campo-banco')
          const panelSaldoCC = document.getElementById('svc-panel-saldo-cc')
          const campoMonto   = document.getElementById('svc-monto-total')
          if (panelTC)      panelTC.style.display      = val === 'tarjeta'   ? 'block' : 'none'
          if (campoBanco)   campoBanco.style.display   = val === 'tarjeta' || val === 'saldo_cc' ? 'none'  : 'block'
          if (panelSaldoCC) panelSaldoCC.style.display = val === 'saldo_cc' ? 'block' : 'none'
          if (val === 'tarjeta') calcSvcTC()
          if (val === 'saldo_cc') {
            // Pre-fill with total; user can adjust
            const elMonto = document.getElementById('svc-monto-saldo-cc')
            const elTotal = document.getElementById('svc-monto-total')
            if (elMonto && elTotal && !elMonto.value) elMonto.value = elTotal.value
            calcSvcResto()
            if (campoMonto) campoMonto.removeAttribute('required')
          } else {
            if (campoMonto) campoMonto.setAttribute('required', 'required')
          }
        }

        function calcSvcResto() {
          const montoCC  = parseFloat(document.getElementById('svc-monto-saldo-cc')?.value || '0')
          const total    = parseFloat(document.getElementById('svc-monto-total')?.value || '0')
          const saldoMax = parseFloat('${saldoDisponible.toFixed(2)}')
          const el       = document.getElementById('svc-resto-info')
          if (!el) return
          if (montoCC > saldoMax) {
            el.innerHTML = '<span style="color:#dc2626;font-weight:700;">⚠️ El monto supera el saldo disponible ($' + saldoMax.toLocaleString('es-UY',{minimumFractionDigits:2}) + ')</span>'
            return
          }
          const resto = total - montoCC
          if (resto > 0.005) {
            el.innerHTML = 'Resto a pagar por otro medio: <strong style="color:#b45309;">$' + resto.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</strong>'
          } else if (montoCC > 0) {
            el.innerHTML = '<span style="color:#059669;font-weight:700;">✅ Saldo cubre el total del pago</span>'
          } else {
            el.innerHTML = ''
          }
        }

        function addSvcTC() {
          const lista = document.getElementById('svc-lista-tc')
          const div = document.createElement('div')
          div.className = 'svc-fila-tc'
          div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:end;margin-bottom:6px;'
          div.innerHTML = \`
            <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:2px;">ÚLTIMOS 4</label>
              <input type="text" name="tc_ultimos4" class="form-control svc-tc-ult4" maxlength="4" placeholder="1234" style="padding:4px 7px;letter-spacing:2px;font-weight:700;" oninput="calcSvcTC()"></div>
            <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:2px;">BANCO</label>
              <input type="text" name="tc_banco" class="form-control" placeholder="Santander" style="padding:4px 7px;"></div>
            <div><label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:2px;">MONTO</label>
              <input type="number" name="tc_monto" class="form-control svc-tc-monto" min="0.01" step="0.01" placeholder="0.00" style="padding:4px 7px;" oninput="calcSvcTC()"></div>
            <div><button type="button" onclick="elimSvcTC(this)" style="padding:5px 8px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:5px;cursor:pointer;font-size:11px;margin-top:16px;"><i class="fas fa-trash"></i></button></div>
          \`
          lista.appendChild(div)
        }

        function elimSvcTC(btn) {
          const filas = document.querySelectorAll('.svc-fila-tc')
          if (filas.length <= 1) { alert('Debe haber al menos una tarjeta.'); return }
          btn.closest('.svc-fila-tc').remove()
          calcSvcTC()
        }

        function calcSvcTC() {
          let total = 0
          document.querySelectorAll('.svc-tc-monto').forEach(i => { total += parseFloat(i.value||'0') })
          const el = document.getElementById('svc-txt-total-tc')
          if (el) el.textContent = '$' + total.toLocaleString('es-UY',{minimumFractionDigits:2})
          const inpM = document.getElementById('svc-monto-total')
          if (inpM && total > 0) inpM.value = total.toFixed(2)
        }
      </script>
    `
    return c.html(baseLayout(`${esc(proveedor.nombre)} — Cuenta Corriente`, content, user, 'tesoreria'))
  } catch (e: any) {
    return c.html(baseLayout('Cuenta Corriente', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'tesoreria'))
  }
})

// ── GET: Formulario nuevo pago/saldo a favor ────────────────────
tesoreria.get('/tesoreria/proveedor/:id/cuenta/nuevo', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const provId = c.req.param('id')

  try {
    const proveedor = await c.env.DB.prepare('SELECT * FROM proveedores WHERE id = ?').bind(provId).first() as any
    if (!proveedor) return c.redirect('/tesoreria/proveedores')
    const bancos = await c.env.DB.prepare('SELECT id, nombre_entidad, moneda, activo FROM bancos ORDER BY activo DESC, nombre_entidad ASC').all()

    const content = `
      <div style="max-width:700px;">
        <div style="margin-bottom:16px;">
          <a href="/tesoreria/proveedor/${provId}/cuenta" style="color:#7B3FA0;font-size:13px;">
            <i class="fas fa-arrow-left"></i> Volver a Cuenta Corriente
          </a>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">
              <i class="fas fa-plus-circle" style="color:#F7941D;"></i>
              Nuevo Movimiento — ${esc(proveedor.nombre)}
            </span>
          </div>
          <div class="card-body">
            <form method="POST" action="/tesoreria/proveedor/${provId}/cuenta/nuevo" id="form-cc">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">TIPO DE MOVIMIENTO *</label>
                  <select name="tipo" required class="form-control" onchange="toggleTipo(this.value)">
                    <option value="credito">Crédito (saldo a favor / pago al proveedor)</option>
                    <option value="debito">Débito (uso de saldo existente)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">MÉTODO DE PAGO *</label>
                  <select name="metodo" required class="form-control" id="sel-metodo" onchange="toggleMetodo(this.value)">
                    <option value="transferencia">Transferencia Bancaria</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="cheque">Cheque</option>
                    <option value="tarjeta">Tarjeta de Crédito (múltiples)</option>
                  </select>
                </div>
              </div>

              <!-- Banco (solo si no es TC) -->
              <div class="form-group" id="campo-banco">
                <label class="form-label">BANCO / CUENTA</label>
                <select name="banco_id" class="form-control">
                  <option value="">— Sin banco —</option>
                  ${bancos.results.map((b: any) => `<option value="${b.id}" ${b.activo===0?'disabled style="color:#9ca3af;"':''} >${esc(b.nombre_entidad)} (${b.moneda})${b.activo===0?' — CERRADA':''}</option>`).join('')}
                </select>
              </div>

              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">MONTO TOTAL *</label>
                  <input type="number" name="monto" id="inp-monto-total" required min="0.01" step="0.01" class="form-control" placeholder="0.00" oninput="calcularTotalTC()">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA *</label>
                  <select name="moneda" class="form-control">
                    <option value="USD">USD</option>
                    <option value="UYU">UYU</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">CONCEPTO *</label>
                <input type="text" name="concepto" required class="form-control"
                  placeholder="Ej: Pago anticipado servicios Junio 2026" value="Pago a ${esc(proveedor.nombre)}">
              </div>
              <div class="form-group">
                <label class="form-label">Nº COMPROBANTE / REFERENCIA</label>
                <input type="text" name="referencia" class="form-control" placeholder="Opcional">
              </div>

              <!-- Panel de tarjetas múltiples -->
              <div id="panel-tc" style="display:none;border:2px solid #c4b5fd;border-radius:10px;padding:16px;margin-bottom:16px;background:#faf7ff;">
                <div style="font-size:13px;font-weight:700;color:#5a2d75;margin-bottom:12px;">
                  <i class="fas fa-credit-card" style="color:#EC008C;"></i> TARJETAS DE CRÉDITO
                  <span style="font-size:11px;font-weight:400;color:#6b7280;"> — Ingresá cada TC por separado</span>
                </div>
                <div id="lista-tc">
                  <!-- Fila TC inicial -->
                  <div class="fila-tc" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px;">
                    <div class="form-group" style="margin-bottom:0;">
                      <label class="form-label" style="font-size:11px;">ÚLTIMOS 4 DÍGITOS *</label>
                      <input type="text" name="tc_ultimos4" class="form-control tc-ultimos4" maxlength="4" placeholder="1234"
                        style="padding:6px 10px;letter-spacing:3px;font-weight:700;" oninput="calcularTotalTC()">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                      <label class="form-label" style="font-size:11px;">BANCO EMISOR</label>
                      <input type="text" name="tc_banco" class="form-control" placeholder="Ej: Santander" style="padding:6px 10px;">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                      <label class="form-label" style="font-size:11px;">MONTO *</label>
                      <input type="number" name="tc_monto" class="form-control tc-monto" min="0.01" step="0.01" placeholder="0.00"
                        style="padding:6px 10px;" oninput="calcularTotalTC()">
                    </div>
                    <div style="padding-bottom:2px;">
                      <button type="button" onclick="eliminarTC(this)" style="padding:7px 10px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-size:13px;" title="Eliminar TC">
                        <i class="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                  <button type="button" onclick="agregarTC()"
                    style="padding:7px 14px;background:#7B3FA0;color:white;border:none;border-radius:8px;font-size:12px;cursor:pointer;">
                    <i class="fas fa-plus"></i> Agregar TC
                  </button>
                  <div style="font-size:13px;font-weight:700;color:#5a2d75;">
                    Total TC: <span id="txt-total-tc" style="color:#EC008C;">$0.00</span>
                  </div>
                </div>
                <div id="aviso-tc-mismatch" style="display:none;background:#fff3cd;border:1px solid #fbbf24;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:12px;color:#92400e;">
                  <i class="fas fa-exclamation-triangle"></i> El total de TCs no coincide con el monto total ingresado.
                </div>
              </div>

              <div style="display:flex;gap:10px;margin-top:16px;">
                <button type="submit" class="btn btn-primary" onclick="return validarFormCC()">
                  <i class="fas fa-save"></i> Registrar Movimiento
                </button>
                <a href="/tesoreria/proveedor/${provId}/cuenta" class="btn btn-outline">Cancelar</a>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
        function toggleMetodo(val) {
          const panelTC = document.getElementById('panel-tc')
          const campoBanco = document.getElementById('campo-banco')
          panelTC.style.display = val === 'tarjeta' ? 'block' : 'none'
          campoBanco.style.display = val === 'tarjeta' ? 'none' : 'block'
          if (val === 'tarjeta') calcularTotalTC()
        }

        function toggleTipo(val) {
          // Podría usarse para lógica adicional de tipo
        }

        function agregarTC() {
          const lista = document.getElementById('lista-tc')
          const div = document.createElement('div')
          div.className = 'fila-tc'
          div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px;'
          div.innerHTML = \`
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:11px;">ÚLTIMOS 4 DÍGITOS *</label>
              <input type="text" name="tc_ultimos4" class="form-control tc-ultimos4" maxlength="4" placeholder="1234"
                style="padding:6px 10px;letter-spacing:3px;font-weight:700;" oninput="calcularTotalTC()">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:11px;">BANCO EMISOR</label>
              <input type="text" name="tc_banco" class="form-control" placeholder="Ej: Santander" style="padding:6px 10px;">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:11px;">MONTO *</label>
              <input type="number" name="tc_monto" class="form-control tc-monto" min="0.01" step="0.01" placeholder="0.00"
                style="padding:6px 10px;" oninput="calcularTotalTC()">
            </div>
            <div style="padding-bottom:2px;">
              <button type="button" onclick="eliminarTC(this)" style="padding:7px 10px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;font-size:13px;">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          \`
          lista.appendChild(div)
        }

        function eliminarTC(btn) {
          const filas = document.querySelectorAll('.fila-tc')
          if (filas.length <= 1) { alert('Debe haber al menos una tarjeta.'); return }
          btn.closest('.fila-tc').remove()
          calcularTotalTC()
        }

        function calcularTotalTC() {
          const montos = document.querySelectorAll('.tc-monto')
          let total = 0
          montos.forEach(function(i) { total += parseFloat(i.value || '0') })
          document.getElementById('txt-total-tc').textContent = '$' + total.toLocaleString('es-UY',{minimumFractionDigits:2})
          // Sincronizar con monto total si hay TCs
          const metodo = document.getElementById('sel-metodo')?.value
          if (metodo === 'tarjeta') {
            const inpTotal = document.getElementById('inp-monto-total')
            const montoTotal = parseFloat(inpTotal?.value || '0')
            const aviso = document.getElementById('aviso-tc-mismatch')
            if (aviso) aviso.style.display = (montoTotal > 0 && Math.abs(total - montoTotal) > 0.01) ? 'block' : 'none'
          }
        }

        function validarFormCC() {
          const metodo = document.getElementById('sel-metodo')?.value
          if (metodo === 'tarjeta') {
            const montos = document.querySelectorAll('.tc-monto')
            const ult4s  = document.querySelectorAll('.tc-ultimos4')
            let totalTC = 0
            let valido = true
            montos.forEach(function(i, idx) {
              const m = parseFloat(i.value || '0')
              const d = ult4s[idx]?.value?.trim()
              if (!d || m <= 0) { valido = false }
              totalTC += m
            })
            if (!valido) { alert('Completá los últimos 4 dígitos y el monto de cada tarjeta.'); return false }
            const montoTotal = parseFloat(document.getElementById('inp-monto-total')?.value || '0')
            if (Math.abs(totalTC - montoTotal) > 0.01) {
              if (!confirm('El total de TCs (' + totalTC.toFixed(2) + ') no coincide con el monto total (' + montoTotal.toFixed(2) + '). ¿Continuar igual?')) return false
            }
          }
          return true
        }
      </script>
    `
    return c.html(baseLayout(`Nuevo Movimiento — ${proveedor.nombre}`, content, user, 'tesoreria'))
  } catch (e: any) {
    return c.html(baseLayout('Cuenta Corriente', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'tesoreria'))
  }
})

// ── POST: Registrar nuevo movimiento en cuenta corriente ────────
tesoreria.post('/tesoreria/proveedor/:id/cuenta/nuevo', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const provId = c.req.param('id')

  try {
    const body     = await c.req.parseBody()
    const TIPOS_CC   = ['credito', 'debito']
    const METODOS_CC = ['transferencia', 'efectivo', 'tarjeta', 'cheque']
    const MONEDAS_CC = ['USD', 'UYU']
    const tipo     = TIPOS_CC.includes(String(body.tipo))   ? String(body.tipo)   : 'credito'
    const metodo   = METODOS_CC.includes(String(body.metodo)) ? String(body.metodo) : 'transferencia'
    const monto    = Number(body.monto   || 0)
    const moneda   = MONEDAS_CC.includes(String(body.moneda)) ? String(body.moneda) : 'USD'
    const concepto = String(body.concepto || '').trim().substring(0, 500)
    const referencia = body.referencia ? String(body.referencia).trim().substring(0, 200) : null
    const bancoId  = body.banco_id ? Number(body.banco_id) : null

    if (!isFinite(monto) || monto <= 0 || !concepto) return c.redirect(`/tesoreria/proveedor/${provId}/cuenta/nuevo?error=datos_invalidos`)

    // Estado según método
    const estado = metodo === 'tarjeta' ? 'pendiente' : 'confirmado'

    const ccResult = await c.env.DB.prepare(`
      INSERT INTO proveedor_cuenta_corriente
        (proveedor_id, tipo, metodo, monto, moneda, concepto, referencia, estado, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(provId, tipo, metodo, monto, moneda, concepto, referencia, estado, user.id).run()

    const ccId = ccResult.meta.last_row_id as number

    // Si es TC, registrar las tarjetas individuales
    if (metodo === 'tarjeta') {
      const tc4Raw  = body['tc_ultimos4']
      const tcMRaw  = body['tc_monto']
      const tcBRaw  = body['tc_banco']
      const tc4List = (Array.isArray(tc4Raw) ? tc4Raw : tc4Raw ? [tc4Raw] : []).map(String)
      const tcMList = (Array.isArray(tcMRaw) ? tcMRaw : tcMRaw ? [tcMRaw] : []).map(Number)
      const tcBList = (Array.isArray(tcBRaw) ? tcBRaw : tcBRaw ? [tcBRaw] : []).map(String)

      for (let i = 0; i < tc4List.length; i++) {
        const ult4  = tc4List[i]?.trim()
        const tmonto = tcMList[i] || 0
        const tbanco = tcBList[i]?.trim() || null
        if (!ult4 || tmonto <= 0) continue
        await c.env.DB.prepare(`
          INSERT INTO proveedor_tarjetas
            (proveedor_id, cuenta_corriente_id, ultimos_4, banco_emisor, monto, moneda, fecha_cargo, estado, concepto)
          VALUES (?, ?, ?, ?, ?, ?, date('now'), 'pendiente', ?)
        `).bind(provId, ccId, ult4, tbanco, tmonto, moneda, concepto).run()
      }
    } else {
      // Pago confirmado: registrar también en movimientos_caja
      await c.env.DB.prepare(`
        INSERT INTO movimientos_caja
          (tipo, metodo, moneda, monto, cotizacion, monto_uyu, proveedor_id, banco_id, concepto, usuario_id, fecha)
        VALUES ('egreso', ?, ?, ?, 1, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(metodo, moneda, monto, monto, provId, bancoId, concepto, user.id).run()
    }

    return c.redirect(`/tesoreria/proveedor/${provId}/cuenta?ok=1`)
  } catch (e: any) {
    return c.redirect(`/tesoreria/proveedor/${provId}/cuenta?error=${encodeURIComponent('error_interno')}`)
  }
})

// ── POST: Autorizar/Rechazar TC desde Pago a Proveedores (nuevo endpoint unificado) ──
tesoreria.post('/tesoreria/tc/autorizar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/login')

  const body    = await c.req.parseBody()
  const tcId    = Number(body.tc_id)
  const tcTipo  = String(body.tc_tipo || 'proveedor')  // 'cliente' | 'proveedor'
  const accion  = ['autorizar','rechazar'].includes(String(body.accion)) ? String(body.accion) : 'autorizar'
  const provId  = String(body.proveedor_id || '')
  const redirectBase = provId ? `/tesoreria/proveedores?proveedor_id=${provId}` : '/tesoreria/proveedores'

  if (!tcId) return c.redirect(redirectBase + '&error=tc_invalida')

  try {
    const tabla  = tcTipo === 'cliente' ? 'cliente_tarjetas' : 'proveedor_tarjetas'
    const campo  = tcTipo === 'cliente' ? 'cliente_tarjeta_id' : 'proveedor_tarjeta_id'
    const tc = await c.env.DB.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).bind(tcId).first() as any
    if (!tc) return c.redirect(redirectBase + '&error=tc_no_encontrada')

    await ensureTarjetaAsignaciones(c.env.DB)

    if (accion === 'autorizar') {
      // 1. Marcar TC como autorizada
      await c.env.DB.prepare(
        `UPDATE ${tabla} SET estado='autorizada', fecha_autorizacion=datetime('now'), autorizado_por_usuario=? WHERE id=?`
      ).bind(user.id, tcId).run()

      // 2. Marcar asignaciones como pagado y servicios como pagados
      const asigs = await c.env.DB.prepare(
        `SELECT ta.*, f.vendedor_id FROM tarjeta_asignaciones ta
         LEFT JOIN files f ON f.id = ta.file_id
         WHERE ta.${campo} = ? AND ta.estado = 'tc_enviada'`
      ).bind(tcId).all().catch(() => ({ results: [] }))

      for (const a of (asigs.results as any[])) {
        await c.env.DB.prepare(
          `UPDATE tarjeta_asignaciones SET estado='pagado' WHERE id=?`
        ).bind(a.id).run().catch(() => {})
        if (a.servicio_id) {
          await c.env.DB.prepare(
            `UPDATE servicios SET estado_pago_proveedor='pagado', prepago_realizado=1 WHERE id=?`
          ).bind(a.servicio_id).run().catch(() => {})
        }
      }

      // 3. Registrar egreso en caja (si tiene asignaciones con monto)
      const totalAsig = (asigs.results as any[]).reduce((s: number, a: any) => s + Number(a.monto||0), 0)
      if (totalAsig > 0) {
        const moneda = tc.moneda || 'USD'
        const provAsig = provId ? Number(provId) : tc.proveedor_id
        await c.env.DB.prepare(`
          INSERT INTO movimientos_caja
            (tipo, metodo, moneda, monto, cotizacion, monto_uyu, proveedor_id, concepto, usuario_id, fecha)
          VALUES ('egreso','tarjeta',?,?,1,?,?,?,?,datetime('now'))
        `).bind(moneda, totalAsig, totalAsig, provAsig,
          `TC autorizada **** ${tc.ultimos_4||'????'} — ${(asigs.results as any[]).filter((a:any)=>a.servicio_id).length} servicio(s)`,
          user.id
        ).run().catch(() => {})
      }

      return c.redirect(redirectBase + '&ok=tc_autorizada')
    } else {
      // RECHAZAR
      await c.env.DB.prepare(
        `UPDATE ${tabla} SET estado='rechazada', fecha_autorizacion=datetime('now'), autorizado_por_usuario=? WHERE id=?`
      ).bind(user.id, tcId).run()

      // Marcar asignaciones y servicios como tc_negada y crear alertas
      const asigs = await c.env.DB.prepare(
        `SELECT ta.*, f.vendedor_id FROM tarjeta_asignaciones ta
         LEFT JOIN files f ON f.id = ta.file_id
         WHERE ta.${campo} = ? AND ta.estado = 'tc_enviada'`
      ).bind(tcId).all().catch(() => ({ results: [] }))

      for (const a of (asigs.results as any[])) {
        await c.env.DB.prepare(`UPDATE tarjeta_asignaciones SET estado='tc_negada' WHERE id=?`).bind(a.id).run().catch(() => {})
        if (a.servicio_id) {
          await c.env.DB.prepare(`UPDATE servicios SET estado_pago_proveedor='tc_negada' WHERE id=?`).bind(a.servicio_id).run().catch(() => {})
        }
        if (a.file_id) {
          const campoTcAlerta = tcTipo === 'cliente' ? 'cliente_tarjeta_id' : 'proveedor_tarjeta_id'
          await c.env.DB.prepare(`
            INSERT INTO alertas_tc (${campoTcAlerta}, asignacion_id, servicio_id, file_id, vendedor_usuario_id, monto, moneda, proveedor_id, motivo, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Tarjeta rechazada', 'pendiente')
          `).bind(tcId, a.id, a.servicio_id||null, a.file_id, a.vendedor_id||null, a.monto, a.moneda||'USD', a.proveedor_id||null).run().catch(() => {})
        }
      }
      return c.redirect(redirectBase + '&ok=tc_rechazada')
    }
  } catch (e: any) {
    return c.redirect(redirectBase + '&error=error_interno')
  }
})

// ── POST: Autorizar TC individual ────────────────────────────────
tesoreria.post('/tesoreria/proveedor/:id/cuenta/autorizar-tc', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/login')
  const provId = c.req.param('id')
  const body   = await c.req.parseBody()
  const tcId   = Number(body.tc_id)
  const accion = ['autorizar', 'rechazar'].includes(String(body.accion)) ? String(body.accion) : 'autorizar'

  if (!Number.isInteger(tcId) || tcId <= 0) return c.redirect(`/tesoreria/proveedor/${provId}/cuenta?error=tc_invalida`)

  try {
    const tc = await c.env.DB.prepare('SELECT * FROM proveedor_tarjetas WHERE id = ?').bind(tcId).first() as any
    if (!tc) return c.redirect(`/tesoreria/proveedor/${provId}/cuenta?error=tc_no_encontrada`)

    if (accion === 'autorizar') {
      // Marcar TC como autorizada
      await c.env.DB.prepare(`
        UPDATE proveedor_tarjetas SET estado='autorizada', fecha_autorizacion=datetime('now'), autorizado_por_usuario=? WHERE id=?
      `).bind(user.id, tcId).run()

      // Verificar si todas las TCs del movimiento están autorizadas
      const ccId = tc.cuenta_corriente_id
      if (ccId) {
        const pendientes = await c.env.DB.prepare(
          "SELECT COUNT(*) as cnt FROM proveedor_tarjetas WHERE cuenta_corriente_id=? AND estado='pendiente'"
        ).bind(ccId).first() as any

        if (Number(pendientes?.cnt || 0) === 0) {
          // Todas las TCs del movimiento autorizadas: confirmar el movimiento y marcar servicios
          const ccMov = await c.env.DB.prepare(
            'SELECT * FROM proveedor_cuenta_corriente WHERE id=?'
          ).bind(ccId).first() as any

          await c.env.DB.prepare(
            "UPDATE proveedor_cuenta_corriente SET estado='confirmado' WHERE id=?"
          ).bind(ccId).run()

          // Registrar egreso en caja
          await c.env.DB.prepare(`
            INSERT INTO movimientos_caja
              (tipo, metodo, moneda, monto, cotizacion, monto_uyu, proveedor_id, concepto, usuario_id, fecha)
            VALUES ('egreso', 'tarjeta', ?, ?, 1, ?, ?, ?, ?, datetime('now'))
          `).bind(ccMov.moneda, ccMov.monto, ccMov.monto, provId, ccMov.concepto, user.id).run()

          // Marcar servicios como pagados
          if (ccMov.servicios_ids) {
            const sIds = ccMov.servicios_ids.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => n > 0)
            for (const sId of sIds) {
              await c.env.DB.prepare(
                "UPDATE servicios SET prepago_realizado=1, estado_pago_proveedor='pagado' WHERE id=?"
              ).bind(sId).run()
            }
          }
        }
      }
      return c.redirect(`/tesoreria/proveedor/${provId}/cuenta?ok=tc_autorizada`)
    } else {
      // Rechazar TC de proveedor
      await c.env.DB.prepare(
        "UPDATE proveedor_tarjetas SET estado='rechazada', fecha_autorizacion=datetime('now'), autorizado_por_usuario=? WHERE id=?"
      ).bind(user.id, tcId).run()

      // Marcar servicios con asignaciones de esta TC como tc_negada y crear alertas
      const asigs = await c.env.DB.prepare(
        `SELECT ta.*, f.vendedor_id FROM tarjeta_asignaciones ta
         LEFT JOIN files f ON f.id = ta.file_id
         WHERE ta.proveedor_tarjeta_id = ? AND ta.servicio_id IS NOT NULL`
      ).bind(tcId).all().catch(() => ({ results: [] }))
      for (const a of (asigs.results as any[])) {
        await c.env.DB.prepare(
          `UPDATE servicios SET estado_pago_proveedor='tc_negada' WHERE id=?`
        ).bind(a.servicio_id).run().catch(() => {})
        await c.env.DB.prepare(
          `UPDATE tarjeta_asignaciones SET estado='tc_negada' WHERE id=?`
        ).bind(a.id).run().catch(() => {})
        if (a.file_id) {
          await c.env.DB.prepare(`
            INSERT INTO alertas_tc (proveedor_tarjeta_id, asignacion_id, servicio_id, file_id, vendedor_usuario_id, monto, moneda, proveedor_id, motivo, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Tarjeta rechazada', 'pendiente')
          `).bind(tcId, a.id, a.servicio_id, a.file_id, a.vendedor_id||null, a.monto, a.moneda||'USD', a.proveedor_id||null).run().catch(() => {})
        }
      }
      return c.redirect(`/tesoreria/proveedor/${provId}/cuenta?ok=1`)
    }
  } catch (e: any) {
    return c.redirect(`/tesoreria/proveedor/${provId}/cuenta?error=${encodeURIComponent('error_interno')}`)
  }
})

// ============================================================
// TARJETAS EN CARTERA — gestión centralizada
// Solo accesible para gerente y administración
// ============================================================
tesoreria.get('/tesoreria/tarjetas', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/dashboard')

  const estadoF   = c.req.query('estado')     || ''  // pendiente|autorizada|rechazada
  const tipoF     = c.req.query('tipo')       || ''  // proveedor|cliente
  const entidadId = c.req.query('entidad_id') || ''

  try {
    // ── Tarjetas de PROVEEDORES ──────────────────────────────
    let qProv = `
      SELECT pt.*, p.nombre as entidad_nombre, 'proveedor' as origen,
             f.numero as file_numero, u.nombre as autorizado_nombre
      FROM proveedor_tarjetas pt
      JOIN proveedores p ON p.id = pt.proveedor_id
      LEFT JOIN files f ON f.id = pt.file_id
      LEFT JOIN usuarios u ON u.id = pt.autorizado_por_usuario
      WHERE 1=1`
    const pParams: any[] = []
    if (estadoF)    { qProv += ' AND pt.estado = ?';       pParams.push(estadoF) }
    if (entidadId && tipoF === 'proveedor') { qProv += ' AND pt.proveedor_id = ?'; pParams.push(entidadId) }
    qProv += ' ORDER BY pt.created_at DESC LIMIT 100'
    const tcProveedores = await c.env.DB.prepare(qProv).bind(...pParams).all()

    // ── Tarjetas de CLIENTES ─────────────────────────────────
    let qCli = `
      SELECT ct.*, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo, '(sin cliente)') as entidad_nombre,
             'cliente' as origen, f.numero as file_numero, u.nombre as autorizado_nombre,
             m.concepto as mov_concepto
      FROM cliente_tarjetas ct
      LEFT JOIN clientes c ON c.id = ct.cliente_id
      LEFT JOIN files f ON f.id = ct.file_id
      LEFT JOIN usuarios u ON u.id = ct.autorizado_por_usuario
      LEFT JOIN movimientos_caja m ON m.id = ct.movimiento_id
      WHERE 1=1`
    const cParams: any[] = []
    if (estadoF)    { qCli += ' AND ct.estado = ?';        cParams.push(estadoF) }
    if (entidadId && tipoF === 'cliente') { qCli += ' AND ct.cliente_id = ?'; cParams.push(entidadId) }
    qCli += ' ORDER BY ct.created_at DESC LIMIT 100'
    const tcClientes = await c.env.DB.prepare(qCli).bind(...cParams).all()

    // Combinar y ordenar por fecha
    const todasTC: any[] = [
      ...(tipoF === 'cliente' ? [] : (tcProveedores.results as any[]).map(t => ({...t, origen:'proveedor'}))),
      ...(tipoF === 'proveedor' ? [] : (tcClientes.results as any[]).map(t => ({...t, origen:'cliente'}))),
    ].sort((a,b) => (b.created_at||'').localeCompare(a.created_at||''))

    // Resumen
    const totPendiente  = todasTC.filter(t => t.estado === 'pendiente').reduce((s,t)  => s + Number(t.monto), 0)
    const totAutorizada = todasTC.filter(t => t.estado === 'autorizada').reduce((s,t) => s + Number(t.monto), 0)
    const totRechazada  = todasTC.filter(t => t.estado === 'rechazada').reduce((s,t)  => s + Number(t.monto), 0)
    const nPendiente    = todasTC.filter(t => t.estado === 'pendiente').length

    // Cargar proveedores Y operadores para el modal de asignación TC
    // Para cada proveedor, buscamos también su operador_id correspondiente (mismo nombre)
    // Así el endpoint puede buscar por AMBOS IDs sin depender de joins por nombre
    const proveedoresList = await c.env.DB.prepare(`
      SELECT
        p.id,
        p.nombre,
        'proveedor' as tabla_origen,
        (SELECT o.id FROM operadores o
         WHERE LOWER(TRIM(o.nombre)) = LOWER(TRIM(p.nombre))
         LIMIT 1) as operador_id_alias
      FROM proveedores p
      WHERE p.activo = 1
      UNION ALL
      SELECT
        o.id,
        o.nombre,
        'operador' as tabla_origen,
        NULL as operador_id_alias
      FROM operadores o
      WHERE o.activo = 1
        AND o.id IN (SELECT DISTINCT operador_id FROM servicios WHERE operador_id IS NOT NULL AND estado != 'cancelado')
        AND LOWER(TRIM(o.nombre)) NOT IN (SELECT LOWER(TRIM(nombre)) FROM proveedores WHERE activo = 1)
      ORDER BY nombre
    `).all().catch(() => ({ results: [] }))

    const rowsTC = todasTC.map((t: any) => {
      const esProveedor = t.origen === 'proveedor'
      const estadoColor = t.estado === 'pendiente' ? '#d97706' : t.estado === 'autorizada' ? '#059669' : '#dc2626'
      const estadoBg    = t.estado === 'pendiente' ? '#fef3c7' : t.estado === 'autorizada' ? '#d1fae5'  : '#fee2e2'
      const estadoLabel = t.estado === 'pendiente' ? '⏳ Pendiente' : t.estado === 'autorizada' ? '✓ Autorizada' : '✗ Rechazada'
      const accionUrl   = esProveedor
        ? `/tesoreria/proveedor/${t.proveedor_id}/cuenta/autorizar-tc`
        : `/tesoreria/tarjetas/autorizar-cliente`
      // Valores seguros para usar en onclick (sin esc() que rompe JS)
      const tcOrigenTipo  = esProveedor ? 'proveedor' : 'cliente'
      const tcUlt4Safe    = String(t.ultimos_4 || '').replace(/[^0-9]/g, '')
      const tcMonedaSafe  = String(t.moneda || 'USD').replace(/[^A-Z]/g, '')
      const tcMontoNum    = Number(t.monto) || 0
      const tcIdNum       = Number(t.id)
      const tcFileIdNum   = Number(t.file_id || 0)
      const tcFileNumSafe = String(t.file_numero || '').replace(/[^0-9]/g, '')
      return `
        <tr style="border-bottom:1px solid #f3f4f6;${t.estado==='pendiente'?'background:#fffbeb;':''}">
          <td style="padding:9px 12px;font-size:12px;color:#6b7280;">${(t.fecha_cargo||t.created_at||'').substring(0,10)}</td>
          <td style="padding:9px 12px;">
            <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;
              ${esProveedor ? 'background:#ede9fe;color:#5b21b6;' : 'background:#dbeafe;color:#1d4ed8;'}">
              ${esProveedor ? '🏢 PROV' : '👤 CLI'}
            </span>
          </td>
          <td style="padding:9px 12px;font-weight:700;font-size:13px;">${esc(t.entidad_nombre||'—')}</td>
          <td style="padding:9px 12px;font-size:13px;font-weight:700;">
            <i class="fas fa-credit-card" style="color:#EC008C;font-size:11px;"></i> **** ${esc(t.ultimos_4)}
            ${t.banco_emisor ? `<div style="font-size:11px;color:#9ca3af;">${esc(t.banco_emisor)}</div>` : ''}
          </td>
          <td style="padding:9px 12px;font-size:14px;font-weight:800;color:${estadoColor};">
            $${Number(t.monto).toLocaleString('es-UY',{minimumFractionDigits:2})}
            <span style="font-size:11px;font-weight:400;color:#6b7280;">${esc(t.moneda||'USD')}</span>
          </td>
          <td style="padding:9px 12px;">
            ${t.file_numero ? `<a href="/files/${t.file_id||''}" style="font-size:12px;color:#7B3FA0;font-weight:600;">#${esc(t.file_numero)}</a>` : '<span style="color:#9ca3af;font-size:11px;">—</span>'}
          </td>
          <td style="padding:9px 12px;">
            <span style="font-size:11px;font-weight:700;color:${estadoColor};background:${estadoBg};padding:3px 9px;border-radius:8px;">${estadoLabel}</span>
            ${t.estado !== 'pendiente' && t.autorizado_nombre ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px;">por ${esc(t.autorizado_nombre)}</div>` : ''}
          </td>
          <td style="padding:9px 12px;">
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              ${t.estado === 'pendiente' ? `
                <form method="POST" action="${accionUrl}" style="display:inline;">
                  <input type="hidden" name="tc_id" value="${tcIdNum}">
                  ${esProveedor ? '' : '<input type="hidden" name="origen" value="cliente">'}
                  <input type="hidden" name="accion" value="autorizar">
                  <button type="submit" style="padding:4px 10px;background:#059669;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">
                    <i class="fas fa-check"></i> Autorizar
                  </button>
                </form>
                <form method="POST" action="${accionUrl}" style="display:inline;">
                  <input type="hidden" name="tc_id" value="${tcIdNum}">
                  ${esProveedor ? '' : '<input type="hidden" name="origen" value="cliente">'}
                  <input type="hidden" name="accion" value="rechazar">
                  <button type="submit" style="padding:4px 10px;background:#dc2626;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">
                    <i class="fas fa-times"></i> Rechazar
                  </button>
                </form>
                <button onclick="abrirModalAsignar(${tcIdNum},'${tcOrigenTipo}',${tcMontoNum},'${tcUlt4Safe}','${tcMonedaSafe}',${tcFileIdNum},'${tcFileNumSafe}')"
                  style="padding:4px 10px;background:#7B3FA0;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">
                  <i class="fas fa-link"></i> Asignar
                </button>
              ` : ''}
              ${t.estado === 'autorizada' ? `
                <button onclick="abrirModalAsignar(${tcIdNum},'${tcOrigenTipo}',${tcMontoNum},'${tcUlt4Safe}','${tcMonedaSafe}',${tcFileIdNum},'${tcFileNumSafe}')"
                  style="padding:4px 10px;background:#7B3FA0;color:white;border:none;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">
                  <i class="fas fa-link"></i> Asignar
                </button>
                <button onclick="verAsignaciones(${tcIdNum},'${tcOrigenTipo}','${tcUlt4Safe}')"
                  style="padding:4px 10px;background:white;color:#7B3FA0;border:1px solid #7B3FA0;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">
                  <i class="fas fa-list"></i> Ver
                </button>
                <button onclick="revertirAutorizacion(${tcIdNum},'${tcOrigenTipo}','${tcUlt4Safe}')"
                  style="padding:4px 10px;background:white;color:#d97706;border:1px solid #d97706;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">
                  <i class="fas fa-undo"></i> Revertir
                </button>
              ` : ''}
              ${t.estado === 'rechazada' ? `
                <button onclick="revertirAutorizacion(${tcIdNum},'${tcOrigenTipo}','${tcUlt4Safe}')"
                  style="padding:4px 10px;background:white;color:#d97706;border:1px solid #d97706;border-radius:6px;font-size:11px;cursor:pointer;white-space:nowrap;">
                  <i class="fas fa-undo"></i> Revertir
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `
    }).join('')

    const optsProveedores = (proveedoresList.results as any[]).map(p =>
      `<option value="${p.id}" data-tabla="${p.tabla_origen}" data-operador-id="${p.operador_id_alias || ''}">${esc(p.nombre)}${p.tabla_origen === 'operador' ? ' (operador)' : ''}</option>`
    ).join('')

    const backParams = new URLSearchParams()
    if (estadoF)   backParams.set('estado', estadoF)
    if (tipoF)     backParams.set('tipo', tipoF)
    if (entidadId) backParams.set('entidad_id', entidadId)

    const content = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px;">
        <div>
          <h2 style="margin:0;color:#1a1a2e;font-size:22px;font-weight:800;">
            <i class="fas fa-credit-card" style="color:#d97706;margin-right:8px;"></i>Tarjetas en Cartera
          </h2>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">Gestión centralizada de tarjetas de crédito — proveedores y clientes</div>
        </div>
        <a href="/tesoreria" class="btn btn-outline"><i class="fas fa-arrow-left"></i> Tesorería</a>
      </div>

      <!-- Stats -->
      <div class="grid-4" style="margin-bottom:20px;">
        <div class="stat-card" style="border-left:4px solid #f59e0b;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">PENDIENTES</div>
          <div style="font-size:24px;font-weight:900;color:#d97706;">${nPendiente}</div>
          <div style="font-size:12px;color:#6b7280;">$${totPendiente.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #059669;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">AUTORIZADAS</div>
          <div style="font-size:24px;font-weight:900;color:#059669;">${todasTC.filter(t=>t.estado==='autorizada').length}</div>
          <div style="font-size:12px;color:#6b7280;">$${totAutorizada.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #dc2626;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">RECHAZADAS</div>
          <div style="font-size:24px;font-weight:900;color:#dc2626;">${todasTC.filter(t=>t.estado==='rechazada').length}</div>
          <div style="font-size:12px;color:#6b7280;">$${totRechazada.toLocaleString('es-UY',{minimumFractionDigits:2})}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #7B3FA0;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">TOTAL CARTERA</div>
          <div style="font-size:24px;font-weight:900;color:#7B3FA0;">${todasTC.length}</div>
          <div style="font-size:12px;color:#6b7280;">tarjetas registradas</div>
        </div>
      </div>

      ${nPendiente > 0 ? `<div style="background:#fef3c7;border:1.5px solid #f59e0b;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#92400e;font-weight:600;">
        <i class="fas fa-exclamation-triangle"></i> Hay <strong>${nPendiente} tarjeta(s) pendiente(s)</strong> de autorización. Recordá que no podés emitir recibos hasta que estén autorizadas.
      </div>` : ''}

      <!-- Filtros -->
      <form method="GET" style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end;">
        <div>
          <label class="form-label">Estado</label>
          <select name="estado" class="form-control" style="width:170px;">
            <option value="">Todos los estados</option>
            <option value="pendiente"  ${estadoF==='pendiente'?'selected':''}>⏳ Pendiente</option>
            <option value="autorizada" ${estadoF==='autorizada'?'selected':''}>✓ Autorizada</option>
            <option value="rechazada"  ${estadoF==='rechazada'?'selected':''}>✗ Rechazada</option>
          </select>
        </div>
        <div>
          <label class="form-label">Origen</label>
          <select name="tipo" class="form-control" style="width:150px;">
            <option value="">Todos</option>
            <option value="proveedor" ${tipoF==='proveedor'?'selected':''}>🏢 Proveedores</option>
            <option value="cliente"   ${tipoF==='cliente'?'selected':''}>👤 Clientes</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-filter"></i> Filtrar</button>
        <a href="/tesoreria/tarjetas" class="btn btn-outline">Limpiar</a>
      </form>

      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-credit-card" style="color:#d97706;"></i> Tarjetas (${todasTC.length})</span>
          <span style="font-size:12px;color:#6b7280;">Las tarjetas autorizadas pueden asignarse a servicios de proveedores</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Origen</th><th>Entidad</th><th>Tarjeta</th>
                <th>Monto</th><th>File</th><th>Estado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rowsTC || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#9ca3af;">No hay tarjetas registradas</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- ══ MODAL: ASIGNAR TARJETA A PROVEEDOR/SERVICIO ══ -->
      <!-- ══ MODAL: ASIGNAR TC A PROVEEDOR (nuevo flujo completo) ══ -->
      <div id="modal-asignar-tc" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:center;justify-content:center;padding:16px;overflow-y:auto;">
        <div style="background:white;border-radius:14px;width:100%;max-width:780px;max-height:92vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.35);margin:auto;">
          <!-- Header -->
          <div style="background:linear-gradient(135deg,#7B3FA0,#9b59b6);padding:18px 24px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:2;">
            <div>
              <div style="color:white;font-size:17px;font-weight:800;"><i class="fas fa-link"></i> Asignar Tarjeta a Proveedor</div>
              <div id="modal-tc-info" style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:3px;"></div>
            </div>
            <button onclick="cerrarModalAsignar()" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:16px;">✕</button>
          </div>

          <div style="padding:20px 24px;">
            <!-- Info disponible -->
            <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:10px;color:#166534;font-weight:700;letter-spacing:0.5px;">DISPONIBLE PARA ASIGNAR</div>
                <div id="tc-monto-disponible" style="font-size:22px;font-weight:900;color:#15803d;"></div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:10px;color:#6b7280;">Total tarjeta</div>
                <div id="tc-monto-total" style="font-size:14px;font-weight:700;color:#374151;"></div>
              </div>
            </div>

            <!-- PASO 1: Proveedor -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;">
              <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:12px;">
                <span style="background:#7B3FA0;color:white;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-right:6px;">1</span>
                Seleccionar Proveedor
              </div>
              <select id="asig-proveedor" class="form-control" onchange="onProveedorChange()" style="width:100%;">
                <option value="">— Seleccionar proveedor —</option>
                ${optsProveedores}
              </select>
              <div id="asig-proveedor-info" style="margin-top:8px;font-size:11px;color:#6b7280;"></div>
            </div>

            <!-- PASO 2: Servicios (aparece al elegir proveedor) -->
            <div id="asig-servicios-section" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;">
              <div style="font-size:13px;font-weight:700;color:#374151;margin-bottom:4px;">
                <span style="background:#7B3FA0;color:white;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-right:6px;">2</span>
                Asignar a Servicios <span style="font-size:11px;font-weight:400;color:#6b7280;">(opcional — si no elegís ninguno, el total va como saldo a favor)</span>
              </div>

              <!-- Lista de servicios seleccionados con montos -->
              <div id="asig-servicios-lista" style="margin-bottom:10px;"></div>

              <!-- Agregar servicio -->
              <div id="asig-agregar-svc-wrap" style="border:1px dashed #d1d5db;border-radius:8px;padding:12px;background:white;">
                <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:8px;">+ Agregar servicio</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
                  <div style="flex:1;min-width:200px;">
                    <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px;">Servicio</label>
                    <select id="asig-svc-select" class="form-control" onchange="onSvcSelectChange()" style="width:100%;font-size:12px;">
                      <option value="">— Elegir servicio —</option>
                    </select>
                  </div>
                  <div style="width:130px;">
                    <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px;">Monto</label>
                    <input type="number" id="asig-svc-monto" class="form-control" step="0.01" min="0.01" placeholder="0.00" style="font-size:12px;" oninput="validarSvcMonto()">
                  </div>
                  <div>
                    <button type="button" onclick="agregarServicioALista()" id="btn-agregar-svc"
                      style="padding:8px 14px;background:#7B3FA0;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap;">
                      <i class="fas fa-plus"></i> Agregar
                    </button>
                  </div>
                </div>
                <div id="asig-svc-detalle" style="margin-top:6px;font-size:11px;color:#6b7280;"></div>
                <div id="asig-svc-error" style="color:#dc2626;font-size:11px;margin-top:4px;display:none;"></div>
              </div>

              <!-- Notas -->
              <div style="margin-top:10px;">
                <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px;">Notas (opcional)</label>
                <input type="text" id="asig-notas" class="form-control" placeholder="Ej: Pago parcial aereo ida" style="width:100%;font-size:12px;">
              </div>
            </div>

            <!-- Resumen -->
            <div id="asig-resumen" style="display:none;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:12px;">
              <div style="font-weight:700;color:#1e3a5f;margin-bottom:6px;"><i class="fas fa-info-circle"></i> Resumen de asignación</div>
              <div id="asig-resumen-body"></div>
            </div>

            <div id="asig-error-global" style="background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;font-size:12px;color:#dc2626;margin-bottom:12px;display:none;"></div>

            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button onclick="cerrarModalAsignar()" style="padding:8px 18px;background:white;border:1px solid #d1d5db;border-radius:7px;font-size:13px;cursor:pointer;">Cancelar</button>
              <button id="btn-guardar-asig" onclick="guardarAsignacion()" disabled
                style="padding:8px 22px;background:#7B3FA0;color:white;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;opacity:0.5;">
                <i class="fas fa-paper-plane"></i> Confirmar Asignación
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ MODAL: VER ASIGNACIONES ══ -->
      <div id="modal-ver-asig" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;padding:16px;">
        <div style="background:white;border-radius:14px;width:100%;max-width:700px;max-height:88vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="background:linear-gradient(135deg,#1e3a5f,#1e40af);padding:16px 20px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center;">
            <div style="color:white;font-size:15px;font-weight:800;" id="ver-asig-title"><i class="fas fa-list"></i> Asignaciones</div>
            <button onclick="cerrarVerAsig()" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:6px;padding:5px 9px;cursor:pointer;">✕</button>
          </div>
          <div id="ver-asig-body" style="padding:20px 24px;"></div>
        </div>
      </div>

      <script>
      // ── Estado global del modal ──
      let _tcId = null, _tcTipo = null, _tcMonto = 0, _tcMoneda = 'USD', _tcDisponible = 0
      let _tcFileId = 0, _tcFileNumero = ''   // file al que pertenece la tarjeta
      let _serviciosAgregados = []   // [{svc_id, descripcion, file_numero, cliente, monto, costo}]
      let _serviciosDisponibles = [] // lista cargada del backend

      function abrirModalAsignar(tcId, tipo, monto, ult4, moneda, fileId, fileNumero) {
        _tcId = tcId; _tcTipo = tipo; _tcMonto = monto; _tcMoneda = moneda
        _tcFileId = Number(fileId || 0); _tcFileNumero = String(fileNumero || '')
        _tcDisponible = monto
        _serviciosAgregados = []
        document.getElementById('modal-tc-info').textContent = 'TC **** ' + ult4 + ' · ' + moneda + ' $' + Number(monto).toLocaleString('es-UY',{minimumFractionDigits:2})
        document.getElementById('tc-monto-total').textContent = moneda + ' $' + Number(monto).toLocaleString('es-UY',{minimumFractionDigits:2})
        actualizarDisponible()
        document.getElementById('asig-proveedor').value = ''
        document.getElementById('asig-proveedor-info').textContent = ''
        document.getElementById('asig-servicios-section').style.display = 'none'
        document.getElementById('asig-resumen').style.display = 'none'
        document.getElementById('asig-error-global').style.display = 'none'
        document.getElementById('btn-guardar-asig').disabled = true
        document.getElementById('btn-guardar-asig').style.opacity = '0.5'
        document.getElementById('asig-notas').value = ''
        renderServiciosLista()
        document.getElementById('modal-asignar-tc').style.display = 'flex'
      }

      function cerrarModalAsignar() {
        document.getElementById('modal-asignar-tc').style.display = 'none'
      }

      function actualizarDisponible() {
        const usado = _serviciosAgregados.reduce((s,a) => s + Number(a.monto), 0)
        _tcDisponible = _tcMonto - usado
        document.getElementById('tc-monto-disponible').textContent =
          _tcMoneda + ' $' + _tcDisponible.toLocaleString('es-UY',{minimumFractionDigits:2})
        // Color según disponible
        const disp = document.getElementById('tc-monto-disponible')
        disp.style.color = _tcDisponible < 0 ? '#dc2626' : '#15803d'
      }

      async function onProveedorChange() {
        const provId = document.getElementById('asig-proveedor').value
        _serviciosAgregados = []
        renderServiciosLista()
        actualizarDisponible()
        document.getElementById('asig-resumen').style.display = 'none'
        document.getElementById('asig-error-global').style.display = 'none'

        if (!provId) {
          document.getElementById('asig-servicios-section').style.display = 'none'
          document.getElementById('asig-proveedor-info').textContent = ''
          document.getElementById('btn-guardar-asig').disabled = true
          document.getElementById('btn-guardar-asig').style.opacity = '0.5'
          return
        }

        // Habilitar botón (mínimo proveedor elegido → saldo a favor)
        document.getElementById('btn-guardar-asig').disabled = false
        document.getElementById('btn-guardar-asig').style.opacity = '1'
        document.getElementById('asig-servicios-section').style.display = 'block'

        // Cargar servicios del proveedor (o del operador si tabla_origen = 'operador')
        document.getElementById('asig-proveedor-info').textContent = 'Cargando servicios...'
        const provSel2 = document.getElementById('asig-proveedor')
        const selOpt2 = provSel2.options[provSel2.selectedIndex]
        const tablaOrigen = selOpt2?.dataset?.tabla || 'proveedor'
        // También enviamos operador_id si existe (para proveedores que tienen alias en operadores)
        const operadorIdAlias = selOpt2?.dataset?.operadorId || ''
        let serviciosUrl = '/api/tarjetas/servicios-proveedor?proveedor_id=' + provId + '&tabla=' + tablaOrigen
        if (operadorIdAlias) serviciosUrl += '&operador_id_alias=' + operadorIdAlias
        // Pasar file_id de la tarjeta para priorizar servicios de ese file
        if (_tcFileId) serviciosUrl += '&file_id=' + _tcFileId
        const r = await fetch(serviciosUrl)
        const data = await r.json()
        _serviciosDisponibles = data.servicios || []

        // Íconos por tipo de servicio
        const tipoIcono = { aereo:'✈️', hotel:'🏨', hoteleria:'🏨', traslado:'🚐', tour:'🗺️', seguro:'🛡️', otro:'📋' }
        const tipoLabel = { aereo:'Aéreo', hotel:'Hotelería', hoteleria:'Hotelería', traslado:'Traslado', tour:'Tour', seguro:'Seguro', otro:'Otro' }

        const sel = document.getElementById('asig-svc-select')
        const infoEl = document.getElementById('asig-proveedor-info')

        if (_serviciosDisponibles.length > 0) {
          // Separar: servicios del file de la TC vs resto
          const delFile  = _serviciosDisponibles.filter(s => Number(s.file_id) === _tcFileId)
          const otrosFiles = _serviciosDisponibles.filter(s => Number(s.file_id) !== _tcFileId)

          sel.innerHTML = ''

          // Grupo: servicios del file de la tarjeta (prioridad absoluta)
          if (delFile.length > 0) {
            const grpPrio = document.createElement('optgroup')
            grpPrio.label = '⭐ File #' + _tcFileNumero + ' — Este file (prioridad)'
            delFile.forEach(s => {
              const tipo  = (s.tipo_servicio || 'otro').toLowerCase()
              const icono = tipoIcono[tipo] || '📋'
              const label = tipoLabel[tipo] || tipo.toUpperCase()
              const opt = document.createElement('option')
              opt.value = s.id
              opt.textContent = icono + ' ' + label + ' · ' + (s.descripcion || '').substring(0, 45) +
                (s.fecha_inicio ? ' (' + s.fecha_inicio.substring(0,10) + ')' : '') +
                ' | $' + Number(s.costo_original||0).toFixed(2)
              opt.dataset.costo   = s.costo_original || 0
              opt.dataset.venta   = s.precio_venta   || 0
              opt.dataset.file    = s.file_numero    || ''
              opt.dataset.fileid  = s.file_id        || ''
              opt.dataset.cliente = s.cliente_nombre || ''
              opt.dataset.desc    = s.descripcion    || ''
              opt.dataset.tipo    = s.tipo_servicio  || ''
              grpPrio.appendChild(opt)
            })
            sel.appendChild(grpPrio)
          }

          // Opción en blanco separadora
          const optBlank = document.createElement('option')
          optBlank.value = ''
          optBlank.textContent = delFile.length > 0 ? '── Otros files ──' : '— Elegir servicio —'
          optBlank.disabled = otrosFiles.length === 0 && delFile.length > 0
          sel.insertBefore(optBlank, sel.firstChild)

          // Grupo: resto de files
          if (otrosFiles.length > 0) {
            const grpOtros = document.createElement('optgroup')
            grpOtros.label = 'Otros files'
            otrosFiles.forEach(s => {
              const tipo  = (s.tipo_servicio || 'otro').toLowerCase()
              const icono = tipoIcono[tipo] || '📋'
              const label = tipoLabel[tipo] || tipo.toUpperCase()
              const opt = document.createElement('option')
              opt.value = s.id
              opt.textContent = icono + ' ' + label + ' · [#' + s.file_numero + '] ' +
                (s.descripcion || '').substring(0, 35) +
                (s.fecha_inicio ? ' (' + s.fecha_inicio.substring(0,10) + ')' : '') +
                ' | $' + Number(s.costo_original||0).toFixed(2)
              opt.dataset.costo   = s.costo_original || 0
              opt.dataset.venta   = s.precio_venta   || 0
              opt.dataset.file    = s.file_numero    || ''
              opt.dataset.fileid  = s.file_id        || ''
              opt.dataset.cliente = s.cliente_nombre || ''
              opt.dataset.desc    = s.descripcion    || ''
              opt.dataset.tipo    = s.tipo_servicio  || ''
              grpOtros.appendChild(opt)
            })
            sel.appendChild(grpOtros)
          }

          // Info contextual
          if (delFile.length > 0) {
            infoEl.innerHTML = '<span style="color:#059669;font-weight:600;"><i class="fas fa-star"></i> ' +
              delFile.length + ' servicio(s) del file #' + _tcFileNumero + ' aparecen primero.</span>' +
              (otrosFiles.length > 0 ? ' + ' + otrosFiles.length + ' en otros files.' : '')
          } else {
            infoEl.textContent = _serviciosDisponibles.length + ' servicio(s) encontrado(s). Podés agregar uno o más, o confirmar sin seleccionar (saldo a favor).'
          }
        } else {
          sel.innerHTML = '<option value="">— Sin servicios disponibles —</option>'
          infoEl.innerHTML =
            '<span style="color:#d97706;"><i class="fas fa-exclamation-triangle"></i> No hay servicios de este proveedor en ningún file. El monto irá completo como saldo a favor.</span>'
        }
        actualizarResumen()
      }

      function onSvcSelectChange() {
        const sel = document.getElementById('asig-svc-select')
        const opt = sel.options[sel.selectedIndex]
        document.getElementById('asig-svc-error').style.display = 'none'
        if (!sel.value) { document.getElementById('asig-svc-detalle').textContent = ''; return }
        const costo = Number(opt.dataset.costo || 0)
        const venta = Number(opt.dataset.venta || 0)
        const file  = opt.dataset.file || ''
        const cli   = opt.dataset.cliente || ''
        document.getElementById('asig-svc-detalle').innerHTML =
          'File <strong>#' + file + '</strong> · ' + cli +
          ' · Costo: <strong>$' + costo.toFixed(2) + '</strong>' +
          ' · Venta: <strong>$' + venta.toFixed(2) + '</strong>'
        // Sugerir el disponible o el costo (lo que sea menor)
        const sugerido = Math.min(_tcDisponible, costo)
        if (sugerido > 0) document.getElementById('asig-svc-monto').value = sugerido.toFixed(2)
      }

      function validarSvcMonto() {
        const monto = Number(document.getElementById('asig-svc-monto').value || 0)
        const errDiv = document.getElementById('asig-svc-error')
        if (monto <= 0) { errDiv.textContent = 'Ingresá un monto válido.'; errDiv.style.display = 'block'; return false }
        if (monto > _tcDisponible + 0.001) {
          errDiv.textContent = 'Supera el disponible ($' + _tcDisponible.toFixed(2) + ').'
          errDiv.style.display = 'block'; return false
        }
        errDiv.style.display = 'none'; return true
      }

      function agregarServicioALista() {
        const sel   = document.getElementById('asig-svc-select')
        const opt   = sel.options[sel.selectedIndex]
        const svcId = Number(sel.value)
        const monto = Number(document.getElementById('asig-svc-monto').value || 0)
        if (!svcId) { document.getElementById('asig-svc-error').textContent = 'Elegí un servicio.'; document.getElementById('asig-svc-error').style.display = 'block'; return }
        if (!validarSvcMonto()) return
        // No repetir el mismo servicio
        if (_serviciosAgregados.find(a => a.svc_id === svcId)) {
          document.getElementById('asig-svc-error').textContent = 'Ya agregaste ese servicio. Modificá su monto en la lista.'; document.getElementById('asig-svc-error').style.display = 'block'; return
        }
        _serviciosAgregados.push({
          svc_id:      svcId,
          descripcion: (opt.dataset.tipo||'').toUpperCase() + (opt.dataset.desc ? ' – ' + opt.dataset.desc.substring(0,35) : ''),
          file_numero: opt.dataset.file || '',
          file_id:     opt.dataset.fileid || '',
          cliente:     opt.dataset.cliente || '',
          costo:       Number(opt.dataset.costo || 0),
          monto
        })
        // Limpiar selector
        sel.value = ''
        document.getElementById('asig-svc-monto').value = ''
        document.getElementById('asig-svc-detalle').textContent = ''
        document.getElementById('asig-svc-error').style.display = 'none'
        actualizarDisponible()
        renderServiciosLista()
        actualizarResumen()
      }

      function quitarServicio(idx) {
        _serviciosAgregados.splice(idx, 1)
        actualizarDisponible()
        renderServiciosLista()
        actualizarResumen()
      }

      function renderServiciosLista() {
        const wrap = document.getElementById('asig-servicios-lista')
        if (_serviciosAgregados.length === 0) {
          wrap.innerHTML = '<div style="font-size:12px;color:#9ca3af;padding:6px 0;font-style:italic;">Ningún servicio seleccionado — la tarjeta irá completa como saldo a favor del proveedor.</div>'
          return
        }
        let html = '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:8px;">'
        _serviciosAgregados.forEach((a, i) => {
          html += '<div style="padding:8px 12px;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between;align-items:center;background:' + (i%2===0?'#fff':'#f9fafb') + ';">'
          html += '<div style="font-size:12px;">'
          html += '<span style="font-weight:700;color:#1e3a5f;">' + a.descripcion + '</span>'
          html += ' <span style="color:#9ca3af;">(File #' + a.file_numero + ' · ' + a.cliente + ')</span>'
          html += '</div>'
          html += '<div style="display:flex;align-items:center;gap:10px;">'
          html += '<input type="number" value="' + a.monto.toFixed(2) + '" step="0.01" min="0.01" style="width:90px;padding:3px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;" onchange="editarMonto(' + i + ',this.value)">'
          html += '<button onclick="quitarServicio(' + i + ')" style="background:#fee2e2;color:#dc2626;border:none;border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">✕</button>'
          html += '</div></div>'
        })
        html += '</div>'
        wrap.innerHTML = html
      }

      function editarMonto(idx, val) {
        const m = Number(val)
        if (m > 0) { _serviciosAgregados[idx].monto = m }
        actualizarDisponible()
        actualizarResumen()
      }

      function actualizarResumen() {
        const provSel = document.getElementById('asig-proveedor')
        const provOpt = provSel.options[provSel.selectedIndex]
        const provNom = provOpt ? provOpt.textContent : ''
        if (!provSel.value) { document.getElementById('asig-resumen').style.display = 'none'; return }

        const totalSvc = _serviciosAgregados.reduce((s,a) => s+a.monto, 0)
        const saldoFavor = _tcMonto - totalSvc

        let html = ''
        html += '<div>Proveedor: <strong>' + provNom + '</strong></div>'
        html += '<div>Total tarjeta: <strong>' + _tcMoneda + ' $' + _tcMonto.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</strong></div>'
        if (_serviciosAgregados.length > 0) {
          html += '<div>Aplicado a servicios: <strong style="color:#7B3FA0;">$' + totalSvc.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</strong></div>'
        }
        if (saldoFavor > 0.001) {
          html += '<div>Saldo a favor del proveedor: <strong style="color:#059669;">$' + saldoFavor.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</strong></div>'
        } else if (saldoFavor < -0.001) {
          html += '<div style="color:#dc2626;"><i class="fas fa-exclamation-triangle"></i> Los servicios superan el monto de la tarjeta en $' + Math.abs(saldoFavor).toFixed(2) + '</div>'
        }
        document.getElementById('asig-resumen-body').innerHTML = html
        document.getElementById('asig-resumen').style.display = 'block'

        // Habilitar guardar solo si no hay saldo negativo
        const ok = saldoFavor >= -0.001
        document.getElementById('btn-guardar-asig').disabled = !ok
        document.getElementById('btn-guardar-asig').style.opacity = ok ? '1' : '0.5'
      }

      async function guardarAsignacion() {
        const provId = Number(document.getElementById('asig-proveedor').value)
        const notas  = document.getElementById('asig-notas').value.trim()
        const errDiv = document.getElementById('asig-error-global')
        const btn    = document.getElementById('btn-guardar-asig')
        if (!provId) { errDiv.textContent = 'Seleccioná un proveedor.'; errDiv.style.display = 'block'; return }

        const totalSvc = _serviciosAgregados.reduce((s,a) => s+a.monto, 0)
        if (totalSvc > _tcMonto + 0.001) {
          errDiv.textContent = 'Los servicios superan el monto de la tarjeta.'; errDiv.style.display = 'block'; return
        }

        btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'
        errDiv.style.display = 'none'

        try {
          const provSelEl = document.getElementById('asig-proveedor')
          const selOptGuardar = provSelEl.options[provSelEl.selectedIndex]
          const tablaOrigen = selOptGuardar?.dataset?.tabla || 'proveedor'
          const operadorIdAliasGuardar = Number(selOptGuardar?.dataset?.operadorId || 0)
          const payload = {
            tipo:              _tcTipo,
            tc_id:             _tcId,
            proveedor_id:      provId,
            tabla_origen:      tablaOrigen,    // 'proveedor' | 'operador'
            operador_id_alias: operadorIdAliasGuardar || null,  // ID en operadores cuando el proveedor tiene alias
            monto_total:       _tcMonto,
            servicios:    _serviciosAgregados.map(a => ({ servicio_id: a.svc_id, file_id: Number(a.file_id), monto: a.monto })),
            notas
          }
          const r = await fetch('/api/tarjetas/asignar-proveedor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          const data = await r.json()
          if (!r.ok || !data.ok) {
            errDiv.textContent = data.error || 'Error al guardar.'; errDiv.style.display = 'block'
            btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Confirmar Asignación'; return
          }
          cerrarModalAsignar()
          location.reload()
        } catch(e) {
          errDiv.textContent = 'Error de red.'; errDiv.style.display = 'block'
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Confirmar Asignación'
        }
      }

      // ── Modal ver asignaciones ──
      async function verAsignaciones(tcId, tipo, ult4) {
        document.getElementById('ver-asig-title').innerHTML = '<i class="fas fa-list"></i> Asignaciones · TC **** ' + ult4
        document.getElementById('ver-asig-body').innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280;">Cargando...</div>'
        document.getElementById('modal-ver-asig').style.display = 'flex'
        try {
          const r = await fetch('/api/tarjetas/' + tipo + '/' + tcId + '/asignaciones')
          const data = await r.json()
          const bodyEl = document.getElementById('ver-asig-body')
          if (!data.asignaciones || data.asignaciones.length === 0) {
            bodyEl.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;">Sin asignaciones registradas.</div>'; return
          }
          const estadoLabel = { tc_enviada:'⏳ TC Enviada', pagado:'✅ Pagado', tc_negada:'❌ TC Negada' }
          let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
          html += '<thead><tr style="background:#f8fafc;"><th style="padding:8px;text-align:left;">Proveedor</th><th style="padding:8px;text-align:left;">Servicio / File</th><th style="padding:8px;text-align:center;">Estado</th><th style="padding:8px;text-align:right;">Monto</th></tr></thead><tbody>'
          data.asignaciones.forEach((a,i) => {
            const bg = i%2===0?'#fff':'#f8fafc'
            html += '<tr style="background:'+bg+';border-bottom:1px solid #f3f4f6;">'
            html += '<td style="padding:8px;font-weight:600;color:#1e3a5f;">' + (a.proveedor_nombre||'—') + '</td>'
            html += '<td style="padding:8px;color:#374151;">' +
              (a.servicio_id ? (a.tipo_servicio||'').toUpperCase() + (a.descripcion?' – '+a.descripcion.substring(0,30):'') + '<br><span style="color:#9ca3af;font-size:10px;">File #'+(a.file_numero||'?')+'</span>' : '<em style="color:#9ca3af;">Saldo a favor</em>') + '</td>'
            html += '<td style="padding:8px;text-align:center;">' + (estadoLabel[a.estado]||a.estado) + '</td>'
            html += '<td style="padding:8px;text-align:right;font-weight:800;color:#7B3FA0;">$' + Number(a.monto).toLocaleString('es-UY',{minimumFractionDigits:2}) + '</td>'
            html += '</tr>'
          })
          html += '<tr style="background:#eff6ff;"><td colspan="3" style="padding:10px 8px;font-weight:700;color:#1e3a5f;">TOTAL</td>'
          html += '<td style="padding:10px 8px;text-align:right;font-weight:900;font-size:15px;color:#1e3a5f;">$' +
            Number(data.total_asignado||0).toLocaleString('es-UY',{minimumFractionDigits:2}) + '</td></tr>'
          html += '</tbody></table>'
          bodyEl.innerHTML = html
        } catch(e) {
          document.getElementById('ver-asig-body').innerHTML = '<div style="color:#dc2626;padding:16px;">Error al cargar.</div>'
        }
      }

      function cerrarVerAsig() {
        document.getElementById('modal-ver-asig').style.display = 'none'
      }

      async function revertirAutorizacion(tcId, tipo, ult4) {
        if (!confirm('¿Revertir la tarjeta **** ' + ult4 + ' a estado PENDIENTE?\\nSi tiene asignaciones activas deberás eliminarlas primero.')) return
        try {
          const r = await fetch('/api/tarjetas/revertir', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tc_id: tcId, tipo })
          })
          const data = await r.json()
          if (!r.ok || !data.ok) { alert('No se pudo revertir: ' + (data.error||'Error')); return }
          location.reload()
        } catch(e) { alert('Error de red.') }
      }
      </script>
    `
    return c.html(baseLayout('Tarjetas en Cartera', content, user, 'tesoreria'))
  } catch (e: any) {
    return c.html(baseLayout('Tarjetas en Cartera', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'tesoreria'))
  }
})

// ── POST: Autorizar/Rechazar TC de CLIENTE ───────────────────
tesoreria.post('/tesoreria/tarjetas/autorizar-cliente', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/tesoreria/tarjetas')
  const body   = await c.req.parseBody()
  const tcId   = Number(body.tc_id)
  const accion = String(body.accion || '')
  if (!Number.isInteger(tcId) || tcId <= 0 || !['autorizar','rechazar'].includes(accion)) {
    return c.redirect('/tesoreria/tarjetas?error=datos_invalidos')
  }
  try {
    if (accion === 'autorizar') {
      await c.env.DB.prepare(
        `UPDATE cliente_tarjetas SET estado='autorizada', fecha_autorizacion=datetime('now'), autorizado_por_usuario=? WHERE id=?`
      ).bind(user.id, tcId).run()

      // Marcar servicios con asignaciones de esta TC como 'pagado'
      const asigs = await c.env.DB.prepare(
        `SELECT * FROM tarjeta_asignaciones WHERE cliente_tarjeta_id = ? AND servicio_id IS NOT NULL`
      ).bind(tcId).all().catch(() => ({ results: [] }))
      for (const a of (asigs.results as any[])) {
        await c.env.DB.prepare(
          `UPDATE servicios SET estado_pago_proveedor='pagado', prepago_realizado=1 WHERE id=?`
        ).bind(a.servicio_id).run().catch(() => {})
        await c.env.DB.prepare(
          `UPDATE tarjeta_asignaciones SET estado='pagado' WHERE id=?`
        ).bind(a.id).run().catch(() => {})
      }
    } else {
      // Rechazar TC
      await c.env.DB.prepare(
        `UPDATE cliente_tarjetas SET estado='rechazada', fecha_autorizacion=datetime('now'), autorizado_por_usuario=? WHERE id=?`
      ).bind(user.id, tcId).run()

      // Marcar servicios con asignaciones de esta TC como 'tc_negada' y crear alertas
      const asigs = await c.env.DB.prepare(
        `SELECT ta.*, f.vendedor_id FROM tarjeta_asignaciones ta
         LEFT JOIN servicios s ON s.id = ta.servicio_id
         LEFT JOIN files f ON f.id = ta.file_id
         WHERE ta.cliente_tarjeta_id = ? AND ta.servicio_id IS NOT NULL`
      ).bind(tcId).all().catch(() => ({ results: [] }))
      for (const a of (asigs.results as any[])) {
        await c.env.DB.prepare(
          `UPDATE servicios SET estado_pago_proveedor='tc_negada' WHERE id=?`
        ).bind(a.servicio_id).run().catch(() => {})
        await c.env.DB.prepare(
          `UPDATE tarjeta_asignaciones SET estado='tc_negada' WHERE id=?`
        ).bind(a.id).run().catch(() => {})
        // Crear alerta para el vendedor
        if (a.file_id) {
          await c.env.DB.prepare(`
            INSERT INTO alertas_tc (cliente_tarjeta_id, asignacion_id, servicio_id, file_id, vendedor_usuario_id, monto, moneda, proveedor_id, motivo, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Tarjeta rechazada', 'pendiente')
          `).bind(tcId, a.id, a.servicio_id, a.file_id, a.vendedor_id || null, a.monto, a.moneda || 'USD', a.proveedor_id || null).run().catch(() => {})
        }
      }
    }
    return c.redirect('/tesoreria/tarjetas?ok=1')
  } catch (e: any) {
    return c.redirect('/tesoreria/tarjetas?error=error_interno')
  }
})

// ══════════════════════════════════════════════════════════════
// GET /tesoreria/transferencias — Listado + formulario
// ══════════════════════════════════════════════════════════════
tesoreria.get('/tesoreria/transferencias', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/tesoreria?error=sin_permiso')

  try {
    const success = c.req.query('success') || ''
    const error   = c.req.query('error')   || ''

    // Traer todas las transferencias con datos de bancos y usuarios
    const transferencias = await c.env.DB.prepare(`
      SELECT
        t.*,
        bo.nombre_entidad  AS banco_origen_nombre,
        bo.moneda          AS banco_origen_moneda,
        bd.nombre_entidad  AS banco_destino_nombre,
        bd.moneda          AS banco_destino_moneda,
        u.nombre           AS usuario_nombre,
        ua.nombre          AS anulado_por_nombre
      FROM transferencias_bancarias t
      LEFT JOIN bancos  bo ON t.banco_origen_id  = bo.id
      LEFT JOIN bancos  bd ON t.banco_destino_id = bd.id
      LEFT JOIN usuarios u  ON t.usuario_id             = u.id
      LEFT JOIN usuarios ua ON t.anulado_por_usuario    = ua.id
      ORDER BY t.fecha DESC
      LIMIT 100
    `).all()

    // Bancos activos para el formulario
    const bancos = await c.env.DB.prepare(
      `SELECT id, nombre_entidad, moneda FROM bancos WHERE activo=1 ORDER BY nombre_entidad`
    ).all()

    const cotHoy = await c.env.DB.prepare(
      `SELECT moneda_origen, moneda_destino, valor FROM cotizaciones WHERE fecha = date('now')`
    ).all()
    const cot: Record<string, number> = {}
    for (const r of cotHoy.results as any[]) {
      cot[`${r.moneda_origen}_${r.moneda_destino}`] = r.valor
    }

    const successMsg = success === 'creada'  ? '✅ Transferencia registrada correctamente.'
                     : success === 'anulada' ? '✅ Transferencia anulada. Los movimientos fueron revertidos.'
                     : ''
    const errorMsg   = error === 'misma_cuenta'    ? 'La cuenta origen y destino no pueden ser la misma.'
                     : error === 'monto_invalido'  ? 'Los montos deben ser mayores a cero.'
                     : error === 'banco_invalido'  ? 'Cuenta bancaria no encontrada o cerrada.'
                     : error === 'sin_permiso'     ? 'No tenés permiso para esta acción.'
                     : error === 'no_encontrada'   ? 'Transferencia no encontrada.'
                     : error === 'ya_anulada'      ? 'La transferencia ya fue anulada.'
                     : error === 'motivo_requerido'? 'El motivo de anulación es obligatorio.'
                     : ''

    const filaTransferencia = (t: any) => {
      const anulado = t.anulado === 1
      const fecha   = (t.fecha || '').split('T')[0]
      const arb     = Number(t.arbitraje_usd)
      const arbStr  = arb === 0 ? '—'
                    : arb > 0   ? `<span style="color:#059669;font-weight:700;">+$${arb.toFixed(4)}</span>`
                    :             `<span style="color:#dc2626;font-weight:700;">-$${Math.abs(arb).toFixed(4)}</span>`

      return `
        <tr style="${anulado ? 'opacity:0.5;text-decoration:line-through;background:#fef2f2;' : ''}">
          <td style="font-size:12px;color:#6b7280;">${fecha}</td>
          <td>
            <div style="font-size:12px;font-weight:700;color:#dc2626;">
              <i class="fas fa-arrow-right" style="font-size:10px;"></i>
              ${esc(t.banco_origen_nombre)} (${esc(t.banco_origen_moneda)})
            </div>
            <div style="font-size:12px;font-weight:700;color:#059669;">
              <i class="fas fa-arrow-left" style="font-size:10px;"></i>
              ${esc(t.banco_destino_nombre)} (${esc(t.banco_destino_moneda)})
            </div>
          </td>
          <td>
            <div style="font-size:13px;font-weight:700;color:#dc2626;">
              − ${Number(t.monto_debito).toLocaleString('es-UY',{minimumFractionDigits:2})} ${esc(t.moneda_debito)}
            </div>
            <div style="font-size:13px;font-weight:700;color:#059669;">
              + ${Number(t.monto_credito).toLocaleString('es-UY',{minimumFractionDigits:2})} ${esc(t.moneda_credito)}
            </div>
          </td>
          <td style="text-align:center;">${arbStr}</td>
          <td style="font-size:12px;color:#6b7280;">${esc(t.concepto || '—')}</td>
          <td style="font-size:12px;">${esc(t.usuario_nombre || '—')}</td>
          <td style="text-align:center;">
            ${anulado
              ? `<span class="badge badge-anulado" title="Anulada por ${esc(t.anulado_por_nombre||'?')}: ${esc(t.motivo_anulacion||'')}">ANULADA</span>`
              : `<button onclick="abrirAnularTransf(${t.id})"
                  class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;font-size:11px;">
                  <i class="fas fa-times"></i> Anular
                </button>`
            }
          </td>
        </tr>
      `
    }

    const content = `
      ${successMsg ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> ${successMsg}</div>` : ''}
      ${errorMsg   ? `<div class="alert alert-danger"  style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> ${errorMsg}</div>`   : ''}

      <!-- Formulario nueva transferencia -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-exchange-alt" style="color:#F7941D"></i> Nueva Transferencia entre Cuentas
          </span>
        </div>
        <div class="card-body">
          <form method="POST" action="/tesoreria/transferencias" onsubmit="return validarTransferencia(event)">

            <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:start;margin-bottom:16px;">

              <!-- Columna ORIGEN -->
              <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:10px;padding:16px;">
                <div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:12px;letter-spacing:1px;">
                  <i class="fas fa-arrow-circle-right"></i> CUENTA ORIGEN (DÉBITO)
                </div>
                <div class="form-group">
                  <label class="form-label">CUENTA *</label>
                  <select name="banco_origen_id" id="sel-origen" required class="form-control"
                    onchange="actualizarMonedaOrigen(this)">
                    <option value="">— Seleccionar —</option>
                    ${(bancos.results as any[]).map((b: any) =>
                      `<option value="${b.id}" data-moneda="${b.moneda}">${esc(b.nombre_entidad)} (${b.moneda})</option>`
                    ).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">MONTO QUE SALE *</label>
                  <div style="display:flex;gap:8px;align-items:center;">
                    <input type="number" name="monto_debito" id="inp-debito"
                      required min="0.01" step="0.01" class="form-control"
                      placeholder="0.00" oninput="calcArbitraje()">
                    <span id="lbl-moneda-origen" style="font-weight:700;color:#dc2626;white-space:nowrap;font-size:14px;">—</span>
                  </div>
                </div>
                <div id="panel-cot-origen" style="display:none;">
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:10px;">COTIZACIÓN → USD</label>
                    <input type="number" name="cotizacion_debito" id="inp-cot-origen"
                      step="0.0001" min="0.0001" value="1" class="form-control"
                      style="font-size:13px;" oninput="calcArbitraje()">
                  </div>
                </div>
              </div>

              <!-- Flecha central + arbitraje -->
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:40px;gap:10px;">
                <i class="fas fa-exchange-alt" style="font-size:28px;color:#7B3FA0;"></i>
                <div style="text-align:center;">
                  <div style="font-size:10px;color:#9ca3af;margin-bottom:2px;">ARBITRAJE</div>
                  <div id="lbl-arbitraje" style="font-size:15px;font-weight:800;color:#7B3FA0;">—</div>
                  <div style="font-size:10px;color:#9ca3af;">USD</div>
                </div>
              </div>

              <!-- Columna DESTINO -->
              <div style="background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:16px;">
                <div style="font-size:12px;font-weight:700;color:#059669;margin-bottom:12px;letter-spacing:1px;">
                  <i class="fas fa-arrow-circle-left"></i> CUENTA DESTINO (CRÉDITO)
                </div>
                <div class="form-group">
                  <label class="form-label">CUENTA *</label>
                  <select name="banco_destino_id" id="sel-destino" required class="form-control"
                    onchange="actualizarMonedaDestino(this)">
                    <option value="">— Seleccionar —</option>
                    ${(bancos.results as any[]).map((b: any) =>
                      `<option value="${b.id}" data-moneda="${b.moneda}">${esc(b.nombre_entidad)} (${b.moneda})</option>`
                    ).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">MONTO QUE ENTRA *</label>
                  <div style="display:flex;gap:8px;align-items:center;">
                    <input type="number" name="monto_credito" id="inp-credito"
                      required min="0.01" step="0.01" class="form-control"
                      placeholder="0.00" oninput="calcArbitraje()">
                    <span id="lbl-moneda-destino" style="font-weight:700;color:#059669;white-space:nowrap;font-size:14px;">—</span>
                  </div>
                </div>
                <div id="panel-cot-destino" style="display:none;">
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label" style="font-size:10px;">COTIZACIÓN → USD</label>
                    <input type="number" name="cotizacion_credito" id="inp-cot-destino"
                      step="0.0001" min="0.0001" value="1" class="form-control"
                      style="font-size:13px;" oninput="calcArbitraje()">
                  </div>
                </div>
              </div>
            </div>

            <!-- Cotizaciones ocultas para USD (siempre 1) -->
            <div id="row-concepto" style="margin-bottom:16px;">
              <label class="form-label">CONCEPTO / REFERENCIA</label>
              <input type="text" name="concepto" class="form-control"
                placeholder="Ej: Fondeo cuenta operativa, Cambio de divisas, etc." maxlength="500">
            </div>

            <div id="err-transferencia" style="display:none;color:#dc2626;font-size:13px;margin-bottom:12px;padding:8px 12px;background:#fef2f2;border-radius:6px;border:1px solid #fecaca;"></div>

            <div style="display:flex;gap:10px;align-items:center;">
              <button type="submit" class="btn btn-primary">
                <i class="fas fa-exchange-alt"></i> Registrar Transferencia
              </button>
              <div style="font-size:12px;color:#6b7280;">
                <i class="fas fa-info-circle"></i>
                Se generarán 2 movimientos vinculados (egreso en origen + ingreso en destino).
              </div>
            </div>
          </form>
        </div>
      </div>

      <!-- Historial de transferencias -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-history" style="color:#7B3FA0"></i> Historial de Transferencias
          </span>
        </div>
        <div class="card-body" style="padding:0;">
          ${transferencias.results.length === 0
            ? `<div style="text-align:center;padding:30px;color:#9ca3af;">
                <i class="fas fa-exchange-alt" style="font-size:28px;margin-bottom:10px;display:block;"></i>
                Sin transferencias registradas.
               </div>`
            : `<div class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Cuentas</th>
                      <th>Importes</th>
                      <th>Arbitraje USD</th>
                      <th>Concepto</th>
                      <th>Usuario</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(transferencias.results as any[]).map(filaTransferencia).join('')}
                  </tbody>
                </table>
               </div>`
          }
        </div>
      </div>

      <!-- Modal anular transferencia -->
      <div class="modal-overlay" id="modal-anular-transf">
        <div class="modal" style="max-width:480px;">
          <div class="modal-header">
            <span class="modal-title">
              <i class="fas fa-times-circle" style="color:#dc2626"></i> Anular Transferencia
            </span>
            <button type="button" class="modal-close"
              onclick="document.getElementById('modal-anular-transf').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#92400e;">
              <i class="fas fa-exclamation-triangle"></i>
              <strong>Atención:</strong> Se anularán los 2 movimientos vinculados (egreso y ingreso).
              Esta acción queda registrada y no se puede deshacer.
            </div>
            <form method="POST" id="form-anular-transf">
              <input type="hidden" name="transferencia_id" id="anular-transf-id">
              <div class="form-group">
                <label class="form-label">MOTIVO DE ANULACIÓN *</label>
                <textarea name="motivo" id="anular-motivo" required rows="3"
                  class="form-control" placeholder="Describe el motivo de la anulación..." maxlength="500"></textarea>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-sm"
                  style="background:#dc2626;color:white;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;">
                  <i class="fas fa-times"></i> Confirmar anulación
                </button>
                <button type="button" class="btn btn-outline"
                  onclick="document.getElementById('modal-anular-transf').classList.remove('active')">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
        // Cotizaciones del día cargadas al abrir la página
        const _cotTransf = ${JSON.stringify(cot)}

        function actualizarMonedaOrigen(sel) {
          const moneda = sel.options[sel.selectedIndex]?.dataset?.moneda || ''
          document.getElementById('lbl-moneda-origen').textContent = moneda || '—'
          const panel = document.getElementById('panel-cot-origen')
          const inp   = document.getElementById('inp-cot-origen')
          if (moneda && moneda !== 'USD') {
            panel.style.display = 'block'
            const cot = _cotTransf['USD_' + moneda] ? (1 / _cotTransf['USD_' + moneda]) : (_cotTransf[moneda + '_USD'] || '')
            inp.value = cot ? Number(cot).toFixed(4) : ''
          } else {
            panel.style.display = 'none'
            inp.value = '1'
          }
          calcArbitraje()
        }

        function actualizarMonedaDestino(sel) {
          const moneda = sel.options[sel.selectedIndex]?.dataset?.moneda || ''
          document.getElementById('lbl-moneda-destino').textContent = moneda || '—'
          const panel = document.getElementById('panel-cot-destino')
          const inp   = document.getElementById('inp-cot-destino')
          if (moneda && moneda !== 'USD') {
            panel.style.display = 'block'
            const cot = _cotTransf['USD_' + moneda] ? (1 / _cotTransf['USD_' + moneda]) : (_cotTransf[moneda + '_USD'] || '')
            inp.value = cot ? Number(cot).toFixed(4) : ''
          } else {
            panel.style.display = 'none'
            inp.value = '1'
          }
          calcArbitraje()
        }

        function calcArbitraje() {
          const debito   = parseFloat(document.getElementById('inp-debito').value)  || 0
          const credito  = parseFloat(document.getElementById('inp-credito').value) || 0
          const cotOrig  = parseFloat(document.getElementById('inp-cot-origen').value)  || 1
          const cotDest  = parseFloat(document.getElementById('inp-cot-destino').value) || 1
          const monedaO  = document.getElementById('lbl-moneda-origen').textContent.trim()
          const monedaD  = document.getElementById('lbl-moneda-destino').textContent.trim()

          // Convertir ambos montos a USD
          let debitoUSD  = monedaO === 'USD' ? debito  : debito  * cotOrig
          let creditoUSD = monedaD === 'USD' ? credito : credito * cotDest

          const arb = creditoUSD - debitoUSD
          const lbl = document.getElementById('lbl-arbitraje')

          if (!debito || !credito || monedaO === '—' || monedaD === '—') {
            lbl.textContent = '—'
            lbl.style.color = '#7B3FA0'
            return
          }
          if (Math.abs(arb) < 0.001) {
            lbl.textContent = '± 0.00'
            lbl.style.color = '#6b7280'
          } else if (arb > 0) {
            lbl.textContent = '+' + arb.toFixed(4)
            lbl.style.color = '#059669'
          } else {
            lbl.textContent = arb.toFixed(4)
            lbl.style.color = '#dc2626'
          }
        }

        function validarTransferencia(e) {
          const err    = document.getElementById('err-transferencia')
          const origen = document.getElementById('sel-origen').value
          const dest   = document.getElementById('sel-destino').value
          const deb    = parseFloat(document.getElementById('inp-debito').value)
          const cred   = parseFloat(document.getElementById('inp-credito').value)

          err.style.display = 'none'
          if (!origen || !dest) {
            err.textContent = 'Seleccioná las cuentas de origen y destino.'
            err.style.display = 'block'; return false
          }
          if (origen === dest) {
            err.textContent = 'La cuenta origen y destino no pueden ser la misma.'
            err.style.display = 'block'; return false
          }
          if (!deb || deb <= 0 || !cred || cred <= 0) {
            err.textContent = 'Los montos deben ser mayores a cero.'
            err.style.display = 'block'; return false
          }
          return true
        }

        function abrirAnularTransf(id) {
          document.getElementById('anular-transf-id').value = id
          document.getElementById('anular-motivo').value    = ''
          document.getElementById('form-anular-transf').action = '/tesoreria/transferencias/' + id + '/anular'
          document.getElementById('modal-anular-transf').classList.add('active')
        }
      </script>
    `

    return c.html(baseLayout('Transferencias', content, user, 'tesoreria'))
  } catch (e: any) {
    console.error('[TRANSFERENCIAS]', e.message)
    return c.html(baseLayout('Transferencias',
      `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'tesoreria'))
  }
})

// ══════════════════════════════════════════════════════════════
// POST /tesoreria/transferencias — Crear transferencia
// ══════════════════════════════════════════════════════════════
tesoreria.post('/tesoreria/transferencias', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/tesoreria/transferencias?error=sin_permiso')

  try {
    const b = await c.req.parseBody()

    const bancoOrigenId  = Number(b.banco_origen_id)
    const bancoDestinoId = Number(b.banco_destino_id)
    const montoDebito    = Number(b.monto_debito)
    const montoCredito   = Number(b.monto_credito)
    const cotDebito      = Number(b.cotizacion_debito  || 1)
    const cotCredito     = Number(b.cotizacion_credito || 1)
    const concepto       = String(b.concepto || '').trim().substring(0, 500) || 'Transferencia entre cuentas'

    // Validaciones
    if (!Number.isInteger(bancoOrigenId)  || bancoOrigenId  <= 0) return c.redirect('/tesoreria/transferencias?error=banco_invalido')
    if (!Number.isInteger(bancoDestinoId) || bancoDestinoId <= 0) return c.redirect('/tesoreria/transferencias?error=banco_invalido')
    if (bancoOrigenId === bancoDestinoId)                         return c.redirect('/tesoreria/transferencias?error=misma_cuenta')
    if (!isFinite(montoDebito)  || montoDebito  <= 0)             return c.redirect('/tesoreria/transferencias?error=monto_invalido')
    if (!isFinite(montoCredito) || montoCredito <= 0)             return c.redirect('/tesoreria/transferencias?error=monto_invalido')

    // Verificar que los bancos existen y están activos
    const bancoOrigen  = await c.env.DB.prepare(`SELECT id, moneda FROM bancos WHERE id=? AND activo=1`).bind(bancoOrigenId).first()  as any
    const bancoDestino = await c.env.DB.prepare(`SELECT id, moneda FROM bancos WHERE id=? AND activo=1`).bind(bancoDestinoId).first() as any
    if (!bancoOrigen || !bancoDestino) return c.redirect('/tesoreria/transferencias?error=banco_invalido')

    const monedaDebito  = bancoOrigen.moneda
    const monedaCredito = bancoDestino.moneda

    // Calcular arbitraje en USD
    const debitoUSD  = monedaDebito  === 'USD' ? montoDebito  : montoDebito  * cotDebito
    const creditoUSD = monedaCredito === 'USD' ? montoCredito : montoCredito * cotCredito
    const arbitrajeUSD = Math.round((creditoUSD - debitoUSD) * 100000) / 100000

    const conceptoEgreso  = `[Transferencia] Salida → ${concepto}`
    const conceptoIngreso = `[Transferencia] Entrada ← ${concepto}`

    // Insertar egreso en cuenta origen
    const resEgreso = await c.env.DB.prepare(`
      INSERT INTO movimientos_caja
        (tipo, metodo, moneda, monto, cotizacion, monto_uyu, banco_id, concepto, usuario_id, fecha)
      VALUES ('egreso', 'transferencia', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      monedaDebito,
      montoDebito,
      monedaDebito === 'USD' ? 1 : cotDebito,
      monedaDebito === 'UYU' ? montoDebito : montoDebito * (monedaDebito === 'USD' ? 1 : cotDebito),
      bancoOrigenId,
      conceptoEgreso,
      user.id
    ).run()
    const movEgresoId = resEgreso.meta?.last_row_id as number

    // Insertar ingreso en cuenta destino
    const resIngreso = await c.env.DB.prepare(`
      INSERT INTO movimientos_caja
        (tipo, metodo, moneda, monto, cotizacion, monto_uyu, banco_id, concepto, usuario_id, fecha)
      VALUES ('ingreso', 'transferencia', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      monedaCredito,
      montoCredito,
      monedaCredito === 'USD' ? 1 : cotCredito,
      monedaCredito === 'UYU' ? montoCredito : montoCredito * (monedaCredito === 'USD' ? 1 : cotCredito),
      bancoDestinoId,
      conceptoIngreso,
      user.id
    ).run()
    const movIngresoId = resIngreso.meta?.last_row_id as number

    // Insertar registro de transferencia vinculando los 2 movimientos
    await c.env.DB.prepare(`
      INSERT INTO transferencias_bancarias
        (mov_egreso_id, mov_ingreso_id, banco_origen_id, banco_destino_id,
         monto_debito, moneda_debito, monto_credito, moneda_credito,
         arbitraje_usd, cotizacion_debito, cotizacion_credito,
         concepto, usuario_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      movEgresoId, movIngresoId,
      bancoOrigenId, bancoDestinoId,
      montoDebito, monedaDebito,
      montoCredito, monedaCredito,
      arbitrajeUSD, cotDebito, cotCredito,
      concepto, user.id
    ).run()

    return c.redirect('/tesoreria/transferencias?success=creada')
  } catch (e: any) {
    console.error('[TRANSFERENCIAS POST]', e.message)
    return c.redirect('/tesoreria/transferencias?error=error_interno')
  }
})

// ══════════════════════════════════════════════════════════════
// POST /tesoreria/transferencias/:id/anular — Anular transferencia
// ══════════════════════════════════════════════════════════════
tesoreria.post('/tesoreria/transferencias/:id/anular', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/tesoreria/transferencias?error=sin_permiso')

  try {
    const id     = Number(c.req.param('id'))
    const body   = await c.req.parseBody()
    const motivo = String(body.motivo || '').trim().substring(0, 500)

    if (!Number.isInteger(id) || id <= 0) return c.redirect('/tesoreria/transferencias?error=no_encontrada')
    if (!motivo)                           return c.redirect('/tesoreria/transferencias?error=motivo_requerido')

    // Verificar que existe y no está anulada
    const transf = await c.env.DB.prepare(
      `SELECT * FROM transferencias_bancarias WHERE id=?`
    ).bind(id).first() as any
    if (!transf)             return c.redirect('/tesoreria/transferencias?error=no_encontrada')
    if (transf.anulado === 1) return c.redirect('/tesoreria/transferencias?error=ya_anulada')

    // Anular los 2 movimientos vinculados
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE movimientos_caja SET anulado=1 WHERE id=?`).bind(transf.mov_egreso_id),
      c.env.DB.prepare(`UPDATE movimientos_caja SET anulado=1 WHERE id=?`).bind(transf.mov_ingreso_id),
      c.env.DB.prepare(`
        UPDATE transferencias_bancarias
        SET anulado=1, motivo_anulacion=?, anulado_por_usuario=?, anulado_at=datetime('now')
        WHERE id=?
      `).bind(motivo, user.id, id),
    ])

    return c.redirect('/tesoreria/transferencias?success=anulada')
  } catch (e: any) {
    console.error('[TRANSFERENCIAS ANULAR]', e.message)
    return c.redirect('/tesoreria/transferencias?error=error_interno')
  }
})

// ══════════════════════════════════════════════════════════════════
// ASIGNACIONES DE TARJETAS A SERVICIOS/PROVEEDORES
// ══════════════════════════════════════════════════════════════════

// Helper: auto-crear tabla tarjeta_asignaciones si no existe
async function ensureTarjetaAsignaciones(db: any) {
  // Paso 1: crear tabla si no existe (schema correcto con columnas opcionales)
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS tarjeta_asignaciones (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_tarjeta_id    INTEGER,
      proveedor_tarjeta_id  INTEGER,
      proveedor_id          INTEGER NOT NULL,
      servicio_id           INTEGER,
      file_id               INTEGER,
      monto                 REAL NOT NULL CHECK(monto > 0),
      moneda                TEXT NOT NULL DEFAULT 'USD',
      estado                TEXT NOT NULL DEFAULT 'tc_enviada',
      notas                 TEXT,
      creado_por_usuario    INTEGER,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {})

  // Paso 2: agregar columna estado si no existe
  await db.prepare(`ALTER TABLE tarjeta_asignaciones ADD COLUMN estado TEXT NOT NULL DEFAULT 'tc_enviada'`).run().catch(() => {})

  // Paso 3: detectar si servicio_id / file_id tienen NOT NULL constraint (migración 0018 antigua)
  // Si es así, recrear la tabla preservando los datos
  try {
    const info = await db.prepare(`PRAGMA table_info(tarjeta_asignaciones)`).all()
    const cols = (info.results || []) as any[]
    const svcCol  = cols.find((c: any) => c.name === 'servicio_id')
    const fileCol = cols.find((c: any) => c.name === 'file_id')
    const needsRebuild = (svcCol?.notnull === 1) || (fileCol?.notnull === 1)
    if (needsRebuild) {
      // Recrear tabla sin NOT NULL en servicio_id y file_id
      await db.prepare(`ALTER TABLE tarjeta_asignaciones RENAME TO tarjeta_asignaciones_v1`).run()
      await db.prepare(`
        CREATE TABLE tarjeta_asignaciones (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_tarjeta_id    INTEGER,
          proveedor_tarjeta_id  INTEGER,
          proveedor_id          INTEGER NOT NULL,
          servicio_id           INTEGER,
          file_id               INTEGER,
          monto                 REAL NOT NULL CHECK(monto > 0),
          moneda                TEXT NOT NULL DEFAULT 'USD',
          estado                TEXT NOT NULL DEFAULT 'tc_enviada',
          notas                 TEXT,
          creado_por_usuario    INTEGER,
          created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run()
      await db.prepare(`
        INSERT INTO tarjeta_asignaciones
          SELECT id, cliente_tarjeta_id, proveedor_tarjeta_id, proveedor_id,
                 servicio_id, file_id, monto, moneda,
                 COALESCE(estado, 'tc_enviada'), notas, creado_por_usuario, created_at
          FROM tarjeta_asignaciones_v1
      `).run()
      await db.prepare(`DROP TABLE tarjeta_asignaciones_v1`).run()
    }
  } catch (_) { /* si algo falla, continuar igual */ }

  // Paso 4: índices
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_ta_cli_tc  ON tarjeta_asignaciones(cliente_tarjeta_id)`).run().catch(() => {})
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_ta_prov_tc ON tarjeta_asignaciones(proveedor_tarjeta_id)`).run().catch(() => {})
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_ta_svc     ON tarjeta_asignaciones(servicio_id)`).run().catch(() => {})
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_ta_estado  ON tarjeta_asignaciones(estado)`).run().catch(() => {})
}

// ── API: servicios de un proveedor (para poblar el modal de asignación) ──
tesoreria.get('/api/tarjetas/servicios-proveedor', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'Sin permiso' }, 403)

  const entidadId     = Number(c.req.query('proveedor_id') || 0)
  const tablaOrigen   = c.req.query('tabla') || 'proveedor'   // 'proveedor' | 'operador'
  // operador_id_alias: cuando el proveedor tiene un alias en la tabla operadores (mismo nombre)
  const operadorIdAlias = Number(c.req.query('operador_id_alias') || 0)
  // file_id: file al que pertenece la tarjeta, para priorizar sus servicios
  const fileIdPriority = Number(c.req.query('file_id') || 0)
  if (!entidadId) return c.json({ servicios: [] })

  try {
    let whereClause: string
    let bindParams: any[]

    if (tablaOrigen === 'operador') {
      // Entidad es un operador puro → buscar por operador_id directo
      // También incluir proveedor con mismo nombre (fallback)
      const entidadRow = await c.env.DB.prepare(`SELECT nombre FROM operadores WHERE id = ?`).bind(entidadId).first() as any
      const nombre = entidadRow?.nombre || ''
      whereClause = `s.operador_id = ? OR s.proveedor_id IN (SELECT id FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)))`
      bindParams = [entidadId, nombre]
    } else {
      // Entidad es un proveedor → buscar por proveedor_id
      // Si el frontend envió operador_id_alias (operador con mismo nombre), también buscar por ese operador_id
      // Esto cubre el caso Sevens: proveedor_id=X en proveedores, operador_id=Y en operadores
      if (operadorIdAlias) {
        // Búsqueda directa por ambos IDs — sin depender de joins por nombre
        whereClause = `s.proveedor_id = ? OR s.operador_id = ?`
        bindParams = [entidadId, operadorIdAlias]
      } else {
        // Fallback: buscar por proveedor_id y cross-join por nombre
        const entidadRow = await c.env.DB.prepare(`SELECT nombre FROM proveedores WHERE id = ?`).bind(entidadId).first() as any
        const nombre = entidadRow?.nombre || ''
        whereClause = `s.proveedor_id = ? OR s.operador_id IN (SELECT id FROM operadores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)))`
        bindParams = [entidadId, nombre]
      }
    }

    // Ordenar: primero los servicios del file de la tarjeta, luego el resto por fecha
    const orderClause = fileIdPriority
      ? `CASE WHEN f.id = ${fileIdPriority} THEN 0 ELSE 1 END, s.fecha_inicio DESC, s.id DESC`
      : `s.fecha_inicio DESC, s.id DESC`

    const rows = await c.env.DB.prepare(`
      SELECT s.id, s.tipo_servicio, s.descripcion, s.nro_ticket,
             s.fecha_inicio, s.precio_venta, s.costo_original,
             s.moneda_origen as moneda,
             s.proveedor_id, s.operador_id,
             f.id as file_id, f.numero as file_numero,
             COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo) as cliente_nombre,
             p.nombre as proveedor_nombre, o.nombre as operador_nombre
      FROM servicios s
      JOIN files f ON f.id = s.file_id
      JOIN clientes cl ON cl.id = f.cliente_id
      LEFT JOIN proveedores p ON p.id = s.proveedor_id
      LEFT JOIN operadores o  ON o.id  = s.operador_id
      WHERE s.estado != 'cancelado'
        AND f.estado != 'anulado'
        AND (${whereClause})
      ORDER BY ${orderClause}
      LIMIT 200
    `).bind(...bindParams).all()

    return c.json({ servicios: rows.results, tipo: tablaOrigen, file_id_priority: fileIdPriority })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── API: asignaciones existentes de una tarjeta ──
tesoreria.get('/api/tarjetas/:tipo/:id/asignaciones', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'Sin permiso' }, 403)
  const tipo = c.req.param('tipo')
  const tcId = Number(c.req.param('id'))
  if (!tcId) return c.json({ asignaciones: [], total_asignado: 0 })
  await ensureTarjetaAsignaciones(c.env.DB)
  try {
    const campo = tipo === 'cliente' ? 'cliente_tarjeta_id' : 'proveedor_tarjeta_id'
    const rows = await c.env.DB.prepare(`
      SELECT ta.*, p.nombre as proveedor_nombre,
             s.tipo_servicio, s.descripcion, s.nro_ticket,
             f.numero as file_numero
      FROM tarjeta_asignaciones ta
      JOIN proveedores p ON p.id = ta.proveedor_id
      LEFT JOIN servicios s ON s.id = ta.servicio_id
      LEFT JOIN files f     ON f.id = ta.file_id
      WHERE ta.${campo} = ?
      ORDER BY ta.created_at DESC
    `).bind(tcId).all()
    const asignaciones = rows.results as any[]
    const total_asignado = asignaciones.reduce((sum, a) => sum + Number(a.monto), 0)
    return c.json({ asignaciones, total_asignado })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── API: asignar tarjeta a proveedor (nuevo flujo completo) ──
// Recibe: tipo (origen tc), tc_id, proveedor_id, monto_total, servicios[], notas
// Crea una asignación por servicio + una asignación de saldo a favor si sobra
tesoreria.post('/api/tarjetas/asignar-proveedor', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'Sin permiso' }, 403)
  await ensureTarjetaAsignaciones(c.env.DB)

  try {
    const body             = await c.req.json() as any
    const tipo             = String(body.tipo || '')         // 'cliente' | 'proveedor' (origen de la TC)
    const tcId             = Number(body.tc_id)
    const entidadId        = Number(body.proveedor_id)
    const tablaOrigen      = String(body.tabla_origen || 'proveedor')  // 'proveedor' | 'operador'
    const operadorIdAliasBody = Number(body.operador_id_alias || 0)   // ID en operadores si el proveedor tiene alias
    const montoTotal       = Number(body.monto_total)
    const servicios        = Array.isArray(body.servicios) ? body.servicios : []
    const notas            = String(body.notas || '').trim()

    if (!['cliente','proveedor'].includes(tipo)) return c.json({ error: 'Tipo inválido' }, 400)
    if (!tcId || !entidadId || montoTotal <= 0) return c.json({ error: 'Datos incompletos' }, 400)

    // Verificar tarjeta
    const tcTabla = tipo === 'cliente' ? 'cliente_tarjetas' : 'proveedor_tarjetas'
    const tc = await c.env.DB.prepare(`SELECT * FROM ${tcTabla} WHERE id = ?`).bind(tcId).first() as any
    if (!tc) return c.json({ error: 'Tarjeta no encontrada' }, 404)
    if (!['pendiente','autorizada'].includes(tc.estado)) return c.json({ error: 'No se puede asignar una tarjeta rechazada' }, 400)

    // Verificar que no haya asignaciones previas (tarjeta limpia)
    const campoTc = tipo === 'cliente' ? 'cliente_tarjeta_id' : 'proveedor_tarjeta_id'
    const yaAsig  = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(monto),0) as total FROM tarjeta_asignaciones WHERE ${campoTc} = ?`
    ).bind(tcId).first() as any
    const yaTotal = Number(yaAsig?.total || 0)
    if (yaTotal + 0.001 >= montoTotal) return c.json({ error: 'La tarjeta ya tiene asignaciones que cubren su total' }, 400)

    // Verificar que la entidad existe (puede ser proveedor u operador)
    let provId: number | null = null      // ID en tabla proveedores (para FK y CC)
    let operadorId: number | null = null  // ID en tabla operadores
    let entidadNombre = ''

    if (tablaOrigen === 'operador') {
      const op = await c.env.DB.prepare(`SELECT * FROM operadores WHERE id = ?`).bind(entidadId).first() as any
      if (!op) return c.json({ error: 'Operador no encontrado' }, 404)
      operadorId    = entidadId
      entidadNombre = op.nombre
      // Si existe un proveedor con el mismo nombre, usar su ID como proveedor_id
      const provMatch = await c.env.DB.prepare(
        `SELECT id FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1`
      ).bind(op.nombre).first() as any
      provId = provMatch?.id || null
    } else {
      const prov = await c.env.DB.prepare(`SELECT * FROM proveedores WHERE id = ?`).bind(entidadId).first() as any
      if (!prov) return c.json({ error: 'Proveedor no encontrado' }, 404)
      provId        = entidadId
      entidadNombre = prov.nombre
      // Si el frontend envió operador_id_alias → usarlo para búsqueda de servicios
      if (operadorIdAliasBody) operadorId = operadorIdAliasBody
      else {
        // Intentar encontrar operador con mismo nombre (fallback)
        const opMatch = await c.env.DB.prepare(
          `SELECT id FROM operadores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1`
        ).bind(prov.nombre).first() as any
        if (opMatch) operadorId = opMatch.id
      }
    }

    // tarjeta_asignaciones.proveedor_id es NOT NULL → si no hay proveedor equivalente, error
    if (!provId) {
      return c.json({ error: `"${entidadNombre}" solo existe como operador. Para asignar tarjetas, primero agregalo como Proveedor en el menú Proveedores.` }, 400)
    }

    // Validar montos de servicios
    const totalSvc = servicios.reduce((s: number, a: any) => s + Number(a.monto || 0), 0)
    if (totalSvc > montoTotal + 0.001) return c.json({ error: 'Los servicios superan el monto de la tarjeta' }, 400)

    const moneda   = tc.moneda || 'USD'
    const cliTcId  = tipo === 'cliente'   ? tcId : null
    const provTcId = tipo === 'proveedor' ? tcId : null
    const asigIds: number[] = []

    // Insertar una asignación por servicio → estado tc_enviada
    for (const svcItem of servicios) {
      const svcId  = Number(svcItem.servicio_id)
      const fileId = Number(svcItem.file_id)
      const monto  = Number(svcItem.monto)
      if (!svcId || monto <= 0) continue

      // Verificar que el servicio pertenece a la entidad:
      // - por proveedor_id directo
      // - por operador_id directo (incluye el alias cuando proveedor == operador mismo nombre)
      // - por nombre cruzado como último fallback
      const svc = await c.env.DB.prepare(`
        SELECT s.* FROM servicios s
        WHERE s.id = ?
          AND (
            s.proveedor_id = ?
            OR (? IS NOT NULL AND s.operador_id = ?)
            OR s.operador_id IN (SELECT id FROM operadores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)))
            OR s.proveedor_id IN (SELECT id FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)))
          )
      `).bind(svcId, provId, operadorId, operadorId ?? -1, entidadNombre, entidadNombre).first() as any
      if (!svc) continue

      const ins = await c.env.DB.prepare(`
        INSERT INTO tarjeta_asignaciones
          (cliente_tarjeta_id, proveedor_tarjeta_id, proveedor_id, servicio_id, file_id, monto, moneda, estado, notas, creado_por_usuario)
        VALUES (?,?,?,?,?,?,?,'tc_enviada',?,?)
      `).bind(cliTcId, provTcId, provId, svcId, svc.file_id || fileId, monto, moneda, notas||null, user.id).run()
      asigIds.push(Number(ins.meta?.last_row_id))

      // Marcar servicio como TC Enviada
      await c.env.DB.prepare(
        `UPDATE servicios SET estado_pago_proveedor='tc_enviada', monto_tc_asignado=COALESCE(monto_tc_asignado,0)+? WHERE id=?`
).bind(monto, svcId).run()

      // Registrar en cuenta corriente del proveedor como débito pendiente
      await c.env.DB.prepare(`
        INSERT INTO proveedor_cuenta_corriente
          (proveedor_id, tipo, metodo, monto, moneda, concepto, referencia, estado, usuario_id, servicios_ids, fecha)
        VALUES (?, 'debito', 'tarjeta_credito', ?, ?, ?, ?, 'pendiente', ?, ?, date('now'))
      `).bind(
        provId, monto, moneda,
        `TC **** ${tc.ultimos_4 || '????'} asignada a servicio ${svc.tipo_servicio} (File #${svc.file_id || fileId})`,
        `tarjeta_asignacion_${ins.meta?.last_row_id}`,
        user.id,
        String(svcId)
      ).run().catch(() => {})
    }

    // Si sobra saldo → asignación saldo a favor (sin servicio)
    const saldoFavor = montoTotal - totalSvc
    if (saldoFavor > 0.001) {
      const ins = await c.env.DB.prepare(`
        INSERT INTO tarjeta_asignaciones
          (cliente_tarjeta_id, proveedor_tarjeta_id, proveedor_id, servicio_id, file_id, monto, moneda, estado, notas, creado_por_usuario)
        VALUES (?,?,?,NULL,NULL,?,?,'tc_enviada',?,?)
      `).bind(cliTcId, provTcId, provId, saldoFavor, moneda, notas ? notas+' [saldo a favor]' : 'Saldo a favor proveedor', user.id).run()
      asigIds.push(Number(ins.meta?.last_row_id))

// Registrar saldo a favor en cuenta corriente del proveedor
      await c.env.DB.prepare(`
        INSERT INTO proveedor_cuenta_corriente
          (proveedor_id, tipo, metodo, monto, moneda, concepto, referencia, estado, usuario_id, fecha)
        VALUES (?, 'debito', 'tarjeta_credito', ?, ?, ?, ?, 'pendiente', ?, date('now'))
      `).bind(
        provId, saldoFavor, moneda,
        `Saldo a favor TC **** ${tc.ultimos_4 || '????'} (pendiente autorización)`,
        `tarjeta_asignacion_saldo_${asigIds[asigIds.length-1]}`,
        user.id
      ).run().catch(() => {})
      }
    }

    return c.json({ ok: true, asignaciones: asigIds, saldo_favor: Math.max(0, saldoFavor) })
  } catch (e: any) {
    return c.json({ error: e.message || 'Error interno' }, 500)
  }
})

// ── API: revertir autorización/rechazo → pendiente ──
tesoreria.post('/api/tarjetas/revertir', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'Sin permiso' }, 403)

  await ensureTarjetaAsignaciones(c.env.DB)

  try {
    const body  = await c.req.json() as any
    const tipo  = String(body.tipo || '')   // 'cliente' | 'proveedor'
    const tcId  = Number(body.tc_id)
    if (!['cliente','proveedor'].includes(tipo) || !tcId) return c.json({ error: 'Datos inválidos' }, 400)

    const tabla  = tipo === 'cliente' ? 'cliente_tarjetas' : 'proveedor_tarjetas'
    const campo  = tipo === 'cliente' ? 'cliente_tarjeta_id' : 'proveedor_tarjeta_id'

    // Verificar tarjeta existe
    const tc = await c.env.DB.prepare(`SELECT * FROM ${tabla} WHERE id = ?`).bind(tcId).first() as any
    if (!tc) return c.json({ error: 'Tarjeta no encontrada' }, 404)
    if (tc.estado === 'pendiente') return c.json({ error: 'La tarjeta ya está en estado pendiente' }, 400)

    // Verificar que no tenga asignaciones activas (solo aplica si estaba autorizada)
    if (tc.estado === 'autorizada') {
      const asig = await c.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM tarjeta_asignaciones WHERE ${campo} = ?`
      ).bind(tcId).first() as any
      if (Number(asig?.cnt || 0) > 0) {
        return c.json({ error: 'La tarjeta tiene asignaciones activas. Eliminá las asignaciones antes de revertir.' }, 400)
      }
    }

    // Revertir a pendiente
    await c.env.DB.prepare(
      `UPDATE ${tabla} SET estado='pendiente', fecha_autorizacion=NULL, autorizado_por_usuario=NULL WHERE id=?`
    ).bind(tcId).run()

    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: e.message || 'Error interno' }, 500)
  }
})

// ── API: eliminar asignación ──
tesoreria.delete('/api/tarjetas/asignaciones/:id', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'Sin permiso' }, 403)
  const asigId = Number(c.req.param('id'))
  await ensureTarjetaAsignaciones(c.env.DB)
  try {
    // Revertir estado_pago_proveedor del servicio si corresponde
    const asig = await c.env.DB.prepare(`SELECT * FROM tarjeta_asignaciones WHERE id=?`).bind(asigId).first() as any
    if (asig?.servicio_id && asig.estado === 'tc_enviada') {
      await c.env.DB.prepare(
        `UPDATE servicios SET estado_pago_proveedor='pendiente', monto_tc_asignado=MAX(0,COALESCE(monto_tc_asignado,0)-?) WHERE id=?`
      ).bind(asig.monto, asig.servicio_id).run().catch(() => {})
    }
    await c.env.DB.prepare(`DELETE FROM tarjeta_asignaciones WHERE id = ?`).bind(asigId).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── API: alertas TC negada para el usuario logueado ──
tesoreria.get('/api/alertas-tc', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ alertas: [], total: 0 })
  try {
    // Vendedores ven sus propias alertas; admins/gerentes ven todas
    const whereUser = isAdminOrAbove(user.rol) ? '' : 'AND atc.vendedor_usuario_id = ?'
    const bindUser  = isAdminOrAbove(user.rol) ? [] : [user.id]
    const rows = await c.env.DB.prepare(`
      SELECT atc.*, f.numero as file_numero, p.nombre as proveedor_nombre
      FROM alertas_tc atc
      LEFT JOIN files f ON f.id = atc.file_id
      LEFT JOIN proveedores p ON p.id = atc.proveedor_id
      WHERE atc.estado = 'pendiente' ${whereUser}
      ORDER BY atc.creado_at DESC LIMIT 50
    `).bind(...bindUser).all()
    return c.json({ alertas: rows.results, total: rows.results.length })
  } catch (e: any) {
    return c.json({ alertas: [], total: 0 })
  }
})

// ── API: marcar alerta TC como vista ──
tesoreria.post('/api/alertas-tc/:id/vista', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Sin permiso' }, 403)
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(`UPDATE alertas_tc SET estado='vista', vista_at=datetime('now') WHERE id=?`).bind(id).run().catch(() => {})
  return c.json({ ok: true })
})

// ── REPORTE EXCEL: TCs autorizadas ──
tesoreria.get('/tesoreria/tarjetas/reporte-excel', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/login')

  const fechaDesde = c.req.query('desde') || ''
  const fechaHasta = c.req.query('hasta') || ''
  const filtProvId = c.req.query('proveedor_id') || ''
  const filtFileNum = c.req.query('file_numero') || ''

  try {
    let where = `WHERE (ct.estado='autorizada' OR pt.estado='autorizada')`
    const params: any[] = []

    if (fechaDesde) { where += ` AND COALESCE(ct.fecha_autorizacion,pt.fecha_autorizacion) >= ?`; params.push(fechaDesde) }
    if (fechaHasta) { where += ` AND COALESCE(ct.fecha_autorizacion,pt.fecha_autorizacion) <= ?`; params.push(fechaHasta + ' 23:59:59') }
    if (filtProvId) { where += ` AND ta.proveedor_id = ?`; params.push(filtProvId) }
    if (filtFileNum) { where += ` AND f.numero = ?`; params.push(filtFileNum) }

    const rows = await c.env.DB.prepare(`
      SELECT
        COALESCE(ct.fecha_autorizacion, pt.fecha_autorizacion) as fecha_autorizacion,
        f.numero as file_numero,
        COALESCE('****'||ct.ultimos_4, '****'||pt.ultimos_4) as ultimos_4,
        COALESCE(ct.monto, pt.monto) as monto_tarjeta,
        ta.monto as monto_asignado,
        ta.moneda,
        prov.nombre as proveedor_nombre,
        s.tipo_servicio, s.descripcion as servicio_desc, s.nro_ticket,
        COALESCE(au.nombre, aut.nombre) as autorizado_por,
        ta.estado as estado_asignacion,
        ta.created_at as fecha_asignacion
      FROM tarjeta_asignaciones ta
      LEFT JOIN cliente_tarjetas ct   ON ct.id = ta.cliente_tarjeta_id
      LEFT JOIN proveedor_tarjetas pt ON pt.id = ta.proveedor_tarjeta_id
      JOIN proveedores prov ON prov.id = ta.proveedor_id
      LEFT JOIN servicios s ON s.id = ta.servicio_id
      LEFT JOIN files f     ON f.id = ta.file_id
      LEFT JOIN usuarios au  ON au.id  = ct.autorizado_por_usuario
      LEFT JOIN usuarios aut ON aut.id = pt.autorizado_por_usuario
      ${where}
      ORDER BY fecha_autorizacion DESC
      LIMIT 1000
    `).bind(...params).all()

    const data = rows.results as any[]

    // Generar CSV (compatible Excel)
    const sep = ','
    const headers = ['Fecha Autorización','File #','Últimos 4','Monto Tarjeta','Monto Asignado','Moneda','Proveedor','Tipo Servicio','Descripción Servicio','Nº Ticket','Autorizado Por','Estado','Fecha Asignación']
    const csvRows = [headers.join(sep)]
    for (const r of data) {
      csvRows.push([
        (r.fecha_autorizacion||'').substring(0,10),
        r.file_numero||'',
        r.ultimos_4||'',
        Number(r.monto_tarjeta||0).toFixed(2),
        Number(r.monto_asignado||0).toFixed(2),
        r.moneda||'USD',
        r.proveedor_nombre||'',
        r.tipo_servicio||'Saldo a favor',
        r.servicio_desc||'',
        r.nro_ticket||'',
        r.autorizado_por||'',
        r.estado_asignacion||'',
        (r.fecha_asignacion||'').substring(0,10)
      ].map(v => '"'+String(v).replace(/"/g,'""')+'"').join(sep))
    }
    const csv = '\uFEFF' + csvRows.join('\r\n')  // BOM para Excel

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tc_autorizadas_${new Date().toISOString().substring(0,10)}.csv"`
      }
    })
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── PÁGINA: Reporte TC autorizadas (formulario de filtros) ──
tesoreria.get('/tesoreria/tarjetas/reporte', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/login')

  const proveedores = await c.env.DB.prepare(`SELECT id, nombre FROM proveedores WHERE activo=1 ORDER BY nombre`).all().catch(() => ({ results: [] }))

  const content = `
    <div style="max-width:700px;margin:0 auto;">
      <h2 style="margin:0 0 20px;color:#1a1a2e;font-size:20px;font-weight:800;">
        <i class="fas fa-file-excel" style="color:#059669;margin-right:8px;"></i>Reporte de TCs Autorizadas
      </h2>
      <div style="background:white;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
        <form method="GET" action="/tesoreria/tarjetas/reporte-excel">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Fecha desde</label>
              <input type="date" name="desde" class="form-control" style="width:100%;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Fecha hasta</label>
              <input type="date" name="hasta" class="form-control" style="width:100%;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Proveedor</label>
              <select name="proveedor_id" class="form-control" style="width:100%;">
                <option value="">— Todos —</option>
                ${(proveedores.results as any[]).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Nº de File</label>
              <input type="text" name="file_numero" class="form-control" placeholder="Ej: 2026001" style="width:100%;">
            </div>
          </div>
          <button type="submit" style="padding:10px 24px;background:#059669;color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
            <i class="fas fa-download"></i> Descargar Excel (CSV)
          </button>
        </form>
      </div>
    </div>
  `
  return c.html(baseLayout('Reporte TCs', content, user, 'tesoreria'))
})

export default tesoreria
Fix: corregir asignación tarjetas - cuenta corriente proveedor
