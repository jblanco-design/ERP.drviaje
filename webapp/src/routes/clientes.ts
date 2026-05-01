import { Hono } from 'hono'
import { getUser, isSupervisorOrAbove } from '../lib/auth'

// ── Normalizar documento: siempre sin puntos, guiones ni espacios ─
function normalizarCI(raw: string): string {
  // Solo dígitos, sin puntos ni guiones
  return raw.replace(/[^0-9]/g, '')
}

function normalizarDocumento(tipo: string, nro: string): string {
  if (!nro) return ''
  if (tipo === 'CI') return normalizarCI(nro)
  // Otros tipos → mayúsculas, sin espacios ni puntos ni guiones
  return nro.trim().toUpperCase().replace(/[\.\-\s]/g, '')
}
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }
const clientes = new Hono<{ Bindings: Bindings }>()

// Helper: nombre completo desde campos separados
function nombreCompleto(cl: any): string {
  if (cl?.tipo_cliente === 'empresa') {
    return cl?.nombre || cl?.nombre_completo || '—'
  }
  const n = cl?.nombre || ''
  const a = cl?.apellido || ''
  if (n && a) return `${n} ${a}`
  return n || a || cl?.nombre_completo || '—'
}

function esEmpresa(cl: any): boolean {
  return cl?.tipo_cliente === 'empresa'
}

// ── Lista ─────────────────────────────────────────────────────
clientes.get('/clientes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const buscar      = c.req.query('buscar') || ''
  const tipoFiltro  = c.req.query('tipo')      || ''
  const conDeuda    = c.req.query('con_deuda') || ''
  const isVendedor  = user.rol === 'vendedor'

  // Vendedor solo ve sus clientes — filtro forzado por su id
  // Gerente/admin pueden ver todos o filtrar por vendedor
  const filtroVendedorId = isVendedor
    ? user.id
    : (c.req.query('vendedor_id') ? Number(c.req.query('vendedor_id')) : null)

  try {
    let q = `SELECT c.*,
      COALESCE((SELECT SUM(f.total_venta) FROM files f WHERE f.cliente_id = c.id AND f.estado != 'anulado'),0) as total_venta,
      COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m JOIN files f ON f.id = m.file_id WHERE f.cliente_id = c.id AND m.tipo='ingreso' AND m.anulado=0),0) as total_cobrado,
      u.nombre as vendedor_nombre
      FROM clientes c
      LEFT JOIN usuarios u ON u.id = c.vendedor_id
      WHERE 1=1`
    const params: any[] = []
    if (buscar) {
      q += ` AND (c.nombre LIKE ? OR c.apellido LIKE ? OR c.email LIKE ?
              OR c.nro_documento LIKE ? OR c.telefono LIKE ?
              OR c.razon_social LIKE ? OR c.persona_contacto LIKE ?
              OR (c.nombre || ' ' || c.apellido) LIKE ?)`
      const like = `%${buscar}%`
      params.push(like, like, like, like, like, like, like, like)
    }
    if (tipoFiltro) { q += ` AND c.tipo_cliente = ?`; params.push(tipoFiltro) }
    // Filtro por vendedor — obligatorio para vendedor, opcional para admin/gerente
    if (filtroVendedorId) { q += ` AND c.vendedor_id = ?`; params.push(filtroVendedorId) }
    if (conDeuda)   { q += ` HAVING (total_venta - total_cobrado) > 0.01` }
    q += ' ORDER BY c.apellido, c.nombre LIMIT 100'
    const result = await c.env.DB.prepare(q).bind(...params).all()

    const hoy     = new Date().toISOString().split('T')[0]
    const en30d   = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

    const rows = result.results.map((cl: any) => {
      const nc = nombreCompleto(cl)
      const empresa = esEmpresa(cl)
      const pasaVencido = cl.vencimiento_pasaporte && cl.vencimiento_pasaporte < hoy
      const pasaProximo = cl.vencimiento_pasaporte && cl.vencimiento_pasaporte >= hoy && cl.vencimiento_pasaporte <= en30d
      return `
        <tr>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:28px;height:28px;border-radius:50%;background:${empresa ? 'linear-gradient(135deg,#0369a1,#0ea5e9)' : 'linear-gradient(135deg,#7B3FA0,#EC008C)'};display:flex;align-items:center;justify-content:center;font-size:11px;color:white;flex-shrink:0;">
                <i class="fas fa-${empresa ? 'building' : 'user'}" style="font-size:10px;"></i>
              </div>
              <div>
                <strong>${esc(nc)}</strong>
                ${empresa
                  ? `<br><span style="font-size:11px;color:#0369a1;"><i class="fas fa-briefcase" style="font-size:9px;"></i> ${esc(cl.razon_social || '')} ${cl.persona_contacto ? '· ' + esc(cl.persona_contacto) : ''}</span>`
                  : (cl.apellido ? `<br><span style="font-size:11px;color:#9ca3af;">${esc(cl.nombre)} ${esc(cl.apellido)}</span>` : '')}
              </div>
            </div>
          </td>
          <td style="font-size:12px;">${esc(cl.email) || '—'}</td>
          <td style="font-size:12px;">${esc(cl.telefono) || '—'}</td>
          <td style="font-size:12px;">
            <span style="background:${empresa ? '#dbeafe' : '#f3e8ff'};color:${empresa ? '#1e40af' : '#7B3FA0'};padding:1px 6px;border-radius:8px;font-size:11px;font-weight:600;">${esc(cl.tipo_documento || (empresa ? 'RUT' : 'CI'))}</span>
            ${esc(cl.nro_documento) || '—'}
          </td>
          <td>
            ${empresa ? '<span style="color:#9ca3af;font-size:11px;">—</span>' : (cl.vencimiento_pasaporte
              ? `<span style="font-size:11px;font-weight:700;color:${pasaVencido?'#dc2626':pasaProximo?'#d97706':'#059669'};">
                  ${pasaVencido?'⚠ ':pasaProximo?'⏰ ':'✓ '}${esc(cl.vencimiento_pasaporte)}
                </span>`
              : '<span style="color:#9ca3af;font-size:11px;">—</span>')}
          </td>
          <td>${(() => {
            const deuda = Number(cl.total_venta||0) - Number(cl.total_cobrado||0)
            if (deuda <= 0.01) return '<span style="font-size:11px;color:#059669;font-weight:700;">✓</span>'
            return '<strong style="color:#dc2626;font-size:12px;">-$' + deuda.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</strong>'
          })()}</td>
          <td style="font-size:12px;color:#6b7280;">${esc(cl.vendedor_nombre || '—')}</td>
          <td>
            <a href="/clientes/${cl.id}" class="btn btn-outline btn-sm" title="Ver cliente"><i class="fas fa-eye"></i></a>
            <a href="/clientes/${cl.id}/editar" class="btn btn-sm" style="background:#f3e8ff;color:#7B3FA0;" title="Editar"><i class="fas fa-edit"></i></a>
            <a href="/clientes/${cl.id}/cuenta-corriente" class="btn btn-sm" style="background:#217346;color:white;" title="Estado de Cuenta"><i class="fas fa-file-invoice-dollar"></i></a>
          </td>
        </tr>
      `
    }).join('')

    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <form method="GET" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="text" name="buscar" value="${esc(buscar)}" placeholder="Buscar cliente..." class="form-control" style="width:220px;">
          <select name="tipo" class="form-control" style="width:160px;">
            <option value="" ${!tipoFiltro?'selected':''}>Todos los tipos</option>
            <option value="persona_fisica" ${tipoFiltro==='persona_fisica'?'selected':''}>👤 Persona física</option>
            <option value="empresa" ${tipoFiltro==='empresa'?'selected':''}>🏢 Empresa</option>
          </select>
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#dc2626;cursor:pointer;white-space:nowrap;">
            <input type="checkbox" name="con_deuda" value="1" ${conDeuda?'checked':''} style="accent-color:#dc2626;"> Con deuda
          </label>
          <button type="submit" class="btn btn-primary"><i class="fas fa-search"></i></button>
          ${buscar||tipoFiltro||conDeuda ? `<a href="/clientes" class="btn btn-outline"><i class="fas fa-times"></i></a>` : ''}
        </form>
        <a href="/clientes/nuevo" class="btn btn-orange"><i class="fas fa-plus"></i> Nuevo Cliente</a>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-users" style="color:#EC008C"></i> Clientes (${result.results.length})</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Nombre completo</th><th>Email</th><th>Teléfono</th><th>Documento</th><th>Pasaporte</th><th>Deuda</th><th>Vendedor</th><th>Acciones</th></tr></thead>
            <tbody>
              ${rows || `<tr><td colspan="6" style="text-align:center;padding:30px;color:#9ca3af;">Sin clientes. <a href="/clientes/nuevo" style="color:#7B3FA0;">Crear primero</a></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `
    return c.html(baseLayout('Clientes', content, user, 'clientes'))
  } catch (e: any) {
    return c.html(baseLayout('Clientes', `<div class="alert alert-danger">${esc(e.message)}</div>`, user, 'clientes'))
  }
})

// ── Nuevo ─────────────────────────────────────────────────────
clientes.get('/clientes/nuevo', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  return c.html(baseLayout('Nuevo Cliente', clienteForm(null), user, 'clientes'))
})

clientes.post('/clientes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const b = await c.req.parseBody()
  try {
    const tipoCliente = String(b.tipo_cliente || 'persona_fisica') === 'empresa' ? 'empresa' : 'persona_fisica'
    const esEmp = tipoCliente === 'empresa'

    const nombre   = String(b.nombre || '').trim()
    const apellido = esEmp ? '' : String(b.apellido || '').trim()
    if (!nombre) return c.redirect('/clientes/nuevo?error=nombre_requerido')
    if (!esEmp && !apellido) return c.redirect('/clientes/nuevo?error=nombre_requerido')

    const razonSocial      = esEmp ? String(b.razon_social || '').trim() : null
    const personaContacto  = esEmp ? String(b.persona_contacto || '').trim() : null
    if (esEmp && !personaContacto) return c.redirect('/clientes/nuevo?error=contacto_requerido')

    const TIPOS_DOC = ['CI', 'DNI', 'PAS', 'RUT', 'NIF', 'OTRO']
    const tipoDocDefault = esEmp ? 'RUT' : 'CI'
    const tipoDoc = TIPOS_DOC.includes(String(b.tipo_documento)) ? String(b.tipo_documento) : tipoDocDefault

    const nroDocumento = normalizarDocumento(tipoDoc, String(b.nro_documento || '').trim())
    const telefono     = String(b.telefono || '').trim()
    if (!nroDocumento) return c.redirect('/clientes/nuevo?error=documento_requerido')

    // Verificar documento duplicado (normalizando CI antes de comparar)
    const nroDocRaw = String(b.nro_documento || '').trim()
    const nroDocC   = normalizarDocumento(tipoDoc, nroDocRaw)
    if (nroDocC) {
      const existe = await c.env.DB.prepare(
        `SELECT id, nombre, apellido, nombre_completo FROM clientes WHERE nro_documento = ? LIMIT 1`
      ).bind(nroDocC).first() as any
      if (existe) {
        const nombreExistente = existe.nombre_completo || `${existe.nombre} ${existe.apellido}`.trim()
        return c.redirect(`/clientes/nuevo?error=documento_duplicado&doc=${encodeURIComponent(nroDocC)}&cliente=${encodeURIComponent(nombreExistente)}`)
      }
    }

    const hoyClNuevo = new Date().toISOString().split('T')[0]
    if (!esEmp && b.fecha_nacimiento && String(b.fecha_nacimiento) > hoyClNuevo) {
      return c.redirect('/clientes/nuevo?error=fecha_nacimiento_invalida')
    }

    const nc = esEmp ? nombre : `${nombre} ${apellido}`.trim()
    const insertResult = await c.env.DB.prepare(`
      INSERT INTO clientes (nombre, apellido, nombre_completo, email, telefono, direccion,
        tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte,
        preferencias_comida, millas_aerolineas, notas,
        tipo_cliente, razon_social, persona_contacto)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      nombre.substring(0, 100), apellido.substring(0, 100), nc.substring(0, 200),
      b.email ? String(b.email).trim().substring(0, 200) : null,
      telefono.substring(0, 50),
      b.direccion ? String(b.direccion).trim().substring(0, 300) : null,
      tipoDoc, nroDocumento.substring(0, 50),
      (!esEmp && b.fecha_nacimiento) ? b.fecha_nacimiento : null,
      (!esEmp && b.vencimiento_pasaporte) ? b.vencimiento_pasaporte : null,
      b.preferencias_comida ? String(b.preferencias_comida).trim().substring(0, 200) : null,
      b.millas_aerolineas ? String(b.millas_aerolineas).trim().substring(0, 100) : null,
      b.notas ? String(b.notas).trim().substring(0, 1000) : null,
      tipoCliente,
      razonSocial ? razonSocial.substring(0, 200) : null,
      personaContacto ? personaContacto.substring(0, 200) : null
    ).run()

    const nuevoId = insertResult.meta?.last_row_id
    return c.redirect(`/clientes/${nuevoId}?ok=creado`)
  } catch (e: any) {
    return c.redirect('/clientes/nuevo?error=1')
  }
})

// ── Ver ───────────────────────────────────────────────────────
clientes.get('/clientes/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const okParam  = c.req.query('ok')    || ''
  const errParam = c.req.query('error') || ''
  try {
    const cl = await c.env.DB.prepare(`
      SELECT c.*, u.nombre as vendedor_nombre
      FROM clientes c LEFT JOIN usuarios u ON u.id = c.vendedor_id
      WHERE c.id = ?
    `).bind(id).first() as any
    if (!cl) return c.redirect('/clientes')

    const fechaDesdeC = c.req.query('fecha_desde') || ''
    const fechaHastaC = c.req.query('fecha_hasta') || ''
    const conSaldoC   = c.req.query('con_saldo')   || ''

    let filesQuery = `
      SELECT f.*, u.nombre as vendedor_nombre,
        COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m WHERE m.file_id = f.id AND m.tipo='ingreso' AND m.anulado=0),0) as cobrado
      FROM files f
      JOIN usuarios u ON f.vendedor_id = u.id
      WHERE f.cliente_id = ?`
    const filesParams: any[] = [id]
    if (fechaDesdeC) { filesQuery += ' AND f.fecha_viaje >= ?'; filesParams.push(fechaDesdeC) }
    if (fechaHastaC) { filesQuery += ' AND f.fecha_viaje <= ?'; filesParams.push(fechaHastaC) }
    if (conSaldoC)   { filesQuery += ` AND (f.total_venta - COALESCE((SELECT SUM(m2.monto) FROM movimientos_caja m2 WHERE m2.file_id = f.id AND m2.tipo='ingreso' AND m2.anulado=0),0)) > 0.01 AND f.estado != 'anulado'` }
    filesQuery += ' ORDER BY f.fecha_viaje DESC, f.created_at DESC'
    const filesCl = await c.env.DB.prepare(filesQuery).bind(...filesParams).all()

    const hoy = new Date().toISOString().split('T')[0]
    const pasaVencido = cl.vencimiento_pasaporte && cl.vencimiento_pasaporte < hoy
    const nc = nombreCompleto(cl)

    const content = `
      <div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <a href="/clientes" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver</a>
        <script>
          (function(){
            const p = new URLSearchParams(window.location.search)
            const ok  = p.get('ok')
            const err = p.get('error')
            const pid = p.get('pasajero_id')
            const container = document.currentScript.parentNode
            let div
            if (ok === 'creado') {
              div = document.createElement('div')
              div.className = 'alert alert-success'
              div.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;'
              div.innerHTML = '<i class="fas fa-check-circle" style="font-size:18px;color:#059669;"></i><div><strong>Cliente creado correctamente.</strong></div>'
            } else if (ok === 'pasajero_creado') {
              div = document.createElement('div')
              div.className = 'alert alert-success'
              div.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;'
              div.innerHTML = '<i class="fas fa-check-circle" style="font-size:18px;"></i><div><strong>Pasajero creado correctamente</strong> con los datos del cliente. Ya podés asignarlo a servicios.</div>'
            } else if (err === 'ya_es_pasajero') {
              div = document.createElement('div')
              div.className = 'alert alert-warning'
              div.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;'
              div.innerHTML = '<i class="fas fa-info-circle" style="font-size:18px;"></i><div><strong>Este cliente ya tiene un pasajero vinculado.</strong>' + (pid ? ' <a href="/pasajeros/'+pid+'" style="color:#92400e;">Ver pasajero</a>' : '') + '</div>'
            } else if (err === 'empresa_no_pasajero') {
              div = document.createElement('div')
              div.className = 'alert alert-danger'
              div.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0;'
              div.innerHTML = '<i class="fas fa-ban" style="font-size:18px;"></i><div>Las empresas no pueden convertirse en pasajeros.</div>'
            }
            if (div) container.insertAdjacentElement('afterend', div)
          })()
        </script>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:12px;color:#6b7280;background:#f3e8ff;padding:4px 10px;border-radius:8px;">
            <i class="fas fa-user-tie" style="color:#7B3FA0;"></i> <strong>${esc(cl.vendedor_nombre || '—')}</strong>
          </span>
          <a href="/clientes/${id}/cuenta-corriente" class="btn btn-sm" style="background:#217346;color:white;border:none;">
            <i class="fas fa-file-invoice-dollar"></i> Estado de Cuenta
          </a>
          ${!esEmpresa(cl) ? `
          <form method="POST" action="/clientes/${id}/agregar-pasajero" style="display:inline;"
            onsubmit="return confirm('¿Crear pasajero con los datos de ${esc(nc)}?')">
            <button type="submit" class="btn btn-sm" style="background:#F7941D;color:white;border:none;">
              <i class="fas fa-user-plus"></i> Agregar como pasajero
            </button>
          </form>` : ''}
          <a href="/clientes/${id}/editar" class="btn btn-outline"><i class="fas fa-edit"></i> Editar</a>
        </div>
      </div>
      <div class="grid-2" style="margin-bottom:20px;">
        <div class="card">
          <div class="card-body">
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
              <div style="width:52px;height:52px;border-radius:50%;background:${esEmpresa(cl) ? 'linear-gradient(135deg,#0369a1,#0ea5e9)' : 'linear-gradient(135deg,#7B3FA0,#EC008C)'};display:flex;align-items:center;justify-content:center;color:white;font-size:22px;font-weight:800;">
                <i class="fas fa-${esEmpresa(cl) ? 'building' : 'user'}" style="font-size:20px;"></i>
              </div>
              <div>
                <div style="font-size:18px;font-weight:800;color:#1a1a2e;">${esc(nc)}</div>
                <div style="font-size:13px;color:#6b7280;">${esc(cl.email) || 'Sin email'}</div>
              </div>
            </div>
            <div style="display:grid;gap:8px;font-size:13px;">
              ${esEmpresa(cl) ? `
                <div>
                  <i class="fas fa-building" style="color:#0369a1;width:16px;"></i>
                  <strong>Nombre comercial:</strong> ${esc(cl.nombre) || '—'}
                </div>
                ${cl.razon_social ? `<div><i class="fas fa-file-signature" style="color:#0369a1;width:16px;"></i> <strong>Razón social:</strong> ${esc(cl.razon_social)}</div>` : ''}
                <div>
                  <i class="fas fa-user-tie" style="color:#0369a1;width:16px;"></i>
                  <strong>Contacto:</strong> ${esc(cl.persona_contacto) || '—'}
                </div>
              ` : `
                <div>
                  <i class="fas fa-user" style="color:#7B3FA0;width:16px;"></i>
                  <strong>Nombre:</strong> ${esc(cl.nombre) || '—'} &nbsp;
                  <strong>Apellido:</strong> ${esc(cl.apellido) || '—'}
                </div>
                <div><i class="fas fa-birthday-cake" style="color:#7B3FA0;width:16px;"></i> ${esc(cl.fecha_nacimiento) || '—'}</div>
                <div>
                  <i class="fas fa-passport" style="color:${pasaVencido ? '#dc2626' : '#7B3FA0'};width:16px;"></i>
                  Pasaporte vence: <strong style="color:${pasaVencido ? '#dc2626' : 'inherit'}">
                    ${esc(cl.vencimiento_pasaporte) || '—'}${pasaVencido ? ' ⚠ VENCIDO' : ''}
                  </strong>
                </div>
                ${cl.preferencias_comida ? `<div><i class="fas fa-utensils" style="color:#7B3FA0;width:16px;"></i> ${esc(cl.preferencias_comida)}</div>` : ''}
                ${cl.millas_aerolineas   ? `<div><i class="fas fa-plane"    style="color:#7B3FA0;width:16px;"></i> Millas: ${esc(cl.millas_aerolineas)}</div>` : ''}
              `}
              <div><i class="fas fa-phone" style="color:#7B3FA0;width:16px;"></i> ${esc(cl.telefono) || '—'}</div>
              <div><i class="fas fa-map-marker-alt" style="color:#7B3FA0;width:16px;"></i> ${esc(cl.direccion) || '—'}</div>
              <div>
                <i class="fas fa-id-card" style="color:#7B3FA0;width:16px;"></i>
                ${esc(cl.tipo_documento)}: <strong>${esc(cl.nro_documento) || '—'}</strong>
              </div>
              ${cl.notas ? `<div style="margin-top:8px;padding:10px;background:#f8f3ff;border-radius:8px;color:#5a2d75;"><i class="fas fa-sticky-note"></i> ${esc(cl.notas)}</div>` : ''}
            </div>
          </div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#5a2d75;margin-bottom:12px;">
            <i class="fas fa-folder-open" style="color:#F7941D"></i> Files (${filesCl.results.length})
          </div>
          <!-- Filtros de files -->
          <form method="GET" style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
            <input type="date" name="fecha_desde" value="${fechaDesdeC}" class="form-control" style="font-size:11px;padding:4px 8px;width:130px;" title="Salida desde">
            <input type="date" name="fecha_hasta" value="${fechaHastaC}" class="form-control" style="font-size:11px;padding:4px 8px;width:130px;" title="Salida hasta">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:#dc2626;cursor:pointer;">
              <input type="checkbox" name="con_saldo" value="1" ${conSaldoC?'checked':''} style="accent-color:#dc2626;"> Con saldo
            </label>
            <button type="submit" class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 10px;"><i class="fas fa-filter"></i></button>
            ${fechaDesdeC||fechaHastaC||conSaldoC ? `<a href="/clientes/${id}" class="btn btn-outline btn-sm" style="font-size:11px;padding:4px 10px;"><i class="fas fa-times"></i></a>` : ''}
          </form>
          ${filesCl.results.map((f: any) => {
            const saldo = Number(f.total_venta||0) - Number(f.cobrado||0)
            const util  = Number(f.total_venta||0) - Number(f.total_costo||0)
            return `
            <div style="background:white;border:1px solid #ede5f5;border-radius:10px;padding:12px;margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                  <strong style="color:#7B3FA0;">#${esc(f.numero)}</strong>
                  <span style="font-size:12px;color:#6b7280;margin-left:6px;">${esc(f.destino_principal)||'—'}</span>
                  ${f.fecha_viaje ? `<span style="font-size:11px;color:#9ca3af;margin-left:6px;"><i class="fas fa-calendar"></i> ${esc(f.fecha_viaje)}</span>` : ''}
                  <br>
                  <span class="badge badge-${esc(f.estado)}" style="margin-top:4px;">${esc(f.estado)}</span>
                  <span style="font-size:11px;color:#7B3FA0;margin-left:6px;"><i class="fas fa-user"></i> ${esc(f.vendedor_nombre||'—')}</span>
                </div>
                <a href="/files/${f.id}" class="btn btn-outline btn-sm"><i class="fas fa-eye"></i></a>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-top:8px;font-size:11px;">
                <div style="text-align:center;"><div style="color:#6b7280;">Venta</div><div style="font-weight:700;color:#059669;">$${Number(f.total_venta||0).toLocaleString()}</div></div>
                <div style="text-align:center;"><div style="color:#6b7280;">Costo</div><div style="font-weight:700;color:#374151;">$${Number(f.total_costo||0).toLocaleString()}</div></div>
                <div style="text-align:center;"><div style="color:#6b7280;">Utilidad</div><div style="font-weight:700;color:#F7941D;">$${util.toLocaleString()}</div></div>
                <div style="text-align:center;"><div style="color:#6b7280;">Saldo</div><div style="font-weight:700;color:${saldo>0.01?'#dc2626':'#059669'};">${saldo>0.01?'-$'+saldo.toLocaleString('es-UY',{minimumFractionDigits:2}):'✓'}</div></div>
              </div>
            </div>
          `}).join('') || '<div style="color:#9ca3af;font-size:13px;">Sin files</div>'}
        </div>
      </div>
    `
    return c.html(baseLayout(nc, content, user, 'clientes'))
  } catch (e: any) {
    return c.redirect('/clientes')
  }
})

// ── Convertir cliente en pasajero ────────────────────────────
clientes.post('/clientes/:id/agregar-pasajero', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  try {
    const cl = await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(id).first() as any
    if (!cl) return c.redirect('/clientes')
    if (cl.tipo_cliente === 'empresa') return c.redirect(`/clientes/${id}?error=empresa_no_pasajero`)

    // Verificar si ya existe un pasajero vinculado a este cliente
    const yaExiste = await c.env.DB.prepare(
      'SELECT id FROM pasajeros WHERE cliente_id = ? LIMIT 1'
    ).bind(id).first() as any
    if (yaExiste) return c.redirect(`/clientes/${id}?error=ya_es_pasajero&pasajero_id=${yaExiste.id}`)

    const nc = cl.nombre_completo || `${cl.nombre} ${cl.apellido}`.trim()
    await c.env.DB.prepare(`
      INSERT INTO pasajeros (nombre_completo, nombre, apellido, tipo_documento, nro_documento,
        fecha_nacimiento, vencimiento_pasaporte, email, telefono,
        preferencias_comida, millas_aerolineas, notas, cliente_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).bind(
      nc, cl.nombre || '', cl.apellido || '',
      cl.tipo_documento || 'CI', cl.nro_documento || null,
      cl.fecha_nacimiento || null, cl.vencimiento_pasaporte || null,
      cl.email || null, cl.telefono || null,
      cl.preferencias_comida || null, cl.millas_aerolineas || null,
      cl.notas || null, Number(id)
    ).run()

    return c.redirect(`/clientes/${id}?ok=pasajero_creado`)
  } catch (e: any) {
    return c.redirect(`/clientes/${id}?error=1`)
  }
})

// ── Editar ────────────────────────────────────────────────────
clientes.get('/clientes/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const cl = await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(id).first() as any
  if (!cl) return c.redirect('/clientes')
  const usuariosList = isSupervisorOrAbove(user.rol)
    ? await c.env.DB.prepare(`SELECT id, nombre FROM usuarios WHERE activo=1 ORDER BY nombre`).all()
    : { results: [] as any[] }
  return c.html(baseLayout('Editar Cliente', clienteForm(cl, id, user.rol, usuariosList.results), user, 'clientes'))
})

clientes.post('/clientes/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const b = await c.req.parseBody()
  try {
    const tipoCliente = String(b.tipo_cliente || 'persona_fisica') === 'empresa' ? 'empresa' : 'persona_fisica'
    const esEmp = tipoCliente === 'empresa'

    const nombre   = String(b.nombre || '').trim()
    const apellido = esEmp ? '' : String(b.apellido || '').trim()
    if (!nombre) return c.redirect(`/clientes/${id}/editar?error=nombre_requerido`)
    if (!esEmp && !apellido) return c.redirect(`/clientes/${id}/editar?error=nombre_requerido`)

    const razonSocial     = esEmp ? String(b.razon_social || '').trim() : null
    const personaContacto = esEmp ? String(b.persona_contacto || '').trim() : null
    if (esEmp && !personaContacto) return c.redirect(`/clientes/${id}/editar?error=contacto_requerido`)

    const nroDocumentoE = normalizarDocumento(tipoDoc2, String(b.nro_documento || '').trim())
    const telefonoE     = String(b.telefono || '').trim()
    if (!nroDocumentoE) return c.redirect(`/clientes/${id}/editar?error=documento_requerido`)
    if (!telefonoE)     return c.redirect(`/clientes/${id}/editar?error=telefono_requerido`)

    const TIPOS_DOC2 = ['CI', 'DNI', 'PAS', 'RUT', 'NIF', 'OTRO']
    const tipoDocDefault2 = esEmp ? 'RUT' : 'CI'
    const tipoDoc2 = TIPOS_DOC2.includes(String(b.tipo_documento)) ? String(b.tipo_documento) : tipoDocDefault2

    // Verificar documento duplicado (normalizando CI antes de comparar)
    const nroDocRawE = String(b.nro_documento || '').trim()
    const nroDocE    = normalizarDocumento(tipoDoc2, nroDocRawE)
    if (nroDocE) {
      const existe = await c.env.DB.prepare(
        `SELECT id, nombre, apellido, nombre_completo FROM clientes WHERE nro_documento = ? AND id != ? LIMIT 1`
      ).bind(nroDocE, id).first() as any
      if (existe) {
        const nombreExistente = existe.nombre_completo || `${existe.nombre} ${existe.apellido}`.trim()
        return c.redirect(`/clientes/${id}/editar?error=documento_duplicado&doc=${encodeURIComponent(nroDocE)}&cliente=${encodeURIComponent(nombreExistente)}`)
      }
    }

    const hoyClEdit = new Date().toISOString().split('T')[0]
    if (!esEmp && b.fecha_nacimiento && String(b.fecha_nacimiento) > hoyClEdit) {
      return c.redirect(`/clientes/${id}/editar?error=fecha_nacimiento_invalida`)
    }

    const nc = esEmp ? nombre : `${nombre} ${apellido}`.trim()

    // Solo gerente/supervisor/admin pueden cambiar el vendedor titular
    const canChangeVend = isSupervisorOrAbove(user.rol)
    const vendedorIdNew = canChangeVend && b.vendedor_id ? Number(b.vendedor_id) : null

    await c.env.DB.prepare(`
      UPDATE clientes SET
        nombre=?, apellido=?, nombre_completo=?,
        email=?, telefono=?, direccion=?,
        tipo_documento=?, nro_documento=?,
        fecha_nacimiento=?, vencimiento_pasaporte=?,
        preferencias_comida=?, millas_aerolineas=?, notas=?,
        tipo_cliente=?, razon_social=?, persona_contacto=?,
        ${canChangeVend && b.vendedor_id ? 'vendedor_id=?,' : ''}
        updated_at=datetime('now')
      WHERE id=?
    `).bind(
      nombre.substring(0, 100), apellido.substring(0, 100), nc.substring(0, 200),
      b.email ? String(b.email).trim().substring(0, 200) : null,
      telefonoE.substring(0, 50),
      b.direccion ? String(b.direccion).trim().substring(0, 300) : null,
      tipoDoc2, nroDocumentoE.substring(0, 50),
      (!esEmp && b.fecha_nacimiento) ? b.fecha_nacimiento : null,
      (!esEmp && b.vencimiento_pasaporte) ? b.vencimiento_pasaporte : null,
      b.preferencias_comida ? String(b.preferencias_comida).trim().substring(0, 200) : null,
      b.millas_aerolineas ? String(b.millas_aerolineas).trim().substring(0, 100) : null,
      b.notas ? String(b.notas).trim().substring(0, 1000) : null,
      tipoCliente,
      razonSocial ? razonSocial.substring(0, 200) : null,
      personaContacto ? personaContacto.substring(0, 200) : null,
      ...(canChangeVend && b.vendedor_id ? [vendedorIdNew] : []),
      id
    ).run()
    return c.redirect(`/clientes/${id}`)
  } catch (e: any) {
    return c.redirect(`/clientes/${id}/editar?error=1`)
  }
})

// ══════════════════════════════════════════════════════════════
// FORMULARIO
// ══════════════════════════════════════════════════════════════
function clienteForm(cl: any, id?: string, userRol?: string, usuariosList?: any[]): string {
  const action    = id ? `/clientes/${id}/editar` : '/clientes'
  const backHref  = id ? `/clientes/${id}` : '/clientes'
  const isEdit    = !!id
  const initEmp   = cl?.tipo_cliente === 'empresa'
  const errorQ    = '' // errors shown via query param
  const canChangeVendedor = userRol === 'gerente' || userRol === 'administracion' || userRol === 'supervisor'

  return `
    <div style="max-width:720px;">
      <a href="${backHref}" style="color:#7B3FA0;font-size:13px;margin-bottom:20px;display:block;"><i class="fas fa-arrow-left"></i> Volver</a>
      <script>
        (function() {
          const p = new URLSearchParams(window.location.search)
          const err = p.get('error')
          const doc = p.get('doc')
          const cli = p.get('cliente')
          if (err === 'documento_duplicado') {
            const div = document.createElement('div')
            div.className = 'alert alert-danger'
            div.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:16px;'
            div.innerHTML = '<i class="fas fa-exclamation-triangle" style="font-size:18px;"></i><div><strong>Documento duplicado</strong> — El número <strong>' + (doc||'') + '</strong> ya está registrado para el cliente <strong>' + (cli||'') + '</strong>.</div>'
            document.currentScript.parentNode.insertBefore(div, document.currentScript.nextSibling)
          } else if (err) {
            const msgs = {
              'nombre_requerido':          'El nombre y apellido son obligatorios.',
              'contacto_requerido':        'La persona de contacto es obligatoria para empresas.',
              'documento_requerido':       'El número de documento es obligatorio.',
              'telefono_requerido':        'El teléfono es obligatorio.',
              'fecha_nacimiento_invalida': 'La fecha de nacimiento no puede ser futura.',
              '1':                         'Ocurrió un error al guardar. Revisá los datos e intentá de nuevo.',
            }
            const msg = msgs[err] || 'Error al crear el cliente. Revisá los datos.'
            const div = document.createElement('div')
            div.className = 'alert alert-danger'
            div.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:16px;'
            div.innerHTML = '<i class="fas fa-exclamation-circle" style="font-size:18px;"></i><div><strong>Error:</strong> ' + msg + '</div>'
            document.currentScript.parentNode.insertBefore(div, document.currentScript.nextSibling)
          }
        })()
      </script>
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-user-${isEdit ? 'edit' : 'plus'}" style="color:#EC008C"></i>
            ${isEdit ? 'Editar' : 'Nuevo'} Cliente
          </span>
        </div>
        <div class="card-body">
          <form method="POST" action="${action}" id="form-cliente">

            <!-- Toggle tipo cliente -->
            <div style="margin-bottom:20px;">
              <label class="form-label">TIPO DE CLIENTE <span style="color:#dc2626;">*</span></label>
              <div style="display:flex;gap:0;border:1.5px solid #e5e7eb;border-radius:10px;overflow:hidden;max-width:360px;">
                <label id="lbl-pf" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s;
                  background:${!initEmp ? 'linear-gradient(135deg,#7B3FA0,#EC008C)' : '#f9fafb'};
                  color:${!initEmp ? 'white' : '#6b7280'};">
                  <input type="radio" name="tipo_cliente" value="persona_fisica" ${!initEmp ? 'checked' : ''} style="display:none;" onchange="toggleTipoCliente('persona_fisica')">
                  <i class="fas fa-user"></i> Persona Física
                </label>
                <label id="lbl-emp" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;transition:all .2s;border-left:1.5px solid #e5e7eb;
                  background:${initEmp ? 'linear-gradient(135deg,#0369a1,#0ea5e9)' : '#f9fafb'};
                  color:${initEmp ? 'white' : '#6b7280'};">
                  <input type="radio" name="tipo_cliente" value="empresa" ${initEmp ? 'checked' : ''} style="display:none;" onchange="toggleTipoCliente('empresa')">
                  <i class="fas fa-building"></i> Empresa
                </label>
              </div>
            </div>

            <!-- SECCIÓN PERSONA FÍSICA -->
            <div id="sec-pf" style="display:${initEmp ? 'none' : 'block'}">
              <div class="grid-2" style="margin-bottom:14px;">
                <div class="form-group">
                  <label class="form-label">NOMBRE <span style="color:#dc2626;">*</span></label>
                  <input type="text" name="nombre" id="inp-nombre-pf"
                    value="${esc(cl?.nombre) || ''}"
                    class="form-control" placeholder="Ej: María">
                </div>
                <div class="form-group">
                  <label class="form-label">APELLIDO <span style="color:#dc2626;">*</span></label>
                  <input type="text" name="apellido" id="inp-apellido"
                    value="${esc(cl?.apellido) || ''}"
                    class="form-control" placeholder="Ej: González Rodríguez">
                </div>
              </div>
            </div>

            <!-- SECCIÓN EMPRESA -->
            <div id="sec-emp" style="display:${initEmp ? 'block' : 'none'}">
              <div class="grid-2" style="margin-bottom:14px;">
                <div class="form-group">
                  <label class="form-label">NOMBRE COMERCIAL <span style="color:#dc2626;">*</span></label>
                  <input type="text" name="nombre" id="inp-nombre-emp"
                    value="${esc(cl?.nombre) || ''}"
                    class="form-control" placeholder="Ej: TechCorp S.A.">
                </div>
                <div class="form-group">
                  <label class="form-label">RAZÓN SOCIAL</label>
                  <input type="text" name="razon_social"
                    value="${esc(cl?.razon_social) || ''}"
                    class="form-control" placeholder="Ej: TechCorp Sociedad Anónima">
                </div>
              </div>
              <div class="form-group" style="margin-bottom:14px;">
                <label class="form-label">PERSONA DE CONTACTO <span style="color:#dc2626;">*</span></label>
                <input type="text" name="persona_contacto" id="inp-contacto"
                  value="${esc(cl?.persona_contacto) || ''}"
                  class="form-control" placeholder="Ej: Juan Pérez (Gerente de Compras)">
              </div>
            </div>

            <!-- Documento (común) -->
            <div class="grid-2" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label">TIPO DOCUMENTO <span style="color:#dc2626;">*</span></label>
                <select name="tipo_documento" required class="form-control"
                        id="sel-tipo-doc" onchange="mostrarCamposDoc(this.value)">
                  <option value="">— Seleccionar —</option>
                  <!-- Persona física -->
                  <optgroup label="Persona Física" id="opts-pf">
                    <option value="CI"  ${cl?.tipo_documento === 'CI'  ? 'selected' : ''}>C.I. (Cédula de Identidad)</option>
                    <option value="DNI" ${cl?.tipo_documento === 'DNI' ? 'selected' : ''}>DNI (Arg. / otro país)</option>
                    <option value="PAS" ${cl?.tipo_documento === 'PAS' ? 'selected' : ''}>Pasaporte</option>
                  </optgroup>
                  <!-- Empresa -->
                  <optgroup label="Empresa" id="opts-emp">
                    <option value="RUT" ${cl?.tipo_documento === 'RUT' ? 'selected' : ''}>RUT (Uruguay)</option>
                    <option value="NIF" ${cl?.tipo_documento === 'NIF' ? 'selected' : ''}>NIF (España / UE)</option>
                  </optgroup>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">NRO DOCUMENTO <span style="color:#dc2626;">*</span></label>
                <div style="position:relative;">
                  <input type="text" name="nro_documento" id="inp-nro-doc" required
                    value="${esc(cl?.nro_documento) || ''}"
                    class="form-control" placeholder="Ej: 12345678" autocomplete="off">
                  <span id="ci-validacion" style="display:none;position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:16px;"></span>
                </div>
                <div id="ci-msg" style="font-size:11px;margin-top:3px;"></div>
              </div>
            </div>

            <!-- Teléfono y Email -->
            <div class="grid-2" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label">TELÉFONO</label>
                <input type="text" name="telefono"
                  value="${esc(cl?.telefono) || ''}"
                  class="form-control" placeholder="+598 9X XXX XXX">
              </div>
              <div class="form-group">
                <label class="form-label">EMAIL</label>
                <input type="email" name="email"
                  value="${esc(cl?.email) || ''}" class="form-control">
              </div>
            </div>

            <!-- Dirección -->
            <div class="form-group" style="margin-bottom:14px;">
              <label class="form-label">DIRECCIÓN</label>
              <input type="text" name="direccion"
                value="${esc(cl?.direccion) || ''}" class="form-control">
            </div>

            <!-- Campos solo Persona Física -->
            <div id="sec-pf-extra" style="display:${initEmp ? 'none' : 'block'}">
              <div class="grid-2" style="margin-bottom:14px;">
                <div class="form-group">
                  <label class="form-label">FECHA NACIMIENTO</label>
                  <input type="date" name="fecha_nacimiento"
                    value="${cl?.fecha_nacimiento || ''}" class="form-control" id="inp-fecha-nac-cl">
                  <div id="err-fecha-nac-cl" style="display:none;font-size:11px;color:#dc2626;margin-top:3px;"><i class="fas fa-exclamation-circle"></i> La fecha de nacimiento no puede ser futura.</div>
                </div>
                <div class="form-group">
                  <label class="form-label">VENCIMIENTO PASAPORTE</label>
                  <input type="date" name="vencimiento_pasaporte"
                    value="${cl?.vencimiento_pasaporte || ''}" class="form-control">
                </div>
              </div>
              <div class="grid-2" style="margin-bottom:14px;">
                <div class="form-group">
                  <label class="form-label">PREFERENCIAS COMIDA</label>
                  <input type="text" name="preferencias_comida"
                    value="${esc(cl?.preferencias_comida) || ''}"
                    class="form-control" placeholder="Ej: Vegano, Sin Gluten">
                </div>
                <div class="form-group">
                  <label class="form-label">NRO VIAJERO FRECUENTE</label>
                  <input type="text" name="millas_aerolineas"
                    value="${esc(cl?.millas_aerolineas) || ''}"
                    class="form-control" placeholder="LATAM: LTxxxxxx">
                </div>
              </div>
            </div>

            <!-- Notas -->
            <div class="form-group" style="margin-bottom:20px;">
              <label class="form-label">NOTAS</label>
              <textarea name="notas" rows="3" class="form-control">${esc(cl?.notas) || ''}</textarea>
            </div>

            ${canChangeVendedor && isEdit && usuariosList?.length ? `
            <div class="form-group" style="margin-bottom:20px;">
              <label class="form-label">VENDEDOR TITULAR</label>
              <select name="vendedor_id" class="form-control">
                <option value="">— Sin asignar —</option>
                ${(usuariosList || []).map((u: any) => `<option value="${u.id}" ${cl?.vendedor_id == u.id ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
              </select>
              <div style="font-size:11px;color:#6b7280;margin-top:3px;"><i class="fas fa-info-circle"></i> Solo gerentes y supervisores pueden modificar el vendedor titular.</div>
            </div>
            ` : ''}

            <div style="display:flex;gap:10px;">
              <button type="submit" class="btn btn-primary" onclick="return validarFormCliente()">
                <i class="fas fa-save"></i> ${isEdit ? 'Guardar cambios' : 'Crear Cliente'}
              </button>
              <a href="${backHref}" class="btn btn-outline">Cancelar</a>
            </div>
          </form>

          <script>
            let _tipoCliente = '${initEmp ? 'empresa' : 'persona_fisica'}'

            function toggleTipoCliente(tipo) {
              _tipoCliente = tipo
              const esEmp = tipo === 'empresa'

              // Toggle secciones
              document.getElementById('sec-pf').style.display       = esEmp ? 'none' : 'block'
              document.getElementById('sec-emp').style.display      = esEmp ? 'block' : 'none'
              document.getElementById('sec-pf-extra').style.display = esEmp ? 'none' : 'block'

              // Toggle estilos botones
              const lblPf  = document.getElementById('lbl-pf')
              const lblEmp = document.getElementById('lbl-emp')
              lblPf.style.background  = esEmp ? '#f9fafb' : 'linear-gradient(135deg,#7B3FA0,#EC008C)'
              lblPf.style.color       = esEmp ? '#6b7280' : 'white'
              lblEmp.style.background = esEmp ? 'linear-gradient(135deg,#0369a1,#0ea5e9)' : '#f9fafb'
              lblEmp.style.color      = esEmp ? 'white' : '#6b7280'

              // Ajustar opciones de documento
              const selDoc = document.getElementById('sel-tipo-doc')
              if (esEmp) {
                selDoc.value = selDoc.value === 'RUT' || selDoc.value === 'NIF' ? selDoc.value : 'RUT'
              } else {
                selDoc.value = selDoc.value === 'CI' || selDoc.value === 'DNI' || selDoc.value === 'PAS' ? selDoc.value : 'CI'
              }
              mostrarCamposDoc(selDoc.value)
            }

            function validarFormCliente() {
              const esEmp = _tipoCliente === 'empresa'
              const nombre = (esEmp
                ? document.getElementById('inp-nombre-emp')
                : document.getElementById('inp-nombre-pf'))?.value?.trim()
              const apellido = !esEmp ? document.getElementById('inp-apellido')?.value?.trim() : 'ok'
              const contacto = esEmp ? document.getElementById('inp-contacto')?.value?.trim() : 'ok'
              if (!nombre) { alert('El nombre es obligatorio.'); return false }
              if (!apellido) { alert('El apellido es obligatorio.'); return false }
              if (!contacto) { alert('La persona de contacto es obligatoria para empresas.'); return false }

              // Deshabilitar los inputs de la sección oculta para que no se envíen al servidor
              if (esEmp) {
                const pfNombre = document.getElementById('inp-nombre-pf')
                const pfApell  = document.getElementById('inp-apellido')
                if (pfNombre) pfNombre.disabled = true
                if (pfApell)  pfApell.disabled  = true
              } else {
                const empNombre = document.getElementById('inp-nombre-emp')
                if (empNombre) empNombre.disabled = true
              }
              return true
            }

            function mostrarCamposDoc(tipo) {
              const inp   = document.getElementById('inp-nro-doc')
              const msg   = document.getElementById('ci-msg')
              const valid = document.getElementById('ci-validacion')
              inp.style.borderColor = ''
              valid.style.display   = 'none'
              valid.textContent     = ''
              msg.textContent       = ''
              msg.style.color       = '#9ca3af'
              if (tipo === 'CI') {
                inp.placeholder = 'Ej: 12345678 (sin puntos ni guión)'
                msg.innerHTML   = '<i class="fas fa-info-circle"></i> Ingresá los 8 dígitos. Se validará automáticamente.'
                if (inp.value) validarCI(inp.value)
              } else if (tipo === 'DNI') {
                inp.placeholder = 'Ej: 12345678'
                msg.innerHTML   = '<i class="fas fa-info-circle"></i> DNI (8 dígitos).'
              } else if (tipo === 'PAS') {
                inp.placeholder = 'Ej: ABC123456'
                msg.innerHTML   = '<i class="fas fa-passport"></i> Número de pasaporte.'
              } else if (tipo === 'RUT') {
                inp.placeholder = 'Ej: 210012340011'
                msg.innerHTML   = '<i class="fas fa-building"></i> RUT uruguayo.'
              } else if (tipo === 'NIF') {
                inp.placeholder = 'Ej: B12345678'
                msg.innerHTML   = '<i class="fas fa-globe-europe"></i> NIF / CIF español o europeo.'
              }
            }

            function validarCI(valor) {
              const msg   = document.getElementById('ci-msg')
              const valid = document.getElementById('ci-validacion')
              const inp   = document.getElementById('inp-nro-doc')
              const limpio = valor.replace(/[^0-9]/g, '')
              if (!limpio.length) { valid.style.display='none'; msg.textContent=''; inp.style.borderColor=''; return }
              if (limpio.length < 8) {
                valid.style.display='inline'; valid.textContent='⏳'
                msg.textContent='Ingresá los 8 dígitos'; msg.style.color='#9ca3af'
                inp.style.borderColor=''; return
              }
              const padded = limpio.padStart(8,'0')
              const base   = padded.slice(0,7)
              const ingresado  = parseInt(padded[7])
              const mult = [2,9,8,7,6,3,4]
              let suma = 0
              for(let i=0;i<7;i++) suma += parseInt(base[i])*mult[i]
              const esperado = suma%10===0 ? 0 : 10 - suma%10
              if(ingresado===esperado) {
                valid.style.display='inline'; valid.textContent='✅'
                msg.innerHTML='<span style="color:#059669;font-weight:600;"><i class="fas fa-check-circle"></i> Cédula válida</span>'
                inp.style.borderColor='#059669'
              } else {
                valid.style.display='inline'; valid.textContent='❌'
                msg.innerHTML='<span style="color:#dc2626;font-weight:600;"><i class="fas fa-times-circle"></i> Inválida — dígito esperado: <strong>'+esperado+'</strong></span>'
                inp.style.borderColor='#dc2626'
              }
            }

            document.addEventListener('DOMContentLoaded', function() {
              const sel = document.getElementById('sel-tipo-doc')
              const inp = document.getElementById('inp-nro-doc')
              if(sel && sel.value) mostrarCamposDoc(sel.value)
              if(inp) {
                inp.addEventListener('input', function() {
                  if(document.getElementById('sel-tipo-doc')?.value === 'CI') validarCI(this.value)
                })
              }
              // Fecha de nacimiento: no puede ser futura
              const hoyStr = new Date().toISOString().split('T')[0]
              const fnac   = document.querySelector('input[name="fecha_nacimiento"]')
              if (fnac) {
                fnac.setAttribute('max', hoyStr)
                fnac.addEventListener('change', function() {
                  const errEl = document.getElementById('err-fecha-nac-cl')
                  if (this.value && this.value > hoyStr) {
                    this.value = ''
                    if (errEl) errEl.style.display = 'block'
                  } else {
                    if (errEl) errEl.style.display = 'none'
                  }
                })
              }
            })
          </script>
        </div>
      </div>
    </div>
  `
}

// ══════════════════════════════════════════════════════════════
// GET /clientes/:id/cuenta-corriente — Estado de cuenta del cliente
// ══════════════════════════════════════════════════════════════
clientes.get('/clientes/:id/cuenta-corriente', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')

  try {
    const cl = await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(id).first() as any
    if (!cl) return c.redirect('/clientes')
    const nc = nombreCompleto(cl)

    // Files del cliente con sus totales de venta
    const filesCliente = await c.env.DB.prepare(`
      SELECT f.id, f.numero, f.estado, f.fecha_apertura, f.destino_principal,
             f.total_venta, f.total_costo, f.moneda,
             u.nombre as vendedor
      FROM files f
      LEFT JOIN usuarios u ON f.vendedor_id = u.id
      WHERE f.cliente_id = ? AND f.estado != 'anulado'
      ORDER BY f.fecha_apertura DESC
    `).bind(id).all()

    // Movimientos de caja del cliente (todos los files)
    const movimientos = await c.env.DB.prepare(`
      SELECT m.id, m.tipo, m.fecha, m.monto, m.moneda, m.metodo, m.concepto,
             m.referencia, m.anulado, m.cotizacion,
             f.numero as file_numero, f.id as file_id,
             f.total_venta as file_total_venta, f.moneda as file_moneda,
             b.nombre_entidad as banco_nombre,
             u.nombre as operador
      FROM movimientos_caja m
      LEFT JOIN files f ON m.file_id = f.id
      LEFT JOIN bancos b ON m.banco_id = b.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      WHERE m.cliente_id = ? AND (m.anulado IS NULL OR m.anulado = 0)
      ORDER BY m.fecha ASC
      LIMIT 500
    `).bind(id).all()

    // Totales por moneda
    const totalesPorMoneda: Record<string, { ingresado: number, adeuda: number, saldo: number }> = {}
    ;(movimientos.results as any[]).forEach((m: any) => {
      const mon = m.moneda || 'USD'
      if (!totalesPorMoneda[mon]) totalesPorMoneda[mon] = { ingresado: 0, adeuda: 0, saldo: 0 }
      if (m.tipo === 'ingreso') totalesPorMoneda[mon].ingresado += Number(m.monto || 0)
    })

    // Total vendido por moneda (de files)
    const totalVentasPorMoneda: Record<string, number> = {}
    ;(filesCliente.results as any[]).forEach((f: any) => {
      const mon = f.moneda || 'USD'
      totalVentasPorMoneda[mon] = (totalVentasPorMoneda[mon] || 0) + Number(f.total_venta || 0)
    })

    // Calcular adeuda = total_venta - ingresado
    Object.keys(totalVentasPorMoneda).forEach(mon => {
      if (!totalesPorMoneda[mon]) totalesPorMoneda[mon] = { ingresado: 0, adeuda: 0, saldo: 0 }
      totalesPorMoneda[mon].adeuda = Math.max(0, totalVentasPorMoneda[mon] - totalesPorMoneda[mon].ingresado)
      totalesPorMoneda[mon].saldo = totalesPorMoneda[mon].ingresado - (totalVentasPorMoneda[mon] || 0)
    })

    // Tarjetas de resumen
    const totalFiles = filesCliente.results.length
    const metodoIcons: Record<string, string> = {
      efectivo: 'fa-money-bill-wave', transferencia: 'fa-exchange-alt',
      tarjeta: 'fa-credit-card', cheque: 'fa-file-invoice'
    }

    const resumenCards = Object.entries(totalesPorMoneda).map(([mon, t]) => {
      const totalVta = totalVentasPorMoneda[mon] || 0
      const pct = totalVta > 0 ? Math.min(100, (t.ingresado / totalVta) * 100).toFixed(0) : '0'
      const adeudaColor = t.adeuda > 0 ? '#dc2626' : '#059669'
      return `
        <div class="stat-card" style="min-width:180px;">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">MONEDA ${mon}</div>
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Total facturado</div>
          <div style="font-size:20px;font-weight:800;color:#5a2d75;">$${totalVta.toLocaleString()}</div>
          <div style="font-size:11px;color:#059669;margin-top:6px;">Cobrado: <strong>$${t.ingresado.toLocaleString()}</strong></div>
          <div style="font-size:11px;color:${adeudaColor};">Adeuda: <strong>$${t.adeuda.toLocaleString()}</strong></div>
          <div style="margin-top:8px;background:#f3f4f6;border-radius:6px;height:6px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#7B3FA0,#EC008C);border-radius:6px;"></div>
          </div>
          <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${pct}% cobrado</div>
        </div>
      `
    }).join('')

    // Calcular saldo acumulado por file para cada movimiento (running balance)
    // Procesamos en orden ASC (ya viene así) para acumular correctamente
    const saldoAcumPorFile: Record<number, number> = {}
    const movConSaldo = (movimientos.results as any[]).map((m: any) => {
      if (!m.file_id) return { ...m, saldoCobradoFile: 0 }
      const fid = Number(m.file_id)
      if (!saldoAcumPorFile[fid]) saldoAcumPorFile[fid] = 0
      if (m.tipo === 'ingreso') saldoAcumPorFile[fid] += Number(m.monto || 0)
      return { ...m, saldoCobradoFile: saldoAcumPorFile[fid] }
    })

    // Invertimos para mostrar más reciente primero
    const movOrdenados = [...movConSaldo].reverse()

    // Filas de movimientos con link al recibo y saldo acumulado por file
    const filasMov = movOrdenados.map((m: any) => {
      const esIngreso = m.tipo === 'ingreso'
      const totalFile = Number(m.file_total_venta || 0)
      const saldoPendienteFile = m.file_id ? Math.max(0, totalFile - m.saldoCobradoFile) : null
      const saldoColor = saldoPendienteFile === 0 ? '#059669' : saldoPendienteFile !== null && saldoPendienteFile > 0 ? '#dc2626' : '#6b7280'

      return `
        <tr>
          <td style="font-size:12px;white-space:nowrap;">${(m.fecha || '').substring(0, 16).replace('T',' ')}</td>
          <td>
            <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:${esIngreso ? '#dcfce7' : '#fee2e2'};color:${esIngreso ? '#059669' : '#dc2626'};">
              ${esIngreso ? '↓ Cobro' : '↑ Dev.'}
            </span>
          </td>
          <td style="font-size:12px;">${esc(m.concepto || '—')}</td>
          <td style="font-size:12px;">
            ${m.file_id ? `<a href="/files/${m.file_id}" style="color:#7B3FA0;font-weight:700;">#${esc(m.file_numero)}</a>` : '—'}
          </td>
          <td style="font-size:12px;">
            <span style="font-size:11px;padding:2px 6px;background:#f3e8ff;color:#7B3FA0;border-radius:6px;">
              <i class="fas ${metodoIcons[m.metodo] || 'fa-money-bill'}" style="font-size:10px;"></i> ${esc(m.metodo)}
            </span>
          </td>
          <td style="font-size:12px;">${esc(m.banco_nombre || '—')}</td>
          <td style="text-align:right;font-weight:700;color:${esIngreso ? '#059669' : '#dc2626'};">
            ${esIngreso ? '+' : '-'}$${Number(m.monto || 0).toLocaleString()} ${m.moneda}
          </td>
          <td style="text-align:right;font-size:11px;">
            ${saldoPendienteFile !== null
              ? `<span style="color:${saldoColor};font-weight:700;">${saldoPendienteFile === 0 ? '✓ Saldado' : '$' + saldoPendienteFile.toLocaleString() + ' ' + (m.file_moneda||'USD')}</span>`
              : '—'}
          </td>
          <td style="font-size:11px;color:#9ca3af;">${esc(m.operador || '—')}</td>
          <td style="white-space:nowrap;">
            ${esIngreso && m.file_id
              ? `<a href="/tesoreria/recibo/${m.id}" target="_blank"
                   title="Ver recibo de pago"
                   style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#5a2d75;background:#f3e8ff;border:1px solid #e9d5ff;padding:3px 8px;border-radius:6px;text-decoration:none;">
                   <i class="fas fa-receipt" style="font-size:10px;"></i> Recibo
                 </a>`
              : ''}
          </td>
        </tr>
      `
    }).join('')

    // Filas de files
    const filasFiles = (filesCliente.results as any[]).map((f: any) => {
      const util = Number(f.total_venta || 0) - Number(f.total_costo || 0)
      const estColors: Record<string, string> = { en_proceso: '#0369a1', seniado: '#b45309', cerrado: '#065f46', anulado: '#991b1b' }
      return `
        <tr>
          <td><a href="/files/${f.id}" style="color:#7B3FA0;font-weight:700;">#${esc(f.numero)}</a></td>
          <td style="font-size:12px;">${(f.fecha_apertura || '').split('T')[0]}</td>
          <td style="font-size:12px;">${esc(f.destino_principal || '—')}</td>
          <td style="font-size:12px;">${esc(f.vendedor || '—')}</td>
          <td><span style="font-size:11px;font-weight:700;color:${estColors[f.estado] || '#374151'};background:#f3f4f6;padding:2px 8px;border-radius:8px;">${esc(f.estado)}</span></td>
          <td style="text-align:right;font-weight:700;color:#059669;">$${Number(f.total_venta || 0).toLocaleString()} ${f.moneda || 'USD'}</td>
          <td style="text-align:right;color:#6b7280;">$${Number(f.total_costo || 0).toLocaleString()}</td>
          <td style="text-align:right;color:#F7941D;font-weight:700;">$${util.toLocaleString()}</td>
        </tr>
      `
    }).join('')

    const content = `
      <!-- Navegación -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <a href="/clientes/${id}" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver al cliente</a>
          <span style="color:#d1d5db;">|</span>
          <a href="/clientes" style="color:#9ca3af;font-size:13px;">Clientes</a>
        </div>
        <div style="display:flex;gap:8px;">
          <a href="/reportes/exportar/cliente/${id}" class="btn btn-sm" style="background:#217346;color:white;border:none;" title="Exportar estado de cuenta a Excel/CSV">
            <i class="fas fa-file-excel"></i> Exportar Estado de Cuenta
          </a>
        </div>
      </div>

      <!-- Header cliente -->
      <div style="background:linear-gradient(135deg,#7B3FA0,#EC008C);color:white;border-radius:12px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;gap:14px;">
        <div style="width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;">
          ${esc((cl.nombre || cl.nombre_completo || '?').charAt(0).toUpperCase())}
        </div>
        <div>
          <div style="font-size:11px;opacity:0.8;letter-spacing:1px;">ESTADO DE CUENTA</div>
          <div style="font-size:20px;font-weight:800;">${esc(nc)}</div>
          <div style="font-size:12px;opacity:0.8;">${esc(cl.email || '')} ${cl.telefono ? '· ' + esc(cl.telefono) : ''} · ${totalFiles} files</div>
        </div>
      </div>

      <!-- Cards resumen globales -->
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px;">
        <div class="stat-card" style="min-width:160px;">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">TOTAL FILES</div>
          <div style="font-size:28px;font-weight:800;color:#5a2d75;">${totalFiles}</div>
        </div>
        ${resumenCards}
      </div>

      <!-- Resumen por file (mini-cards) -->
      ${filesCliente.results.length > 0 ? `
        <div style="margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:1px;margin-bottom:10px;">ESTADO POR FILE</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${(filesCliente.results as any[]).map((f: any) => {
              const cobradoFile = Object.values(saldoAcumPorFile)[0] // recalculamos abajo
              const cobradoEsteFile = (movimientos.results as any[])
                .filter((m: any) => m.file_id === f.id && m.tipo === 'ingreso')
                .reduce((s: number, m: any) => s + Number(m.monto || 0), 0)
              const totalFile = Number(f.total_venta || 0)
              const saldoFile = Math.max(0, totalFile - cobradoEsteFile)
              const pct = totalFile > 0 ? Math.min(100, (cobradoEsteFile / totalFile) * 100).toFixed(0) : '100'
              const estColors: Record<string,string> = { en_proceso:'#0369a1', seniado:'#b45309', cerrado:'#065f46' }
              const borde = saldoFile === 0 ? '#059669' : saldoFile > 0 && cobradoEsteFile > 0 ? '#f59e0b' : '#e5e7eb'
              return `
                <div style="background:white;border:1.5px solid ${borde};border-radius:10px;padding:12px 14px;min-width:200px;max-width:240px;">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                    <a href="/files/${f.id}" style="font-weight:700;color:#7B3FA0;text-decoration:none;font-size:13px;">#${esc(f.numero)}</a>
                    <span style="font-size:10px;font-weight:700;color:${estColors[f.estado]||'#374151'};background:#f3f4f6;padding:1px 6px;border-radius:6px;">${esc(f.estado)}</span>
                  </div>
                  <div style="font-size:11px;color:#9ca3af;margin-bottom:8px;">
                    ${esc(f.destino_principal || '—')} · ${(f.fecha_apertura||'').split('T')[0]}
                  </div>
                  <div style="font-size:12px;margin-bottom:4px;">
                    <span style="color:#6b7280;">Total:</span> <strong style="color:#5a2d75;">$${totalFile.toLocaleString()} ${f.moneda||'USD'}</strong>
                  </div>
                  <div style="font-size:12px;margin-bottom:6px;">
                    <span style="color:#6b7280;">Cobrado:</span> <strong style="color:#059669;">$${cobradoEsteFile.toLocaleString()}</strong>
                    &nbsp;·&nbsp;
                    <span style="color:${saldoFile>0?'#dc2626':'#059669'};font-weight:700;">${saldoFile > 0 ? 'Debe $'+saldoFile.toLocaleString() : '✓ Saldado'}</span>
                  </div>
                  <div style="background:#f3f4f6;border-radius:4px;height:5px;overflow:hidden;">
                    <div style="width:${pct}%;height:100%;background:${saldoFile===0?'#059669':'linear-gradient(90deg,#7B3FA0,#F7941D)'};border-radius:4px;transition:width 0.3s;"></div>
                  </div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                    <span style="font-size:10px;color:#9ca3af;">${pct}% cobrado</span>
                    <a href="/files/${f.id}" style="font-size:10px;color:#7B3FA0;text-decoration:none;font-weight:600;">Ver file →</a>
                  </div>
                </div>
              `
            }).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Tabs -->
      <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e5e7eb;">
        <button onclick="showTab('movimientos')" id="tab-movimientos"
          style="padding:8px 16px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;border-bottom:2px solid #7B3FA0;margin-bottom:-2px;color:#7B3FA0;">
          <i class="fas fa-exchange-alt"></i> Movimientos (${movimientos.results.length})
        </button>
        <button onclick="showTab('files')" id="tab-files"
          style="padding:8px 16px;font-size:13px;font-weight:600;border:none;background:none;cursor:pointer;color:#6b7280;">
          <i class="fas fa-folder-open"></i> Files (${totalFiles})
        </button>
      </div>

      <!-- Panel movimientos -->
      <div id="panel-movimientos">
        ${movimientos.results.length === 0 ? `
          <div style="text-align:center;padding:48px;color:#9ca3af;background:white;border-radius:12px;border:1.5px solid #e5e7eb;">
            <i class="fas fa-inbox" style="font-size:32px;margin-bottom:12px;opacity:0.3;display:block;"></i>
            Sin movimientos de caja registrados para este cliente.
          </div>
        ` : `
          <div class="card">
            <div class="card-header">
              <span class="card-title"><i class="fas fa-exchange-alt" style="color:#7B3FA0"></i> Historial de Movimientos</span>
              <a href="/reportes/exportar/cliente/${id}?tipo=movimientos" class="btn btn-sm" style="background:#217346;color:white;border:none;font-size:12px;">
                <i class="fas fa-file-excel"></i> Exportar
              </a>
            </div>
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th><th>Tipo</th><th>Concepto</th><th>File</th>
                    <th>Método</th><th>Banco</th>
                    <th style="text-align:right;">Monto</th>
                    <th style="text-align:right;">Saldo file</th>
                    <th>Operador</th><th></th>
                  </tr>
                </thead>
                <tbody>${filasMov || '<tr><td colspan="10" style="text-align:center;padding:20px;color:#9ca3af;">Sin movimientos</td></tr>'}</tbody>
              </table>
            </div>
          </div>
        `}
      </div>

      <!-- Panel files -->
      <div id="panel-files" style="display:none;">
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-folder-open" style="color:#F7941D"></i> Files del cliente</span>
            <a href="/reportes/exportar/cliente/${id}?tipo=files" class="btn btn-sm" style="background:#217346;color:white;border:none;font-size:12px;">
              <i class="fas fa-file-excel"></i> Exportar
            </a>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nº File</th><th>Fecha</th><th>Destino</th><th>Vendedor</th>
                  <th>Estado</th><th style="text-align:right;">Venta</th><th style="text-align:right;">Costo</th><th style="text-align:right;">Utilidad</th>
                </tr>
              </thead>
              <tbody>${filasFiles || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#9ca3af;">Sin files</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <script>
        function showTab(tab) {
          document.getElementById('panel-movimientos').style.display = tab === 'movimientos' ? '' : 'none'
          document.getElementById('panel-files').style.display = tab === 'files' ? '' : 'none'
          document.getElementById('tab-movimientos').style.borderBottomColor = tab === 'movimientos' ? '#7B3FA0' : 'transparent'
          document.getElementById('tab-movimientos').style.color = tab === 'movimientos' ? '#7B3FA0' : '#6b7280'
          document.getElementById('tab-files').style.borderBottomColor = tab === 'files' ? '#7B3FA0' : 'transparent'
          document.getElementById('tab-files').style.color = tab === 'files' ? '#7B3FA0' : '#6b7280'
        }
      </script>
    `
    return c.html(baseLayout(`Cta. Cte. — ${nc}`, content, user, 'clientes'))
  } catch (e: any) {
    return c.html(baseLayout('Cuenta Corriente', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'clientes'))
  }
})

// ── API: Crear cliente rápido (desde modal inline en Nuevo File) ──
clientes.post('/api/clientes/rapido', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  try {
    const body = await c.req.json() as any
    const tipoCliente = body.tipo_cliente === 'empresa' ? 'empresa' : 'persona_fisica'
    const esEmpresa   = tipoCliente === 'empresa'

    const nombre   = String(body.nombre || '').trim().substring(0, 100)
    const apellido = esEmpresa ? '' : String(body.apellido || '').trim().substring(0, 100)
    const razonSocial      = esEmpresa ? (body.razon_social ? String(body.razon_social).trim().substring(0, 200) : null) : null
    const personaContacto  = esEmpresa ? String(body.persona_contacto || '').trim().substring(0, 150) : null
    const email    = body.email    ? String(body.email).trim().substring(0, 200) : null
    const telefono = body.telefono ? String(body.telefono).trim().substring(0, 50) : null

    const TIPOS_DOC_R = ['CI', 'DNI', 'PAS', 'RUT', 'NIF', 'OTRO']
    const defaultDoc  = esEmpresa ? 'RUT' : 'CI'
    const tipoDoc     = TIPOS_DOC_R.includes(String(body.tipo_documento)) ? String(body.tipo_documento) : defaultDoc
    const nroDoc      = body.nro_documento ? String(body.nro_documento).trim().substring(0, 50) : null

    // Validaciones
    if (!nombre) return c.json({ error: esEmpresa ? 'El nombre comercial es obligatorio.' : 'El nombre es obligatorio.' }, 400)
    if (!esEmpresa && !apellido) return c.json({ error: 'El apellido es obligatorio.' }, 400)
    if (esEmpresa && !personaContacto) return c.json({ error: 'La persona de contacto es obligatoria para empresas.' }, 400)

    const nombreCompleto = esEmpresa ? nombre : `${nombre} ${apellido}`.trim()

    const result = await c.env.DB.prepare(`
      INSERT INTO clientes
        (nombre, apellido, nombre_completo, tipo_cliente, razon_social, persona_contacto,
         tipo_documento, nro_documento, email, telefono)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      nombre, apellido, nombreCompleto, tipoCliente,
      razonSocial, personaContacto,
      tipoDoc, nroDoc, email, telefono
    ).run()

    // Label para el selector: empresa muestra nombre comercial, persona muestra "Apellido Nombre"
    const labelSelector = esEmpresa ? nombre : `${apellido} ${nombre}`.trim()
    return c.json({ id: result.meta.last_row_id, nombre_completo: labelSelector })
  } catch (e: any) {
    return c.json({ error: e.message || 'Error interno del servidor' }, 500)
  }
})

export default clientes
