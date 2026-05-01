import { Hono } from 'hono'
import { getUser, canSeeAllFiles, canReopenFile, canCloseAtLoss, canAnularFile, canAccessTesoreria, isSupervisorOrAbove, isAdminOrAbove, isGerente } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'
import { getOrFetch, invalidateCachePrefix } from '../lib/cache'

type Bindings = { DB: D1Database }
const files = new Hono<{ Bindings: Bindings }>()

// Badges de estado del file
function getBadge(estado: string) {
  const m: Record<string, string> = {
    en_proceso: 'badge-en_proceso',
    seniado:    'badge-seniado',
    cerrado:    'badge-cerrado',
    anulado:    'badge-anulado',
    // legado
    cotizacion: 'badge-cotizacion', confirmado: 'badge-confirmado', operado: 'badge-operado'
  }
  return m[estado] || 'badge-pendiente'
}

function getLabelEstado(estado: string) {
  const m: Record<string, string> = {
    en_proceso: 'En Proceso', seniado: 'Señado', cerrado: 'Cerrado', anulado: 'Anulado',
    cotizacion: 'En Proceso', confirmado: 'Señado', operado: 'Cerrado'
  }
  return m[estado] || estado
}

// Badge de estado de pago al proveedor
function getBadgePago(estadoPago: string) {
  if (estadoPago === 'pagado') return `<span class="badge badge-pago-pagado"><i class="fas fa-check-circle"></i> PAGADO</span>`
  if (estadoPago === 'tc_enviada') return `<span class="badge" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd;"><i class="fas fa-credit-card"></i> TC Enviada</span>`
  if (estadoPago === 'tc_negada') return `<span class="badge" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;"><i class="fas fa-times-circle"></i> TC Negada</span>`
  return `<span class="badge badge-pago-pendiente"><i class="fas fa-clock"></i> PEND. PAGO</span>`
}

// Generar número de file
async function generarNumeroFile(db: D1Database): Promise<string> {
  const año = new Date().getFullYear()
  const last = await db.prepare('SELECT numero FROM files WHERE numero LIKE ? ORDER BY id DESC LIMIT 1').bind(`${año}%`).first() as any
  if (!last) return `${año}001`
  const num = parseInt(last.numero.replace(String(año), '')) + 1
  return `${año}${String(num).padStart(3, '0')}`
}

// ── Búsqueda de destinos (autocompletado) ─────────────────────────────────────
files.get('/destinos/search', async (c) => {
  const q = (c.req.query('q') || '').trim().toUpperCase()
  if (q.length < 2) return c.json([])
  const rows = await c.env.DB.prepare(`
    SELECT code, name, country_id
    FROM destinos
    WHERE code LIKE ? OR UPPER(name) LIKE ?
    ORDER BY
      CASE WHEN code = ? THEN 0
           WHEN code LIKE ? THEN 1
           ELSE 2 END,
      name
    LIMIT 10
  `).bind(`${q}%`, `%${q}%`, q, `${q}%`).all()
  return c.json(rows.results || [])
})

// ── Componente HTML de autocompletado de destinos ────────────────────────────
function destinoAutocomplete(opts: {
  name: string,
  id: string,
  value?: string,
  label?: string,
  placeholder?: string,
  required?: boolean
}): string {
  const { name, id, value = '', label = 'DESTINO', placeholder = 'Escribí código IATA o nombre...', required = false } = opts
  return `
    <div class="destino-autocomplete-wrapper" style="position:relative;">
      <input type="hidden" name="${name}" id="${id}-hidden" value="${esc(value)}">
      <input type="text" id="${id}-input" autocomplete="off"
        class="form-control" placeholder="${placeholder}"
        value="${esc(value)}"
        ${required ? 'required' : ''}
        style="padding-right:32px;"
        oninput="destinoSearch('${id}', this.value)"
        onkeydown="destinoKeydown(event, '${id}')"
        onblur="setTimeout(()=>destinoHide('${id}'), 200)">
      ${value ? `<span id="${id}-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;color:#9ca3af;font-size:14px;" onclick="destinoClear('${id}')">✕</span>` : `<span id="${id}-clear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;color:#9ca3af;font-size:14px;" onclick="destinoClear('${id}')">✕</span>`}
      <div id="${id}-dropdown" style="display:none;position:absolute;z-index:1000;left:0;right:0;top:100%;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);max-height:280px;overflow-y:auto;"></div>
    </div>
    <script>
    (function(){
      if (window._destinoACInit) return
      window._destinoACInit = true
      window._destinoTimers = {}
      window._destinoIdx = {}

      window.destinoSearch = function(id, val) {
        clearTimeout(window._destinoTimers[id])
        const hidden = document.getElementById(id+'-hidden')
        const clr = document.getElementById(id+'-clear')
        if (clr) clr.style.display = val ? 'block' : 'none'
        if (!val || val.length < 2) { destinoHide(id); hidden.value = ''; return }
        window._destinoTimers[id] = setTimeout(async () => {
          const res = await fetch('/destinos/search?q=' + encodeURIComponent(val))
          const data = await res.json()
          window._destinoIdx[id] = -1
          const dd = document.getElementById(id+'-dropdown')
          if (!data.length) { dd.style.display='none'; return }
          dd.innerHTML = data.map((d,i) => \`<div data-idx="\${i}" data-code="\${d.code}" data-name="\${d.name}"
            style="padding:8px 12px;cursor:pointer;display:flex;gap:8px;align-items:center;font-size:13px;"
            onmouseenter="this.style.background='#f3f0ff'"
            onmouseleave="this.style.background=''"
            onmousedown="destinoSelect('\${id}','\${d.code}','\${d.name.replace(/'/g,'\\\\\\'')}')">
            <span style="background:#ede9fe;color:#6d28d9;padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px;min-width:38px;text-align:center;">\${d.code}</span>
            <span>\${d.name}</span>
            <span style="color:#9ca3af;font-size:11px;margin-left:auto;">\${d.country_id}</span>
          </div>\`).join('')
          dd.style.display = 'block'
        }, 200)
      }

      window.destinoSelect = function(id, code, name) {
        document.getElementById(id+'-hidden').value = code
        document.getElementById(id+'-input').value = code + ' — ' + name
        const clr = document.getElementById(id+'-clear')
        if (clr) clr.style.display = 'block'
        destinoHide(id)
      }

      window.destinoClear = function(id) {
        document.getElementById(id+'-hidden').value = ''
        document.getElementById(id+'-input').value = ''
        const clr = document.getElementById(id+'-clear')
        if (clr) clr.style.display = 'none'
        destinoHide(id)
        document.getElementById(id+'-input').focus()
      }

      window.destinoHide = function(id) {
        const dd = document.getElementById(id+'-dropdown')
        if (dd) dd.style.display = 'none'
      }

      window.destinoKeydown = function(e, id) {
        const dd = document.getElementById(id+'-dropdown')
        if (!dd || dd.style.display==='none') return
        const items = dd.querySelectorAll('[data-idx]')
        let idx = window._destinoIdx[id] || -1
        if (e.key==='ArrowDown') { e.preventDefault(); idx=Math.min(idx+1,items.length-1) }
        else if (e.key==='ArrowUp') { e.preventDefault(); idx=Math.max(idx-1,-1) }
        else if (e.key==='Enter' && idx>=0) { e.preventDefault(); const it=items[idx]; destinoSelect(id,it.dataset.code,it.dataset.name); return }
        else if (e.key==='Escape') { destinoHide(id); return }
        window._destinoIdx[id] = idx
        items.forEach((it,i) => { it.style.background = i===idx ? '#f3f0ff' : '' })
      }
    })()
    </script>`
}

// Lista de Files
files.get('/files', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const estado     = c.req.query('estado')      || ''
  const buscar     = c.req.query('buscar')      || ''
  const vendedorId = c.req.query('vendedor_id') || ''
  const fechaDesde = c.req.query('fecha_desde') || ''
  const fechaHasta = c.req.query('fecha_hasta') || ''
  const conSaldo   = c.req.query('con_saldo')   || ''
  const sortBy     = c.req.query('sort')        || 'fecha_viaje'
  const sortDir    = c.req.query('dir')         === 'desc' ? 'DESC' : 'ASC'
  const isGerente = canSeeAllFiles(user.rol)  // supervisor, admin y gerente ven todos

  try {
    // Cargar lista de vendedores solo para roles que pueden filtrar
    const vendedoresList = isGerente
      ? await c.env.DB.prepare(`SELECT id, nombre FROM usuarios WHERE activo=1 ORDER BY nombre`).all()
      : { results: [] }

    let query = `SELECT f.*,
                   COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre,
                   u.nombre as vendedor_nombre,
                   COALESCE((SELECT SUM(m.monto) FROM movimientos_caja m WHERE m.file_id = f.id AND m.tipo='ingreso' AND m.anulado=0),0) as total_cobrado
                 FROM files f
                 JOIN clientes c ON f.cliente_id = c.id
                 JOIN usuarios u ON f.vendedor_id = u.id
                 WHERE 1=1`
    const params: any[] = []

    if (!isGerente) {
      query += ' AND f.vendedor_id = ?'; params.push(user.id)
    } else if (vendedorId) {
      query += ' AND f.vendedor_id = ?'; params.push(vendedorId)
    }
    if (estado) { query += ' AND f.estado = ?'; params.push(estado) }
    if (buscar) { query += ` AND (f.numero LIKE ? OR COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) LIKE ? OR f.destino_principal LIKE ?)`; params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`) }
    if (fechaDesde) { query += ' AND f.fecha_viaje >= ?'; params.push(fechaDesde) }
    if (fechaHasta) { query += ' AND f.fecha_viaje <= ?'; params.push(fechaHasta) }
    if (conSaldo) { query += " AND f.estado != 'anulado' AND (f.total_venta - COALESCE((SELECT SUM(m2.monto) FROM movimientos_caja m2 WHERE m2.file_id = f.id AND m2.tipo='ingreso' AND m2.anulado=0),0)) > 0.01"}
    // Columnas permitidas para ordenar (whitelist para evitar SQL injection)
    const sortCols: Record<string, string> = {
      'numero':      'f.numero',
      'fecha_viaje': 'f.fecha_viaje',
      'apertura':    'f.created_at',
    }
    const sortCol = sortCols[sortBy] || 'f.fecha_viaje'
    const nullsDir = sortDir === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST'
    query += ` ORDER BY ${sortCol} ${sortDir} ${nullsDir} LIMIT 200`

    const result = await c.env.DB.prepare(query).bind(...params).all()

    const filterBar = `
      <form method="GET" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:flex-end;">
        <div>
          <label class="form-label">Buscar</label>
          <input type="text" name="buscar" value="${buscar}" placeholder="Nº file, cliente, destino..." class="form-control" style="width:220px;">
        </div>
        <div>
          <label class="form-label">Estado</label>
          <select name="estado" class="form-control" style="width:150px;">
            <option value="">Todos</option>
            ${[['en_proceso','En Proceso'],['seniado','Señado'],['cerrado','Cerrado'],['anulado','Anulado']].map(([v,l]) => `<option value="${v}" ${estado===v?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        ${isGerente ? `
        <div>
          <label class="form-label">Vendedor</label>
          <select name="vendedor_id" class="form-control" style="width:170px;">
            <option value="">Todos</option>
            ${vendedoresList.results.map((v: any) => `<option value="${v.id}" ${vendedorId==v.id?'selected':''}>${esc(v.nombre)}</option>`).join('')}
          </select>
        </div>` : ''}
        <div>
          <label class="form-label">Salida desde</label>
          <input type="date" name="fecha_desde" value="${fechaDesde}" class="form-control" style="width:150px;">
        </div>
        <div>
          <label class="form-label">Salida hasta</label>
          <input type="date" name="fecha_hasta" value="${fechaHasta}" class="form-control" style="width:150px;">
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:18px;">
          <input type="checkbox" name="con_saldo" value="1" id="chk-con-saldo" ${conSaldo?'checked':''} style="width:15px;height:15px;accent-color:#dc2626;">
          <label for="chk-con-saldo" style="font-size:13px;font-weight:600;color:#dc2626;cursor:pointer;white-space:nowrap;">Con saldo pendiente</label>
        </div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-search"></i> Filtrar</button>
        <a href="/files" class="btn btn-outline">Limpiar</a>
        <a href="/files/nuevo" class="btn btn-orange" style="margin-left:auto;"><i class="fas fa-plus"></i> Nuevo File</a>
      </form>
    `

    const tableRows = result.results.map((f: any) => `
      <tr>
        <td><strong style="color:#7B3FA0;">#${esc(f.numero)}</strong></td>
        <td>${esc(f.cliente_nombre)}</td>
        <td style="font-size:12px;color:#6b7280;">${esc(f.vendedor_nombre)}</td>
        <td>${esc(f.destino_principal) || '—'}</td>
        <td>${esc(f.fecha_viaje) || '—'}</td>
        <td><span class="badge ${getBadge(f.estado)}">${getLabelEstado(f.estado)}</span></td>
        <td><strong style="color:#059669;">$${Number(f.total_venta||0).toLocaleString()}</strong></td>
        <td style="color:#6b7280;">$${Number(f.total_costo||0).toLocaleString()}</td>
        <td><strong style="color:#F7941D;">$${Number((f.total_venta||0)-(f.total_costo||0)).toLocaleString()}</strong></td>
        <td>${(() => { const saldo = Number(f.total_venta||0) - Number(f.total_cobrado||0); if (saldo <= 0.01) return '<span style="font-size:11px;color:#059669;font-weight:700;">✓</span>'; return '<strong style="color:#dc2626;">-$' + saldo.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</strong>' })()}</td>
        <td style="font-size:12px;color:#9ca3af;">${esc(f.fecha_apertura?.split('T')[0])||''}</td>
        <td>
          <a href="/files/${f.id}" class="btn btn-outline btn-sm"><i class="fas fa-eye"></i></a>
          <a href="/files/${f.id}/editar" class="btn btn-sm" style="background:#f3e8ff;color:#7B3FA0;"><i class="fas fa-edit"></i></a>
        </td>
      </tr>
    `).join('')

    const content = `
      ${filterBar}
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-folder-open" style="color:#F7941D"></i> Files de Viaje (${result.results.length})</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                ${(() => {
                  const cols: [string,string][] = [
                    ['numero',      'Nº File'],
                    ['',            'Cliente'],
                    ['',            'Vendedor'],
                    ['',            'Destino'],
                    ['fecha_viaje', 'Fecha Viaje'],
                    ['',            'Estado'],
                    ['',            'Venta'],
                    ['',            'Costo'],
                    ['',            'Utilidad'],
                    ['',            'Saldo'],
                    ['apertura',    'Apertura'],
                    ['',            'Acciones'],
                  ]
                  return cols.map(([col, label]) => {
                    if (!col) return '<th>' + label + '</th>'
                    const isActive = sortBy === col
                    const nextDir  = isActive && sortDir === 'ASC' ? 'desc' : 'asc'
                    const icon     = isActive ? (sortDir === 'ASC' ? '↑' : '↓') : '<span style="opacity:0.3">↕</span>'
                    const qs = new URLSearchParams(Object.assign(
                      {},
                      estado     ? {estado}                : {},
                      buscar     ? {buscar}                : {},
                      vendedorId ? {vendedor_id: vendedorId} : {},
                      fechaDesde ? {fecha_desde: fechaDesde} : {},
                      fechaHasta ? {fecha_hasta: fechaHasta} : {},
                      conSaldo   ? {con_saldo: conSaldo}    : {},
                      {sort: col, dir: nextDir}
                    )).toString()
                    return '<th style="cursor:pointer;user-select:none;white-space:nowrap;">' +
                      '<a href="/files?' + qs + '" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:4px;">' +
                      label + ' ' + icon +
                      '</a></th>'
                  }).join('')
                })()}
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="11" style="text-align:center;padding:30px;color:#9ca3af;">No hay files. <a href="/files/nuevo" style="color:#7B3FA0;">Crear primero</a></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `
    return c.html(baseLayout('Files de Viaje', content, user, 'files'))
  } catch (e: any) {
    return c.html(baseLayout('Files', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'files'))
  }
})

// Formulario nuevo file
files.get('/files/nuevo', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  try {
    const [clientes, vendedores] = await Promise.all([
      c.env.DB.prepare(`SELECT id, IFNULL(tipo_cliente,'persona_fisica') as tipo_cliente, COALESCE(nombre || ' ' || apellido, nombre_completo) as nombre_completo FROM clientes ORDER BY apellido, nombre`).all(),
      c.env.DB.prepare('SELECT id, nombre FROM usuarios WHERE activo=1 ORDER BY nombre').all(),
    ])
    const errNuevoFile = c.req.query('error') || ''

    const content = `
      <div style="max-width:700px;">
        <div style="margin-bottom:20px;">
          <a href="/files" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver a Files</a>
        </div>
        ${errNuevoFile === 'fecha_viaje_pasada' ? `
          <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <i class="fas fa-calendar-times" style="font-size:18px;"></i>
            <div><strong>Fecha inválida</strong> — La fecha de viaje no puede ser anterior a hoy.</div>
          </div>
        ` : ''}
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-plus-circle" style="color:#F7941D"></i> Nuevo File de Viaje</span>
          </div>
          <div class="card-body">
            <form method="POST" action="/files" onsubmit="return validarFechaViaje(document.getElementById('inp-fecha-viaje-nuevo'))">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">CLIENTE *</label>
                  <div style="display:flex;gap:6px;align-items:center;">
                    <select name="cliente_id" id="sel-cliente" required class="form-control" style="flex:1;">
                      <option value="">— Seleccionar cliente —</option>
                      ${clientes.results.map((c: any) => `<option value="${c.id}">${c.tipo_cliente === 'empresa' ? '🏢 ' : ''}${c.nombre_completo}</option>`).join('')}
                    </select>
                    <button type="button" onclick="toggleNuevoCliente()"
                      style="white-space:nowrap;padding:7px 12px;background:#7B3FA0;color:white;border:none;border-radius:8px;font-size:12px;cursor:pointer;height:38px;">
                      <i class="fas fa-plus"></i> Nuevo
                    </button>
                  </div>
                  <!-- Panel inline para crear nuevo cliente -->
                  <div id="panel-nuevo-cliente" style="display:none;margin-top:12px;background:#faf7ff;border:1.5px solid #c4b5fd;border-radius:10px;padding:14px;">
                    <div style="font-size:12px;font-weight:700;color:#5a2d75;margin-bottom:10px;">
                      <i class="fas fa-user-plus" style="color:#EC008C;"></i> DATOS DEL NUEVO CLIENTE
                    </div>

                    <!-- Toggle tipo cliente -->
                    <div style="display:flex;gap:0;border:1.5px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:10px;">
                      <label id="nc-lbl-pf" onclick="ncToggleTipo('persona_fisica')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;cursor:pointer;font-size:11px;font-weight:700;background:linear-gradient(135deg,#7B3FA0,#EC008C);color:white;transition:all .2s;">
                        <i class="fas fa-user"></i> Persona Física
                      </label>
                      <label id="nc-lbl-emp" onclick="ncToggleTipo('empresa')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;cursor:pointer;font-size:11px;font-weight:700;background:#f9fafb;color:#6b7280;border-left:1.5px solid #e5e7eb;transition:all .2s;">
                        <i class="fas fa-building"></i> Empresa
                      </label>
                    </div>

                    <!-- Persona Física -->
                    <div id="nc-sec-pf">
                      <div class="grid-2" style="margin-bottom:8px;">
                        <div class="form-group" style="margin-bottom:0;">
                          <label class="form-label" style="font-size:11px;">NOMBRE *</label>
                          <input type="text" id="nc-nombre" class="form-control" style="padding:6px 10px;" placeholder="Nombre">
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                          <label class="form-label" style="font-size:11px;">APELLIDO *</label>
                          <input type="text" id="nc-apellido" class="form-control" style="padding:6px 10px;" placeholder="Apellido">
                        </div>
                      </div>
                    </div>

                    <!-- Empresa -->
                    <div id="nc-sec-emp" style="display:none;">
                      <div class="grid-2" style="margin-bottom:8px;">
                        <div class="form-group" style="margin-bottom:0;">
                          <label class="form-label" style="font-size:11px;">NOMBRE COMERCIAL *</label>
                          <input type="text" id="nc-nombre-emp" class="form-control" style="padding:6px 10px;" placeholder="Ej: TechCorp S.A.">
                        </div>
                        <div class="form-group" style="margin-bottom:0;">
                          <label class="form-label" style="font-size:11px;">RAZÓN SOCIAL</label>
                          <input type="text" id="nc-razon-social" class="form-control" style="padding:6px 10px;" placeholder="Razón social completa">
                        </div>
                      </div>
                      <div class="form-group" style="margin-bottom:8px;">
                        <label class="form-label" style="font-size:11px;">PERSONA DE CONTACTO *</label>
                        <input type="text" id="nc-contacto" class="form-control" style="padding:6px 10px;" placeholder="Ej: Juan Pérez">
                      </div>
                    </div>

                    <!-- Comunes -->
                    <div class="grid-2" style="margin-bottom:8px;">
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">EMAIL</label>
                        <input type="email" id="nc-email" class="form-control" style="padding:6px 10px;" placeholder="email@ejemplo.com">
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">TELÉFONO</label>
                        <input type="text" id="nc-telefono" class="form-control" style="padding:6px 10px;" placeholder="+598 9X XXX XXX">
                      </div>
                    </div>
                    <div class="grid-2" style="margin-bottom:8px;">
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">TIPO DOC</label>
                        <select id="nc-tipo-doc" class="form-control" style="padding:6px 10px;">
                          <optgroup label="Persona Física" id="nc-opts-pf">
                            <option value="CI">C.I.</option>
                            <option value="DNI">DNI</option>
                            <option value="PAS">Pasaporte</option>
                          </optgroup>
                          <optgroup label="Empresa" id="nc-opts-emp">
                            <option value="RUT">RUT (Uruguay)</option>
                            <option value="NIF">NIF (España/UE)</option>
                          </optgroup>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">NRO DOCUMENTO</label>
                        <input type="text" id="nc-nro-doc" class="form-control" style="padding:6px 10px;" placeholder="Ej: 12345678">
                      </div>
                    </div>
                    <div id="nc-error" style="display:none;color:#dc2626;font-size:12px;margin-bottom:8px;"></div>
                    <div style="display:flex;gap:8px;">
                      <button type="button" onclick="crearClienteInline()"
                        style="padding:7px 16px;background:#EC008C;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
                        <i class="fas fa-save"></i> Guardar cliente
                      </button>
                      <button type="button" onclick="toggleNuevoCliente()"
                        style="padding:7px 12px;background:white;color:#6b7280;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;cursor:pointer;">
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label">VENDEDOR *</label>
                  <select name="vendedor_id" required class="form-control">
                    ${vendedores.results.map((v: any) => `<option value="${v.id}" ${v.id == user.id ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">DESTINO PRINCIPAL</label>
                  ${destinoAutocomplete({ name: 'destino_principal', id: 'dest-nuevo', placeholder: 'Ej: CUN — Cancún, MVD — Montevideo...' })}
                </div>
                <div class="form-group">
                  <label class="form-label">FECHA DE VIAJE</label>
                  <input type="date" name="fecha_viaje" id="inp-fecha-viaje-nuevo" class="form-control" oninput="validarFechaViaje(this)">
                  <div id="err-fecha-viaje-nuevo" style="display:none;font-size:11px;color:#dc2626;margin-top:3px;"><i class="fas fa-exclamation-circle"></i> La fecha de viaje no puede ser anterior a hoy.</div>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">ESTADO INICIAL</label>
                  <select name="estado" class="form-control">
                    <option value="en_proceso">En Proceso</option>
                    <option value="seniado">Señado (primer pago recibido)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA</label>
                  <select name="moneda" class="form-control">
                    <option value="USD">USD - Dólares</option>
                    <option value="UYU">UYU - Pesos Uruguayos</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">NOTAS / OBSERVACIONES</label>
                <textarea name="notas" rows="3" class="form-control" placeholder="Información adicional del file..."></textarea>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Crear File</button>
                <a href="/files" class="btn btn-outline">Cancelar</a>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
      // ── Restricción de fechas ──────────────────────────────────
      (function() {
        const hoyStr = new Date().toISOString().split('T')[0]
        // Fecha de viaje: no puede ser pasada
        const fv = document.getElementById('inp-fecha-viaje-nuevo')
        if (fv) fv.min = hoyStr
      })()

      function validarFechaViaje(input) {
        const hoyStr = new Date().toISOString().split('T')[0]
        const errEl  = document.getElementById('err-fecha-viaje-nuevo')
        if (input.value && input.value < hoyStr) {
          if (errEl) errEl.style.display = 'block'
          input.style.borderColor = '#dc2626'
          return false
        }
        if (errEl) errEl.style.display = 'none'
        input.style.borderColor = ''
        return true
      }

      let _ncTipo = 'persona_fisica';

      function ncToggleTipo(tipo) {
        _ncTipo = tipo;
        const esEmp = tipo === 'empresa';
        document.getElementById('nc-sec-pf').style.display  = esEmp ? 'none' : 'block';
        document.getElementById('nc-sec-emp').style.display = esEmp ? 'block' : 'none';
        const lblPf  = document.getElementById('nc-lbl-pf');
        const lblEmp = document.getElementById('nc-lbl-emp');
        lblPf.style.background  = esEmp ? '#f9fafb' : 'linear-gradient(135deg,#7B3FA0,#EC008C)';
        lblPf.style.color       = esEmp ? '#6b7280' : 'white';
        lblEmp.style.background = esEmp ? 'linear-gradient(135deg,#0369a1,#0ea5e9)' : '#f9fafb';
        lblEmp.style.color      = esEmp ? 'white' : '#6b7280';
        // Ajustar tipo doc por defecto
        document.getElementById('nc-tipo-doc').value = esEmp ? 'RUT' : 'CI';
      }

      function toggleNuevoCliente() {
        const panel = document.getElementById('panel-nuevo-cliente');
        const sel = document.getElementById('sel-cliente');
        const visible = panel.style.display !== 'none';
        panel.style.display = visible ? 'none' : 'block';
        if (!visible) {
          sel.required = false;
          sel.value = '';
        } else {
          sel.required = true;
        }
      }

      async function crearClienteInline() {
        const esEmp   = _ncTipo === 'empresa';
        const nombre  = esEmp
          ? document.getElementById('nc-nombre-emp').value.trim()
          : document.getElementById('nc-nombre').value.trim();
        const apellido = esEmp ? '' : document.getElementById('nc-apellido').value.trim();
        const razonSocial    = esEmp ? document.getElementById('nc-razon-social').value.trim() : '';
        const personaContacto = esEmp ? document.getElementById('nc-contacto').value.trim() : '';
        const email    = document.getElementById('nc-email').value.trim();
        const telefono = document.getElementById('nc-telefono').value.trim();
        const tipoDoc  = document.getElementById('nc-tipo-doc').value;
        const nroDoc   = document.getElementById('nc-nro-doc').value.trim();
        const errEl    = document.getElementById('nc-error');

        if (!nombre) {
          errEl.textContent = esEmp ? 'El nombre comercial es obligatorio.' : 'El nombre es obligatorio.';
          errEl.style.display = 'block'; return;
        }
        if (!esEmp && !apellido) {
          errEl.textContent = 'El apellido es obligatorio.';
          errEl.style.display = 'block'; return;
        }
        if (esEmp && !personaContacto) {
          errEl.textContent = 'La persona de contacto es obligatoria para empresas.';
          errEl.style.display = 'block'; return;
        }
        errEl.style.display = 'none';

        try {
          const res = await fetch('/api/clientes/rapido', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tipo_cliente: _ncTipo, nombre, apellido,
              razon_social: razonSocial, persona_contacto: personaContacto,
              email, telefono, tipo_documento: tipoDoc, nro_documento: nroDoc
            })
          });
          const data = await res.json();
          if (!data.id) throw new Error(data.error || 'Error al crear cliente');

          // Agregar al select y seleccionarlo
          const sel = document.getElementById('sel-cliente');
          const opt = document.createElement('option');
          opt.value = data.id;
          opt.textContent = esEmp ? nombre : (apellido + ' ' + nombre).trim();
          opt.selected = true;
          sel.appendChild(opt);
          sel.required = true;

          // Cerrar panel y feedback
          document.getElementById('panel-nuevo-cliente').style.display = 'none';
          sel.style.borderColor = '#16a34a';
          setTimeout(() => sel.style.borderColor = '', 2000);
        } catch(e) {
          errEl.textContent = e.message;
          errEl.style.display = 'block';
        }
      }
      </script>
    `
    return c.html(baseLayout('Nuevo File', content, user, 'files'))
  } catch (e: any) {
    return c.html(baseLayout('Nuevo File', `<div class="alert alert-danger">Error interno al crear el file</div>`, user, 'files'))
  }
})

// Crear file
files.post('/files', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const body = await c.req.parseBody()

  try {
    const numero = await generarNumeroFile(c.env.DB)

    // Validar fecha_viaje: no puede ser pasada
    const hoyStr = new Date().toISOString().split('T')[0]
    if (body.fecha_viaje && String(body.fecha_viaje) < hoyStr) {
      return c.redirect('/files/nuevo?error=fecha_viaje_pasada')
    }

    const vendedorDelFile = body.vendedor_id || user.id
    await c.env.DB.prepare(`
      INSERT INTO files (numero, cliente_id, vendedor_id, estado, destino_principal, fecha_viaje, moneda, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(numero, body.cliente_id, vendedorDelFile, body.estado || 'en_proceso',
      body.destino_principal || null, body.fecha_viaje || null, body.moneda || 'USD', body.notas || null).run()

    // Actualizar vendedor_id del cliente al vendedor del file (último file creado = vendedor titular)
    await c.env.DB.prepare(
      `UPDATE clientes SET vendedor_id = ? WHERE id = ?`
    ).bind(vendedorDelFile, body.cliente_id).run().catch(() => {})

    const newFile = await c.env.DB.prepare('SELECT id FROM files WHERE numero = ?').bind(numero).first() as any
    return c.redirect(`/files/${newFile.id}`)
  } catch (e: any) {
    return c.redirect('/files?error=1')
  }
})

// Ver file detalle
files.get('/files/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const errorParam = c.req.query('error') || ''
  const okParam    = c.req.query('ok')    || ''
  const errorMsg   = c.req.query('msg') ? decodeURIComponent(c.req.query('msg')!) : ''

  try {
    const file = await c.env.DB.prepare(`
      SELECT f.*, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre,
             c.nombre as cliente_nombre_solo, c.apellido as cliente_apellido,
             c.email as cliente_email, c.telefono as cliente_tel,
             c.vencimiento_pasaporte, c.tipo_documento, c.nro_documento,
             c.fecha_nacimiento as cliente_fecha_nac,
             c.tipo_cliente, c.razon_social, c.persona_contacto,
             u.nombre as vendedor_nombre
      FROM files f JOIN clientes c ON f.cliente_id = c.id JOIN usuarios u ON f.vendedor_id = u.id
      WHERE f.id = ?
    `).bind(id).first() as any

    if (!file) return c.redirect('/files')
    if (!canSeeAllFiles(user.rol) && file.vendedor_id != user.id) return c.redirect('/files')

    // ── Queries paralelas — todas independientes entre sí ─────
    const [
      serviciosRes,
      pasajerosFileRes,
      movimientosRes,
      devolucionesRes,
      tcDelFileRes,
      proveedoresRes,
      operadoresRes,
      bancosRes,
      alertasTcFileRes,
      compartidoRes,
      vendedoresCompartirRes,
      liquidacionesFileRes,
    ] = await Promise.all([
      c.env.DB.prepare(`
        SELECT s.*, p.nombre as proveedor_nombre, o.nombre as operador_nombre
        FROM servicios s 
        LEFT JOIN proveedores p ON s.proveedor_id = p.id 
        LEFT JOIN operadores o ON s.operador_id = o.id
        WHERE s.file_id = ? ORDER BY s.fecha_inicio ASC, s.id ASC
      `).bind(id).all(),

      c.env.DB.prepare(`
        SELECT fp.id as fp_id, fp.rol, fp.grupo, fp.orden,
               p.id, p.nombre_completo, p.tipo_documento, p.nro_documento,
               p.fecha_nacimiento, p.vencimiento_pasaporte, p.nacionalidad,
               p.email, p.telefono, p.preferencias_comida, p.millas_aerolineas
        FROM file_pasajeros fp
        JOIN pasajeros p ON fp.pasajero_id = p.id
        WHERE fp.file_id = ?
        ORDER BY fp.rol DESC, fp.orden ASC, p.nombre_completo ASC
      `).bind(id).all(),

      c.env.DB.prepare(`
        SELECT m.*, u.nombre as usuario_nombre,
               pax.nombre_completo as pagador_nombre
        FROM movimientos_caja m 
        LEFT JOIN usuarios u ON m.usuario_id = u.id
        LEFT JOIN pasajeros pax ON m.pasajero_pagador_id = pax.id
        WHERE m.file_id = ? AND m.anulado = 0 ORDER BY m.fecha DESC
      `).bind(id).all(),

      c.env.DB.prepare(`
        SELECT d.*, u1.nombre as solicitado_nombre, u2.nombre as aprobado_nombre
        FROM devoluciones d
        LEFT JOIN usuarios u1 ON u1.id = d.solicitado_por
        LEFT JOIN usuarios u2 ON u2.id = d.aprobado_por
        WHERE d.file_id = ?
        ORDER BY d.created_at DESC
      `).bind(id).all(),

      c.env.DB.prepare(`
        SELECT ct.*, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo, '—') as cliente_nombre,
               u.nombre as autorizado_nombre,
               (SELECT GROUP_CONCAT(DISTINCT p.nombre) FROM tarjeta_asignaciones ta
                JOIN proveedores p ON p.id = ta.proveedor_id
                WHERE ta.cliente_tarjeta_id = ct.id AND ta.estado NOT IN ('revertido','tc_negada')) as asig_proveedores
        FROM cliente_tarjetas ct
        LEFT JOIN clientes c ON c.id = ct.cliente_id
        LEFT JOIN usuarios u ON u.id = ct.autorizado_por_usuario
        WHERE ct.file_id = ?
        ORDER BY ct.created_at DESC
      `).bind(id).all(),

      getOrFetch('proveedores:activos', () =>
        c.env.DB.prepare('SELECT id, nombre FROM proveedores WHERE activo=1 ORDER BY nombre').all()
      ),
      getOrFetch('operadores:activos', () =>
        c.env.DB.prepare('SELECT id, nombre FROM operadores WHERE activo=1 ORDER BY nombre').all()
      ),
      getOrFetch('bancos:activos', () =>
        c.env.DB.prepare('SELECT id, nombre_entidad, moneda FROM bancos WHERE activo=1 ORDER BY nombre_entidad').all()
      ),

      c.env.DB.prepare(`
        SELECT atc.*, p.nombre as proveedor_nombre
        FROM alertas_tc atc
        LEFT JOIN proveedores p ON p.id = atc.proveedor_id
        WHERE atc.file_id = ? AND atc.estado IN ('pendiente','vista')
        ORDER BY atc.creado_at DESC
      `).bind(id).all().catch(() => ({ results: [] })),

      c.env.DB.prepare(`
        SELECT fc.*, u.nombre as vendedor_compartido_nombre, uc.nombre as compartido_por_nombre
        FROM file_compartido fc
        JOIN usuarios u  ON fc.vendedor_id    = u.id
        JOIN usuarios uc ON fc.compartido_por = uc.id
        WHERE fc.file_id = ?
      `).bind(id).first().catch(() => null),

      c.env.DB.prepare(`
        SELECT id, nombre FROM usuarios
        WHERE activo = 1
          AND rol IN ('vendedor','supervisor','administracion','gerente')
          AND id != ?
        ORDER BY nombre
      `).bind(file.vendedor_id).all(),

      c.env.DB.prepare(`
        SELECT lf.id, l.estado, l.periodo
        FROM liquidacion_files lf
        JOIN liquidaciones l ON l.id = lf.liquidacion_id
        WHERE lf.file_id = ? AND l.estado IN ('aprobada','pagada')
        LIMIT 1
      `).bind(id).first().catch(() => null),
    ])

    const servicios            = serviciosRes
    const pasajerosFile        = pasajerosFileRes
    const movimientos          = movimientosRes
    const devoluciones         = devolucionesRes
    const tcDelFile            = tcDelFileRes
    const proveedores          = proveedoresRes
    const operadores           = operadoresRes
    const bancos               = bancosRes
    const alertasTcFile        = alertasTcFileRes
    const compartidoRow        = compartidoRes as any
    const vendedoresParaCompartir = vendedoresCompartirRes
    const liquidacionesFile    = liquidacionesFileRes as any

    // Pasajeros por servicio — una sola query en vez de N queries
    const serviciosPasajeros: Record<number, number[]> = {}
    if (servicios.results.length > 0) {
      const svcIds = servicios.results
        .map((s: any) => Number(s.id))
        .filter((n: number) => Number.isInteger(n) && n > 0)
        .join(',')
      const spRows = await c.env.DB.prepare(
        `SELECT sp.servicio_id, sp.pasajero_id FROM servicio_pasajeros sp WHERE sp.servicio_id IN (${svcIds})`
      ).all()
      spRows.results.forEach((sp: any) => {
        if (!serviciosPasajeros[sp.servicio_id]) serviciosPasajeros[sp.servicio_id] = []
        serviciosPasajeros[sp.servicio_id].push(sp.pasajero_id)
      })
    }

    // ── Estado del file ────────────────────────────────────────
    const fileCerrado   = file.estado === 'cerrado'
    const fileAnulado   = file.estado === 'anulado'
    const fileBloqueado = fileCerrado || fileAnulado
    const fileLiquidado = !!liquidacionesFile

    // ── Permisos ───────────────────────────────────────────────
    const esDuenioFile         = user.id == file.vendedor_id
    const esVendedorCompartido = compartidoRow && compartidoRow.vendedor_id == user.id
    const puedeCompartir       = !fileAnulado && (user.id == file.vendedor_id || isSupervisorOrAbove(user.rol))
    const puedeQuitarCompartido = compartidoRow && isSupervisorOrAbove(user.rol)
    // Puede editar: dueño del file, supervisor, admin, gerente (NO el vendedor compartido)
    const puedeEditarFile = esDuenioFile || (canSeeAllFiles(user.rol) && !esVendedorCompartido) || isAdminOrAbove(user.rol)

    const hoy = new Date().toISOString().split('T')[0]

    const tiposServicio = ['aereo', 'hotel', 'traslado', 'tour', 'seguro', 'otro']
    const iconoServicio: Record<string, string> = {
      aereo: 'fa-plane', hotel: 'fa-bed', traslado: 'fa-car',
      tour: 'fa-map-marked-alt', seguro: 'fa-shield-alt', otro: 'fa-concierge-bell'
    }

    const pasaporteAlerta = file.vencimiento_pasaporte && file.vencimiento_pasaporte < hoy
      ? `<span style="color:#dc2626;font-size:11px;font-weight:700;"><i class="fas fa-exclamation-triangle"></i> VENCIDO</span>`
      : file.vencimiento_pasaporte
      ? `<span style="color:#059669;font-size:11px;">${file.vencimiento_pasaporte}</span>`
      : '—'

    // ── Helpers de pasajeros ──────────────────────────────────
    const paxList = pasajerosFile.results as any[]
    const titulares = paxList.filter((p: any) => p.rol === 'titular')
    const acompaniantes = paxList.filter((p: any) => p.rol === 'acompañante')
    const totalPax = paxList.length

    // Agrupar por familia/grupo para mostrar en la UI
    const grupos: Record<string, any[]> = {}
    paxList.forEach((p: any) => {
      const g = p.grupo || 'Sin grupo'
      if (!grupos[g]) grupos[g] = []
      grupos[g].push(p)
    })

    // HTML tarjetas de pasajeros
    const calcEdad = (fechaNac: string) => {
      if (!fechaNac) return null
      const diff = new Date().getTime() - new Date(fechaNac).getTime()
      return Math.floor(diff / (1000*60*60*24*365.25))
    }
    // Clasificación de pasajero por edad
    const tipoPax = (fechaNac: string): { codigo: string, color: string, bg: string } | null => {
      const edad = calcEdad(fechaNac)
      if (edad === null) return null
      if (edad >= 12) return { codigo: 'ADT', color: '#1e40af', bg: '#dbeafe' }   // Adulto 12+
      if (edad >= 2)  return { codigo: 'CHD', color: '#065f46', bg: '#d1fae5' }   // Child 2-11
      return                 { codigo: 'INF', color: '#92400e', bg: '#fef3c7' }   // Infante 0-1
    }
    const paxNc = (p: any) => {
      if (p.nombre && p.apellido) return `${p.nombre} ${p.apellido}`
      return p.nombre_completo || '—'
    }
    const paxCardHtml = (p: any) => {
      const nc     = paxNc(p)
      const edad   = calcEdad(p.fecha_nacimiento)
      const paxTipo = tipoPax(p.fecha_nacimiento)
      const pasVence = p.vencimiento_pasaporte && p.vencimiento_pasaporte < hoy
      return `
        <div style="background:${p.rol==='titular'?'#f3e8ff':'#f8f9fa'};border:1.5px solid ${p.rol==='titular'?'#c4b5fd':'#e5e7eb'};border-radius:10px;padding:12px 14px;position:relative;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${p.rol==='titular'?'#7B3FA0':'#6b7280'};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;">
              ${esc((p.nombre || p.nombre_completo || '?').charAt(0).toUpperCase())}
            </div>
            <div>
              <div style="font-weight:700;font-size:13px;color:#1a1a2e;">${esc(nc)}</div>
              <div style="display:flex;gap:6px;align-items:center;margin-top:2px;">
                ${p.rol==='titular'?`<span style="background:#7B3FA0;color:white;font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;letter-spacing:0.5px;">TITULAR</span>`:`<span style="background:#6b7280;color:white;font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;">PAX</span>`}
                ${paxTipo ? `<span style="background:${paxTipo.bg};color:${paxTipo.color};font-size:9px;font-weight:800;padding:1px 7px;border-radius:4px;letter-spacing:0.8px;">${paxTipo.codigo}</span>` : ''}
                ${p.grupo?`<span style="background:#dbeafe;color:#1e40af;font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;">${esc(p.grupo)}</span>`:''}
              </div>
            </div>
            ${!fileBloqueado?`
              <button onclick="eliminarPasajero(${p.fp_id})" style="position:absolute;top:8px;right:8px;background:none;border:none;color:#dc2626;cursor:pointer;font-size:12px;padding:2px 4px;" title="Quitar del file">
                <i class="fas fa-times"></i>
              </button>
            `:''}
          </div>
          <div style="font-size:11px;color:#6b7280;display:flex;flex-wrap:wrap;gap:8px;">
            ${p.tipo_documento&&p.nro_documento?`<span><i class="fas fa-id-card"></i> ${esc(p.tipo_documento)}: ${esc(p.nro_documento)}</span>`:''}
            ${edad!==null?`<span><i class="fas fa-birthday-cake"></i> ${edad} años</span>`:''}
            ${p.vencimiento_pasaporte?`<span style="color:${pasVence?'#dc2626':'#059669'};font-weight:600;"><i class="fas fa-passport"></i> Pas: ${esc(p.vencimiento_pasaporte)}${pasVence?' ⚠':''}</span>`:''}
            ${p.email?`<span><i class="fas fa-envelope"></i> ${esc(p.email)}</span>`:''}
            ${p.telefono?`<span><i class="fas fa-phone"></i> ${esc(p.telefono)}</span>`:''}
            ${p.preferencias_comida?`<span><i class="fas fa-utensils"></i> ${esc(p.preferencias_comida)}</span>`:''}
            ${p.millas_aerolineas?`<span><i class="fas fa-star"></i> ${esc(p.millas_aerolineas)}</span>`:''}
          </div>
        </div>
      `
    }

    // Render pasajeros agrupados por familia
    let pasajerosHtml = ''
    if (paxList.length === 0) {
      pasajerosHtml = `<div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px;"><i class="fas fa-users" style="font-size:28px;margin-bottom:8px;display:block;"></i>No hay pasajeros cargados aún.<br>Agregá los pasajeros del file.</div>`
    } else {
      const grupoKeys = Object.keys(grupos)
      if (grupoKeys.length === 1 && grupoKeys[0] === 'Sin grupo') {
        // Sin grupos, mostrar lista simple
        pasajerosHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">${paxList.map(paxCardHtml).join('')}</div>`
      } else {
        // Mostrar por grupos/familias
        pasajerosHtml = grupoKeys.map(g => `
          <div style="margin-bottom:12px;">
            <div style="font-size:10px;font-weight:700;color:#7B3FA0;letter-spacing:1px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
              <i class="fas fa-users"></i> ${esc(g)}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;">
              ${grupos[g].map(paxCardHtml).join('')}
            </div>
          </div>
        `).join('')
      }
    }

    const serviciosHtml = servicios.results.map((s: any) => {
      const servicioPagado = s.estado_pago_proveedor === 'pagado' || s.prepago_realizado === 1
      const paxEnServicio = serviciosPasajeros[s.id] || []
      const rowBg = servicioPagado ? '#f0fdf4'
        : (s.requiere_prepago && !s.prepago_realizado && s.fecha_limite_prepago && s.fecha_limite_prepago < hoy) ? '#fff5f5'
        : (s.requiere_prepago && !s.prepago_realizado) ? '#fffbeb'
        : 'white'
      // Acciones bloqueadas: si el servicio ya fue pagado al proveedor no se puede editar ni eliminar
      // Si el file está cerrado/anulado tampoco se pueden eliminar ni agregar
      // Si el usuario es el vendedor compartido (solo lectura) tampoco puede editar ni eliminar
      const puedeEliminar = !fileBloqueado && !servicioPagado && !esVendedorCompartido
      const puedeEditar   = !servicioPagado && !esVendedorCompartido
      return `
        <tr style="background:${rowBg};">
          <td><span class="badge badge-cotizacion" style="font-size:10px;"><i class="fas ${iconoServicio[s.tipo_servicio] || 'fa-cog'}"></i> ${esc(s.tipo_servicio)}</span></td>
          <td>
            <div style="font-weight:600;font-size:13px;">${esc(s.descripcion)}</div>
            <span style="font-size:11px;background:#f3e8ff;color:#7B3FA0;padding:2px 7px;border-radius:10px;font-weight:700;display:inline-block;margin-top:3px;">
              🎫 ${s.nro_ticket ? esc(s.nro_ticket) : '<em style="color:#dc2626;font-style:normal;">Sin código</em>'}
            </span>
            ${s.nro_factura_proveedor ? `
            <span style="font-size:11px;background:#d1fae5;color:#065f46;padding:2px 7px;border-radius:10px;font-weight:700;display:inline-block;margin-top:3px;">
              🧾 FAC: ${esc(s.nro_factura_proveedor)}${s.fecha_factura_proveedor ? ' · ' + s.fecha_factura_proveedor : ''}
            </span>` : ''}
          </td>
          <td style="font-size:12px;">${esc(s.proveedor_nombre) || '—'}</td>
          <td style="font-size:12px;">${esc(s.operador_nombre) || '—'}</td>
          <td style="font-size:12px;">${esc(s.destino_codigo) || '—'}</td>
          <td style="font-size:12px;">${esc(s.fecha_inicio) || '—'}</td>
          <td><strong style="color:#059669;">$${Number(s.precio_venta||0).toLocaleString()}</strong></td>
          <td style="color:#6b7280;font-size:12px;">$${Number(s.costo_original||0).toLocaleString()} ${s.moneda_origen}</td>
          <td>
            ${getBadgePago(s.estado_pago_proveedor || (servicioPagado ? 'pagado' : 'pendiente'))}
            ${s.requiere_prepago && !servicioPagado && s.fecha_limite_prepago ? `
              <div style="font-size:10px;color:${s.fecha_limite_prepago < hoy ? '#dc2626' : '#6b7280'};margin-top:3px;">
                ${s.fecha_limite_prepago < hoy ? '⚠ vence' : '⏰'} ${s.fecha_limite_prepago}
              </div>
            ` : ''}
          </td>
          <td style="max-width:160px;">
            ${paxEnServicio.length > 0
              ? paxEnServicio.map((pid: number) => {
                  const p = paxList.find((px: any) => px.id === pid)
                  const pName = p ? (p.nombre || (p.nombre_completo || '').split(' ')[0]) : ''
                  return p ? `<span style="display:inline-block;background:#ede9fe;color:#5b21b6;font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;margin:1px;">${esc(pName)}</span>` : ''
                }).join('')
              : (totalPax > 0
                  ? `<span style="font-size:10px;color:#dc2626;font-style:italic;">Sin asignar</span>`
                  : `<span style="font-size:10px;color:#9ca3af;">—</span>`)
            }
            ${totalPax > 0 && !fileBloqueado && !esVendedorCompartido ? `
              <button onclick="asignarPaxServicio(${s.id}, '${esc(s.descripcion)}')" 
                      style="display:block;margin-top:3px;background:none;border:1px dashed #c4b5fd;color:#7B3FA0;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;" title="Editar pasajeros de este servicio">
                <i class="fas fa-user-edit"></i>
              </button>
            ` : ''}
          </td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              ${puedeEditar
                ? `<button onclick="editarServicio(${JSON.stringify(s).replace(/"/g,'&quot;')})" class="btn btn-outline btn-sm" title="Editar"><i class="fas fa-edit"></i></button>`
                : `<span title="No editable: servicio pagado al proveedor" style="color:#9ca3af;font-size:18px;padding:4px 6px;"><i class="fas fa-lock"></i></span>`
              }
              ${puedeEliminar
                ? `<button onclick="eliminarServicio(${s.id}, ${id})" class="btn btn-danger btn-sm" title="Eliminar"><i class="fas fa-trash"></i></button>`
                : ''
              }
            </div>
          </td>
        </tr>
      `
    }).join('')

    const movimientosHtml = movimientos.results.map((m: any) => `
      <tr>
        <td style="font-size:12px;">${esc(m.fecha?.split('T')[0])||''}</td>
        <td><span class="badge ${m.tipo==='ingreso'?'badge-confirmado':'badge-anulado'}">${esc(m.tipo)}</span></td>
        <td>
          ${esc(m.concepto)}
          ${m.pagador_nombre ? `<div style="font-size:10px;color:#7B3FA0;margin-top:2px;"><i class="fas fa-user"></i> ${esc(m.pagador_nombre)}</div>` : ''}
        </td>
        <td style="font-size:12px;">${esc(m.metodo)}</td>
        <td><strong ${m.tipo==='ingreso'?'style="color:#059669"':'style="color:#dc2626"'}>
          ${m.tipo==='ingreso'?'+':'-'}$${Number(m.monto).toLocaleString()} ${esc(m.moneda)}
        </strong></td>
        <td style="font-size:11px;color:#9ca3af;">${esc(m.usuario_nombre)||''}</td>
        <td>
          ${m.tipo === 'ingreso'
            ? `<a href="/tesoreria/recibo/${m.id}" target="_blank"
                 title="Ver recibo de pago"
                 style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#5a2d75;background:#f3e8ff;border:1px solid #e9d5ff;padding:3px 8px;border-radius:6px;text-decoration:none;">
                <i class="fas fa-receipt" style="font-size:10px;"></i> Recibo
               </a>`
            : ''}
        </td>
      </tr>
    `).join('')

    const totalVentaServicios = servicios.results.reduce((s: number, sv: any) => s + Number(sv.precio_venta || 0), 0)
    const totalCostoServicios = servicios.results.reduce((s: number, sv: any) => s + Number(sv.costo_original || 0), 0)
    const totalCobrado    = movimientos.results.filter((m: any) => m.tipo === 'ingreso').reduce((s: number, m: any) => s + Number(m.monto || 0), 0)
    const totalDevuelto   = (devoluciones.results as any[]).filter((d: any) => d.estado === 'aprobada').reduce((s: number, d: any) => s + Number(d.monto || 0), 0)
    const totalDevPendiente = (devoluciones.results as any[]).filter((d: any) => d.estado === 'pendiente').reduce((s: number, d: any) => s + Number(d.monto || 0), 0)
    const cobradoNeto     = totalCobrado - totalDevuelto
    const saldoPendiente  = totalVentaServicios - cobradoNeto

    const content = `
      <div style="margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <a href="/files" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver a Files</a>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="/files/${id}/voucher" class="btn btn-orange" target="_blank"><i class="fas fa-file-pdf"></i> Generar Voucher</a>
          ${isAdminOrAbove(user.rol) ? `<a href="/files/${id}/liquidacion-interna" class="btn btn-sm" target="_blank" style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;border:none;"><i class="fas fa-file-invoice-dollar"></i> Liq. Interna</a>` : ''}
          ${(puedeEditarFile && !fileBloqueado) ? `<a href="/files/${id}/editar" class="btn btn-outline"><i class="fas fa-edit"></i> Editar File</a>` : ''}
          ${puedeCompartir ? `
            <button onclick="abrirModalCompartir()" class="btn btn-outline" style="border-color:#0ea5e9;color:#0ea5e9;">
              <i class="fas fa-share-alt"></i> ${compartidoRow ? 'Ver compartido' : 'Compartir File'}
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Banner alertas TC negadas -->
      ${(alertasTcFile.results as any[]).length > 0 ? `
        <div style="background:#fff5f5;border:2px solid #fca5a5;border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;gap:14px;align-items:flex-start;">
          <div style="font-size:24px;color:#dc2626;flex-shrink:0;"><i class="fas fa-exclamation-triangle"></i></div>
          <div style="flex:1;">
            <div style="font-weight:800;color:#dc2626;font-size:14px;margin-bottom:6px;">⚠ Tarjeta(s) de Crédito Rechazada(s)</div>
            ${(alertasTcFile.results as any[]).map((a: any) => `
              <div style="background:white;border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;margin-bottom:6px;font-size:12px;">
                <span style="font-weight:700;color:#dc2626;">TC Negada</span> ·
                Proveedor: <strong>${esc(a.proveedor_nombre||'—')}</strong> ·
                ${esc(a.moneda||'USD')} $${Number(a.monto||0).toFixed(2)}
                <span style="color:#6b7280;"> — Se requiere cargar una nueva forma de pago</span>
              </div>
            `).join('')}
            <div style="font-size:11px;color:#6b7280;margin-top:4px;">Por favor cargá una nueva forma de pago para los servicios afectados.</div>
          </div>
        </div>
      ` : ''}

      <!-- Banners de bloqueo -->
      ${fileCerrado ? `
        <div class="alert alert-success" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-lock" style="font-size:18px;"></i>
          <div>
            <strong>File CERRADO</strong> — El cliente completó el pago. No se pueden agregar ni eliminar servicios.
            Los servicios ya pagados al proveedor tampoco se pueden modificar.
          </div>
        </div>
      ` : ''}
      ${fileAnulado ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-ban" style="font-size:18px;"></i>
          <div><strong>File ANULADO</strong> — Este file ha sido anulado. Solo lectura.</div>
        </div>
      ` : ''}
      ${errorParam === 'utilidad_negativa' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-exclamation-triangle" style="font-size:18px;"></i>
          <div><strong>No se puede cerrar el file</strong> — La utilidad es negativa (costo supera la venta). Solo un supervisor, administrador o gerente puede autorizar el cierre.</div>
        </div>
      ` : ''}
      ${errorParam === 'sin_cotizacion' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-exchange-alt" style="font-size:18px;"></i>
          <div>
            <strong>No hay tipo de cambio cargado para hoy</strong> — 
            Para registrar una transacción en pesos (UYU) es necesario que el tipo de cambio USD/UYU del día esté cargado en el sistema.
            Pedile al gerente o administrador que actualice la cotización en 
            <a href="/bancos/cotizaciones" style="color:#dc2626;font-weight:700;">Cotizaciones</a> antes de continuar.
          </div>
        </div>
      ` : ''}
      ${errorParam === 'sin_permiso' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-lock" style="font-size:18px;"></i>
          <div><strong>Acción no permitida</strong> — No tenés permisos para realizar esta operación. Contactá al gerente o administrador.</div>
        </div>
      ` : ''}
      ${errorParam === 'servicios_activos' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-exclamation-triangle" style="font-size:18px;"></i>
          <div><strong>No se puede anular el file</strong> — Primero debés cancelar todos los servicios activos desde la sección "Servicios del File".</div>
        </div>
      ` : ''}
      ${errorParam === 'servicios_pagados_desimputar' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-ban" style="font-size:18px;"></i>
          <div><strong>No se puede anular</strong> — Este file tiene servicios con pagos registrados. Primero debés desimputar los pagos desde <a href="/tesoreria/desimputar" style="color:#dc2626;font-weight:700;">Tesorería → Desimputar Pagos</a>.</div>
        </div>
      ` : ''}
      ${errorParam === 'fechas_inconsistentes' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-calendar-times" style="font-size:18px;"></i>
          <div><strong>Fechas inválidas</strong> — La fecha de fin no puede ser anterior a la fecha de inicio.</div>
        </div>
      ` : ''}
      ${errorParam === 'fecha_nacimiento_invalida' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-calendar-times" style="font-size:18px;"></i>
          <div><strong>Fecha de nacimiento inválida</strong> — No puede ser una fecha futura.</div>
        </div>
      ` : ''}
      ${errorParam === 'error_interno' ? `
        <div class="alert alert-danger" style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <i class="fas fa-exclamation-triangle" style="font-size:18px;"></i>
          <div><strong>Error al guardar servicio</strong>${errorMsg ? ': <code style="font-size:11px;">' + errorMsg + '</code>' : ''}</div>
        </div>
      ` : ''}
      
      <!-- Header del File -->
      <div class="card" style="margin-bottom:20px;">
        <div style="padding:20px;background:linear-gradient(135deg,#5a2d75,#7B3FA0);border-radius:12px 12px 0 0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;letter-spacing:1px;">FILE DE VIAJE</div>
              <div style="color:white;font-size:28px;font-weight:800;">#${file.numero}</div>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;">
                <span class="badge badge-${file.estado}">${getLabelEstado(file.estado).toUpperCase()}</span>
                ${compartidoRow ? `
                  <span style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:white;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;letter-spacing:0.5px;">
                    <i class="fas fa-share-alt"></i> COMPARTIDO · ${esc(compartidoRow.vendedor_compartido_nombre)} 50/50
                  </span>
                ` : ''}
              </div>
              <!-- Botones cambio de estado -->
              ${(!fileAnulado && !esVendedorCompartido) ? `
                <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
                  ${file.estado === 'en_proceso' ? `
                    <form method="POST" action="/files/${id}/estado" style="display:inline;">
                      <input type="hidden" name="estado" value="seniado">
                      <button type="submit" class="btn btn-sm" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;" title="Primer pago del cliente recibido">
                        <i class="fas fa-dollar-sign"></i> Marcar como Señado
                      </button>
                    </form>
                  ` : ''}
                  ${file.estado === 'seniado' ? `
                    <form method="POST" action="/files/${id}/estado" style="display:inline;">
                      <input type="hidden" name="estado" value="cerrado">
                      <button type="submit" class="btn btn-sm" style="background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;" 
                              title="El cliente completó el pago — bloqueará agregar/eliminar servicios"
                              onclick="return confirm('¿Cerrar el file? No se podrán agregar ni eliminar servicios.')">
                        <i class="fas fa-lock"></i> Cerrar File (pago completo)
                      </button>
                    </form>
                    <form method="POST" action="/files/${id}/estado" style="display:inline;">
                      <input type="hidden" name="estado" value="en_proceso">
                      <button type="submit" class="btn btn-sm" style="background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.8);border:1px solid rgba(255,255,255,0.2);">
                        <i class="fas fa-undo"></i> Volver a En Proceso
                      </button>
                    </form>
                  ` : ''}
                  ${(canAnularFile(user.rol) && !fileAnulado) ? `
                    <form method="POST" action="/files/${id}/estado" style="display:inline;">
                      <input type="hidden" name="estado" value="anulado">
                      <button type="submit" class="btn btn-sm" style="background:rgba(220,38,38,0.2);color:#fecaca;border:1px solid rgba(220,38,38,0.3);"
                              onclick="return confirm('¿Anular este file? Esta acción solo la puede revertir un gerente o administrador.')">
                        <i class="fas fa-ban"></i> Anular
                      </button>
                    </form>
                  ` : ''}
                  ${(fileCerrado && canReopenFile(user.rol)) ? `
                    <form method="POST" action="/files/${id}/estado" style="display:inline;">
                      <input type="hidden" name="estado" value="en_proceso">
                      <button type="submit" class="btn btn-sm" style="background:rgba(59,130,246,0.3);color:#bfdbfe;border:1px solid rgba(59,130,246,0.4);"
                              onclick="return confirm('¿Reabrir el file? Volverá a estado En Proceso y se podrán agregar servicios.')">
                        <i class="fas fa-lock-open"></i> Reabrir File
                      </button>
                    </form>
                  ` : ''}
                </div>
              ` : ''}
            </div>
            <div style="text-align:right;">
              <div style="color:rgba(255,255,255,0.7);font-size:11px;">VENTA TOTAL</div>
              <div style="color:#F7941D;font-size:24px;font-weight:800;">$${Number(file.total_venta||0).toLocaleString()} ${file.moneda}</div>
              <div style="color:rgba(255,255,255,0.6);font-size:12px;">Costo: $${Number(file.total_costo||0).toLocaleString()} · Utilidad: $${Number((file.total_venta||0)-(file.total_costo||0)).toLocaleString()}</div>
            </div>
          </div>
        </div>
        <div class="card-body">
          <div class="grid-3">
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">CLIENTE</div>
              <div style="font-weight:700;color:#1a1a2e;">
                <button onclick="abrirModalCliente()" style="background:none;border:none;padding:0;font-weight:700;color:#7B3FA0;cursor:pointer;font-size:inherit;text-decoration:underline dotted;text-underline-offset:3px;" title="Editar datos del cliente">
                  ${esc(file.cliente_nombre)} <i class="fas fa-edit" style="font-size:10px;opacity:0.6;"></i>
                </button>
              </div>
              <div style="font-size:12px;color:#6b7280;">${esc(file.cliente_email)||''}</div>
              <div style="font-size:12px;color:#6b7280;">${esc(file.cliente_tel)||''}</div>
              <div style="font-size:12px;margin-top:4px;">
                <i class="fas fa-passport" style="color:#7B3FA0"></i> ${esc(file.tipo_documento)}: ${esc(file.nro_documento)||'—'} · ${pasaporteAlerta}
              </div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">VENDEDOR</div>
              <div style="font-weight:700;color:#1a1a2e;">${esc(file.vendedor_nombre)}</div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin:10px 0 6px;">DESTINO</div>
              <div style="font-weight:700;color:#7B3FA0;">${esc(file.destino_principal) || '—'}</div>
            </div>
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">ESTADO COBRO</div>
              <div style="font-size:15px;font-weight:700;color:#059669;">Cobrado: $${Number(totalCobrado).toLocaleString()}</div>
              ${totalDevuelto > 0 ? `<div style="font-size:13px;font-weight:600;color:#dc2626;">Devuelto: -$${Number(totalDevuelto).toLocaleString()}</div>` : ''}
              ${totalDevPendiente > 0 ? `<div style="font-size:12px;color:#d97706;font-weight:600;"><i class="fas fa-clock"></i> Dev. pendiente aprobación: $${Number(totalDevPendiente).toLocaleString()}</div>` : ''}
              <div style="font-size:13px;color:${saldoPendiente > 0 ? '#dc2626' : '#059669'};font-weight:600;">
                Pendiente: $${Number(saldoPendiente).toLocaleString()}
              </div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin:10px 0 4px;">FECHA VIAJE</div>
              <div style="font-weight:700;">${file.fecha_viaje || '—'}</div>
            </div>
          </div>
          ${file.notas ? `<div style="margin-top:16px;padding:12px;background:#f8f3ff;border-radius:8px;font-size:13px;color:#5a2d75;"><i class="fas fa-sticky-note"></i> ${esc(file.notas)}</div>` : ''}
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════
           PASAJEROS DEL FILE
      ══════════════════════════════════════════════════════════ -->
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-users" style="color:#7B3FA0"></i> Pasajeros
            ${totalPax > 0 ? `<span style="background:#7B3FA0;color:white;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;">${totalPax}</span>` : ''}
          </span>
          <div style="display:flex;gap:8px;align-items:center;">
            ${totalPax > 0 ? `<span style="font-size:12px;color:#6b7280;">${titulares.length} titular(es) · ${acompaniantes.length} acompañante(s)</span>` : ''}
            ${!fileBloqueado ? `
              <button onclick="document.getElementById('modal-pasajero').classList.add('active')" class="btn btn-sm" style="background:#f3e8ff;color:#7B3FA0;border:1px solid #c4b5fd;">
                <i class="fas fa-user-plus"></i> Agregar Pasajero
              </button>
            ` : ''}
          </div>
        </div>
        <div style="padding:16px;">
          ${pasajerosHtml}
        </div>
      </div>

      <!-- Servicios -->
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-concierge-bell" style="color:#F7941D"></i> Servicios del File</span>
          ${fileBloqueado && file.estado === 'anulado'
            ? `<span style="font-size:12px;color:#9ca3af;display:flex;align-items:center;gap:4px;">
                <i class="fas fa-lock"></i> File anulado
               </span>`
            : fileBloqueado && fileCerrado
            ? `<div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:12px;color:#9ca3af;display:flex;align-items:center;gap:4px;">
                  <i class="fas fa-lock"></i> File cerrado
                </span>
                ${isAdminOrAbove(user.rol) && servicios.results.length > 0 ? `
                  <button onclick="abrirAjustarVenta()" class="btn btn-sm"
                    style="background:linear-gradient(135deg,#0369a1,#0ea5e9);color:white;border:none;">
                    <i class="fas fa-sliders-h"></i> Ajustar Venta
                  </button>` : ''}
               </div>`
            : esVendedorCompartido
            ? `<span style="font-size:12px;color:#6366f1;display:flex;align-items:center;gap:4px;">
                <i class="fas fa-share-alt"></i> Compartido — solo lectura
               </span>`
            : `<div style="display:flex;gap:8px;align-items:center;">
                ${servicios.results.length > 0 ? `
                  <button onclick="abrirAjustarVenta()" class="btn btn-sm"
                    style="background:linear-gradient(135deg,#0369a1,#0ea5e9);color:white;border:none;">
                    <i class="fas fa-sliders-h"></i> Ajustar Venta
                  </button>` : ''}
                ${puedeEditarFile && !fileBloqueado ? `
                <button onclick="document.getElementById('modal-servicio').classList.add('active')" class="btn btn-primary btn-sm">
                  <i class="fas fa-plus"></i> Agregar Servicio
                </button>` : ''}
               </div>`
          }
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Tipo</th><th>Descripción / Ticket</th><th>Proveedor</th><th>Operador</th>
                <th>Destino</th><th>Fecha</th><th>Venta</th><th>Costo</th>
                <th>Pago Proveedor</th><th>Pasajeros</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody id="servicios-tbody">
              ${serviciosHtml || `<tr><td colspan="11" style="text-align:center;padding:20px;color:#9ca3af;">Sin servicios aún</td></tr>`}
            </tbody>
          </table>
        </div>
        ${servicios.results.length > 0 ? `
          <div style="padding:12px 20px;border-top:1px solid #ede5f5;display:flex;gap:20px;font-size:13px;">
            <span>Venta total: <strong style="color:#059669;">$${totalVentaServicios.toLocaleString()}</strong></span>
            <span>Costo total: <strong>$${totalCostoServicios.toLocaleString()}</strong></span>
            <span>Utilidad: <strong style="color:#F7941D;">$${(totalVentaServicios-totalCostoServicios).toLocaleString()}</strong></span>
          </div>
        ` : ''}
      </div>

      <!-- Tarjetas de crédito del file -->
      ${(tcDelFile.results as any[]).length > 0 ? (() => {
        const rowsTC = (tcDelFile.results as any[]).map((t: any) => {
          const estadoColor = t.estado === 'pendiente' ? '#d97706' : t.estado === 'autorizada' ? '#059669' : '#dc2626'
          const estadoBg    = t.estado === 'pendiente' ? '#fef3c7' : t.estado === 'autorizada' ? '#d1fae5'  : '#fee2e2'
          const estadoLabel = t.estado === 'pendiente' ? '⏳ Pendiente autorización' : t.estado === 'autorizada' ? '✓ Autorizada' : '✗ Rechazada'
          return `
            <tr style="border-bottom:1px solid #f3f4f6;${t.estado==='pendiente'?'background:#fffbeb;':''}">
              <td style="padding:7px 10px;font-size:12px;color:#6b7280;">${(t.fecha_cargo||t.created_at||'').substring(0,10)}</td>
              <td style="padding:7px 10px;font-size:13px;font-weight:700;">
                <i class="fas fa-credit-card" style="color:#EC008C;font-size:11px;"></i> **** ${esc(t.ultimos_4)}
                ${t.tipo_tarjeta ? `<span style="font-size:10px;font-weight:700;color:#7B3FA0;margin-left:4px;">${esc(t.tipo_tarjeta)}</span>` : ''}
                ${t.banco_emisor ? `<span style="font-size:11px;color:#9ca3af;margin-left:4px;">${esc(t.banco_emisor)}</span>` : ''}
              </td>
              <td style="padding:7px 10px;font-size:13px;font-weight:800;color:${estadoColor};">
                $${Number(t.monto).toLocaleString('es-UY',{minimumFractionDigits:2})} <span style="font-size:11px;font-weight:400;color:#6b7280;">${t.moneda||'USD'}</span>
              </td>
              <td style="padding:7px 10px;font-size:12px;">${esc(t.cliente_nombre)}</td>
              <td style="padding:7px 10px;">
                <span style="font-size:11px;font-weight:700;color:${estadoColor};background:${estadoBg};padding:2px 8px;border-radius:8px;">${estadoLabel}</span>
                ${t.asig_proveedores ? `<div style="font-size:10px;color:#d97706;margin-top:2px;font-weight:600;"><i class="fas fa-paper-plane"></i> Enviada a: ${esc(t.asig_proveedores)}</div>` : ''}
                ${t.estado !== 'pendiente' && t.autorizado_nombre ? `<div style="font-size:10px;color:#9ca3af;">por ${esc(t.autorizado_nombre)}</div>` : ''}
              </td>
            </tr>
          `
        }).join('')
        const nPend = (tcDelFile.results as any[]).filter((t:any)=>t.estado==='pendiente').length
        return `
          <div class="card" style="margin-bottom:20px;border:2px solid ${nPend>0?'#fde68a':'#e5e7eb'};">
            <div class="card-header" style="${nPend>0?'background:#fffbeb;':''}">
              <span class="card-title">
                <i class="fas fa-credit-card" style="color:#d97706;"></i> Tarjetas de Crédito Ingresadas
                ${nPend > 0 ? `<span style="background:#f59e0b;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:6px;">${nPend} pendiente(s)</span>` : ''}
              </span>
              ${isAdminOrAbove(user.rol) ? `<a href="/tesoreria/tarjetas?file_id=${id}" style="font-size:11px;color:#7B3FA0;font-weight:700;text-decoration:none;background:#f3e8ff;padding:3px 8px;border-radius:6px;">
                <i class="fas fa-external-link-alt"></i> Gestionar en Cartera
              </a>` : ''}
            </div>
            ${nPend > 0 ? `<div style="background:#fef3c7;padding:8px 14px;font-size:12px;color:#92400e;font-weight:600;border-bottom:1px solid #fde68a;">
              <i class="fas fa-info-circle"></i> Las tarjetas pendientes deben ser autorizadas antes de emitir recibos de pago.
            </div>` : ''}
            <div class="table-wrapper">
              <table>
                <thead><tr><th>Fecha</th><th>Tarjeta</th><th>Monto</th><th>Cliente</th><th>Estado</th></tr></thead>
                <tbody>${rowsTC}</tbody>
              </table>
            </div>
          </div>
        `
      })() : ''}

      <!-- Devoluciones al cliente -->
      ${(devoluciones.results as any[]).length > 0 || isAdminOrAbove(user.rol) ? `
      <div class="card" style="margin-bottom:20px;border:2px solid #fecaca;">
        <div class="card-header" style="background:#fef2f2;display:flex;justify-content:space-between;align-items:center;">
          <span class="card-title"><i class="fas fa-undo-alt" style="color:#dc2626"></i> Devoluciones al Cliente</span>
          ${isAdminOrAbove(user.rol) && !fileAnulado ? `
          <button onclick="document.getElementById('modal-devolucion').style.display='flex'"
            class="btn btn-sm" style="background:#dc2626;color:white;border:none;">
            <i class="fas fa-plus"></i> Nueva Devolución
          </button>` : ''}
        </div>
        ${(devoluciones.results as any[]).length === 0 ? `
        <div style="padding:16px;color:#9ca3af;font-size:13px;">Sin devoluciones registradas.</div>
        ` : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#fef2f2;font-size:11px;color:#6b7280;text-transform:uppercase;">
              <th style="padding:8px 12px;text-align:left;">Fecha</th>
              <th style="padding:8px 12px;text-align:left;">Monto</th>
              <th style="padding:8px 12px;text-align:left;">Método</th>
              <th style="padding:8px 12px;text-align:left;">Motivo</th>
              <th style="padding:8px 12px;text-align:left;">Solicitado por</th>
              <th style="padding:8px 12px;text-align:left;">Estado</th>
              ${isGerente(user.rol) ? '<th style="padding:8px 12px;text-align:left;">Acción</th>' : ''}
            </tr></thead>
            <tbody>
              ${(devoluciones.results as any[]).map((d: any) => {
                const estadoColor = d.estado === 'aprobada' ? '#059669' : d.estado === 'rechazada' ? '#6b7280' : '#d97706'
                const estadoLabel = d.estado === 'aprobada' ? '✓ Aprobada' : d.estado === 'rechazada' ? '✗ Rechazada' : '⏳ Pendiente'
                return '<tr style="border-bottom:1px solid #fee2e2;">' +
                  '<td style="padding:8px 12px;color:#6b7280;">' + (d.created_at||'').substring(0,10) + '</td>' +
                  '<td style="padding:8px 12px;font-weight:700;color:#dc2626;">-$' + Number(d.monto).toLocaleString('es-UY',{minimumFractionDigits:2}) + ' ' + (d.moneda||'USD') + '</td>' +
                  '<td style="padding:8px 12px;">' + esc(d.metodo||'') + '</td>' +
                  '<td style="padding:8px 12px;font-size:12px;max-width:200px;">' + esc(d.motivo||'—') + '</td>' +
                  '<td style="padding:8px 12px;font-size:12px;">' + esc(d.solicitado_nombre||'—') + '</td>' +
                  '<td style="padding:8px 12px;"><span style="font-weight:700;color:' + estadoColor + ';">' + estadoLabel + '</span>' +
                    (d.aprobado_nombre ? '<br><span style="font-size:10px;color:#9ca3af;">por ' + esc(d.aprobado_nombre) + '</span>' : '') + '</td>' +
                  (isGerente(user.rol) && d.estado === 'pendiente' ?
                    '<td style="padding:8px 12px;">' +
                      '<form method="POST" action="/files/${id}/devoluciones/' + d.id + '/aprobar" style="display:inline;" onsubmit="return confirm(\'¿Aprobar esta devolución de $' + Number(d.monto).toLocaleString() + '?\')">' +
                        '<button type="submit" style="padding:3px 8px;background:#059669;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;margin-right:4px;"><i class="fas fa-check"></i> Aprobar</button>' +
                      '</form>' +
                      '<form method="POST" action="/files/${id}/devoluciones/' + d.id + '/rechazar" style="display:inline;" onsubmit="return confirm(\'¿Rechazar esta devolución?\')">' +
                        '<button type="submit" style="padding:3px 8px;background:#6b7280;color:white;border:none;border-radius:5px;font-size:11px;cursor:pointer;"><i class="fas fa-times"></i> Rechazar</button>' +
                      '</form>' +
                    '</td>'
                    : (isGerente(user.rol) ? '<td></td>' : '')
                  ) +
                  '</tr>'
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
      ` : ''}

      <!-- Movimientos de caja -->
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-dollar-sign" style="color:#059669"></i> Movimientos de Caja</span>
          ${isAdminOrAbove(user.rol) ? `
          <button onclick="document.getElementById('modal-movimiento').classList.add('active')" class="btn btn-sm" style="background:#d1fae5;color:#059669;">
            <i class="fas fa-plus"></i> Registrar Movimiento
          </button>` : ''}
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Método</th><th>Monto</th><th>Operador</th><th></th></tr></thead>
            <tbody>
              ${movimientosHtml || `<tr><td colspan="6" style="text-align:center;padding:20px;color:#9ca3af;">Sin movimientos</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal Nuevo/Editar Servicio -->
      <div class="modal-overlay" id="modal-servicio">
        <div class="modal" style="max-width:760px;max-height:90vh;overflow-y:auto;">
          <div class="modal-header">
            <span class="modal-title" id="modal-servicio-titulo"><i class="fas fa-plus-circle" style="color:#F7941D"></i> Agregar Servicio</span>
            <button type="button" class="modal-close" onclick="cerrarModalServicio()">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/files/${id}/servicios" id="form-servicio" onsubmit="return validarFechasSvc()">
              <input type="hidden" name="_servicio_id" id="hidden-servicio-edit-id" value="">

              <!-- Tipo + Ticket -->
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">TIPO DE SERVICIO *</label>
                  <select name="tipo_servicio" required class="form-control">
                    ${tiposServicio.map(t => `<option value="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">CÓDIGO DE RESERVA / Nº TICKET <span style="color:#dc2626;">*</span></label>
                  <input type="text" name="nro_ticket" required class="form-control" placeholder="Ej: ABC123, RES-2026-001">
                </div>
              </div>

              <!-- Descripción -->
              <div class="form-group">
                <label class="form-label">DESCRIPCIÓN *</label>
                <input type="text" name="descripcion" required class="form-control" placeholder="Ej: Vuelo MVD-GRU LATAM 15/04">
              </div>

              <!-- Proveedor + Operador -->
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">PROVEEDOR (a quien pagamos)</label>
                  <select name="proveedor_id" class="form-control">
                    <option value="">— Ninguno —</option>
                    ${proveedores.results.map((p: any) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">OPERADOR (quien ejecuta)</label>
                  <select name="operador_id" class="form-control">
                    <option value="">— Ninguno —</option>
                    ${operadores.results.map((o: any) => `<option value="${o.id}">${esc(o.nombre)}</option>`).join('')}
                  </select>
                </div>
              </div>

              <!-- Destino + Fechas -->
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">DESTINO (código IATA)</label>
                  ${destinoAutocomplete({ name: 'destino_codigo', id: 'dest-servicio', placeholder: 'Ej: CUN, MVD, MAD...' })}
                </div>
                <div class="form-group">
                  <label class="form-label">FECHA INICIO</label>
                  <input type="date" name="fecha_inicio" id="svc-fecha-inicio" class="form-control" oninput="validarFechasSvc()">
                  <div id="err-fecha-svc" style="display:none;font-size:11px;color:#dc2626;margin-top:3px;"><i class="fas fa-exclamation-circle"></i> Las fechas de servicio no pueden ser anteriores a hoy.</div>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">FECHA FIN</label>
                  <input type="date" name="fecha_fin" id="svc-fecha-fin" class="form-control" oninput="validarFechasSvc()">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA COSTO</label>
                  <select name="moneda_origen" class="form-control">
                    <option value="USD">USD</option><option value="UYU">UYU</option><option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <!-- Costo + Venta -->
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">COSTO (para nosotros) *</label>
                  <input type="number" name="costo_original" required min="0" step="0.01" class="form-control" placeholder="0.00">
                </div>
                <div class="form-group">
                  <label class="form-label">PRECIO VENTA (al cliente) *</label>
                  <input type="number" name="precio_venta" required min="0" step="0.01" class="form-control" placeholder="0.00">
                </div>
              </div>

              <!-- Factura Proveedor -->
              <div style="border:1.5px solid #d1fae5;border-radius:8px;padding:14px;margin-bottom:16px;background:#f0fdf4;">
                <div style="font-size:12px;font-weight:700;color:#065f46;margin-bottom:10px;letter-spacing:.04em;">
                  <i class="fas fa-file-invoice" style="color:#10b981;"></i> FACTURA DEL PROVEEDOR
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">NRO. FACTURA</label>
                    <input type="text" name="nro_factura_proveedor" class="form-control" placeholder="Ej: FAC-2026-0042">
                  </div>
                  <div class="form-group" style="margin-bottom:0;">
                    <label class="form-label">FECHA FACTURA</label>
                    <input type="date" name="fecha_factura_proveedor" class="form-control">
                  </div>
                </div>
              </div>

              <!-- Prepago -->
              <div style="border:1.5px solid #ede5f5;border-radius:8px;padding:14px;margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                  <input type="checkbox" name="requiere_prepago" id="chk-prepago" value="1" style="width:16px;height:16px;">
                  <label for="chk-prepago" style="font-size:13px;font-weight:600;color:#5a2d75;cursor:pointer;">Requiere prepago al proveedor</label>
                </div>
                <div class="form-group" id="campo-fecha-limite" style="margin-bottom:0;">
                  <label class="form-label">FECHA LÍMITE DE PREPAGO</label>
                  <input type="date" name="fecha_limite_prepago" class="form-control">
                </div>
              </div>

              <!-- ══ PASAJEROS DEL SERVICIO ══ -->
              <div style="border:2px solid #c4b5fd;border-radius:10px;padding:16px;margin-bottom:16px;background:#faf7ff;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                  <div style="font-size:13px;font-weight:700;color:#5a2d75;">
                    <i class="fas fa-users" style="color:#7B3FA0;"></i> PASAJEROS DE ESTE SERVICIO
                  </div>
                  <div style="display:flex;align-items:center;gap:10px;">
                    <label style="font-size:12px;font-weight:600;color:#6b7280;">Cantidad:</label>
                    <input type="number" name="cantidad_pasajeros" id="srv-cant-pax" min="1" max="99" value="${totalPax > 0 ? totalPax : 1}"
                      class="form-control" style="width:70px;padding:4px 8px;"
                      oninput="actualizarContadorPax()">
                  </div>
                </div>

                ${paxList.length > 0
                  ? `<!-- Pasajeros ya cargados en el file -->
                    <div style="font-size:12px;color:#6b7280;margin-bottom:8px;">
                      <i class="fas fa-info-circle"></i>
                      Seleccioná los pasajeros del file que incluye este servicio
                      (o agregá uno nuevo abajo):
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;" id="srv-pax-lista">
                      ${paxList.map((p: any) => `
                        <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;background:white;"
                               id="srv-chk-lbl-${p.id}" class="srv-pax-label">
                          <input type="checkbox" name="pax_ids" value="${p.id}"
                                 id="srv-chk-${p.id}"
                                 checked
                                 style="width:16px;height:16px;accent-color:#7B3FA0;"
                                 onchange="srvTogglePaxLabel(this)">
                          <div>
                            <div style="font-weight:600;font-size:13px;">${esc(p.nombre_completo)}</div>
                            <div style="font-size:11px;color:#9ca3af;">
                              ${p.rol === 'titular' ? 'Titular' : 'Acompañante'}
                              ${p.grupo ? '· ' + esc(p.grupo) : ''}
                              ${p.nro_documento ? '· ' + esc(p.tipo_documento) + ': ' + esc(p.nro_documento) : ''}
                            </div>
                          </div>
                        </label>
                      `).join('')}
                    </div>`
                  : `<div style="font-size:12px;color:#9ca3af;margin-bottom:12px;padding:8px;background:white;border-radius:8px;border:1px dashed #e5e7eb;">
                      <i class="fas fa-info-circle" style="color:#F7941D;"></i>
                      No hay pasajeros cargados en el file aún. Podés buscar uno existente o crear uno nuevo abajo.
                    </div>`
                }

                <!-- Botones rápidos de selección -->
                ${paxList.length > 1 ? `
                  <div style="display:flex;gap:6px;margin-bottom:12px;">
                    <button type="button" onclick="srvSelTodos(true)"
                      style="background:none;border:1px solid #c4b5fd;color:#7B3FA0;padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;">
                      <i class="fas fa-check-double"></i> Todos
                    </button>
                    <button type="button" onclick="srvSelTodos(false)"
                      style="background:none;border:1px solid #e5e7eb;color:#6b7280;padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;">
                      Ninguno
                    </button>
                  </div>` : ''}

                <!-- Agregar pasajero rápido -->
                <div style="border-top:1px dashed #c4b5fd;padding-top:12px;margin-top:4px;">
                  <div style="font-size:12px;font-weight:700;color:#5a2d75;margin-bottom:8px;">
                    <i class="fas fa-user-plus" style="color:#EC008C;"></i>
                    Agregar pasajero al file (nuevo o existente)
                  </div>

                  <!-- Tabs -->
                  <div style="display:flex;gap:0;margin-bottom:10px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;max-width:380px;">
                    <button type="button" onclick="srvSwitchTab('nuevo')" id="srv-tab-nuevo"
                      style="flex:1;padding:7px;border:none;background:#7B3FA0;color:white;font-size:12px;font-weight:600;cursor:pointer;">
                      <i class="fas fa-user-plus"></i> Nuevo
                    </button>
                    <button type="button" onclick="srvSwitchTab('buscar')" id="srv-tab-buscar"
                      style="flex:1;padding:7px;border:none;background:white;color:#7B3FA0;font-size:12px;font-weight:600;cursor:pointer;border-left:1px solid #e5e7eb;">
                      <i class="fas fa-search"></i> Buscar existente
                    </button>
                  </div>

                  <!-- Panel Nuevo Pasajero rápido -->
                  <div id="srv-panel-nuevo">
                    <div class="grid-2" style="margin-bottom:8px;">
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">NOMBRE *</label>
                        <input type="text" id="srv-pax-nombre" class="form-control" style="padding:6px 10px;" placeholder="Nombre">
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">APELLIDO *</label>
                        <input type="text" id="srv-pax-apellido" class="form-control" style="padding:6px 10px;" placeholder="Apellido">
                      </div>
                    </div>
                    <div class="grid-2" style="margin-bottom:8px;">
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">TIPO DOC</label>
                        <select id="srv-pax-tipo-doc" class="form-control" style="padding:6px 10px;">
                          <option value="CI">C.I.</option>
                          <option value="DNI">DNI</option>
                          <option value="PAS">Pasaporte</option>
                          <option value="OTRO">Otro</option>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">NRO DOCUMENTO</label>
                        <input type="text" id="srv-pax-nro-doc" class="form-control" style="padding:6px 10px;" placeholder="Ej: 12345678">
                      </div>
                    </div>
                    <div class="grid-2" style="margin-bottom:8px;">
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">ROL EN EL FILE</label>
                        <select id="srv-pax-rol" class="form-control" style="padding:6px 10px;">
                          <option value="acompañante">Acompañante</option>
                          <option value="titular">Titular</option>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">GRUPO / FAMILIA</label>
                        <input type="text" id="srv-pax-grupo" class="form-control" style="padding:6px 10px;" placeholder="Ej: Familia García">
                      </div>
                    </div>
                    <button type="button" onclick="srvAgregarNuevoPax()"
                      style="background:#7B3FA0;color:white;border:none;padding:7px 16px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;margin-top:4px;">
                      <i class="fas fa-plus"></i> Crear y agregar al servicio
                    </button>
                    <div id="srv-pax-msg" style="font-size:11px;margin-top:6px;"></div>
                  </div>

                  <!-- Panel Buscar Existente -->
                  <div id="srv-panel-buscar" style="display:none;">
                    <input type="text" id="srv-buscar-input" class="form-control" style="margin-bottom:8px;"
                      placeholder="Escribí nombre o documento..." oninput="srvBuscarPax(this.value)">
                    <div id="srv-buscar-resultado" style="min-height:40px;max-height:180px;overflow-y:auto;"></div>
                    <div id="srv-pax-sel-info" style="display:none;background:#f3e8ff;border-radius:8px;padding:8px 12px;font-size:12px;color:#5a2d75;margin-top:8px;">
                      <i class="fas fa-check-circle" style="color:#7B3FA0;"></i> <span id="srv-pax-sel-nombre"></span>
                    </div>
                    <div class="grid-2" style="margin-top:8px;" id="srv-buscar-rol-area" style="display:none;">
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">ROL EN EL FILE</label>
                        <select id="srv-buscar-rol" class="form-control" style="padding:6px 10px;">
                          <option value="acompañante">Acompañante</option>
                          <option value="titular">Titular</option>
                        </select>
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:11px;">GRUPO / FAMILIA</label>
                        <input type="text" id="srv-buscar-grupo" class="form-control" style="padding:6px 10px;" placeholder="Ej: Familia García">
                      </div>
                    </div>
                    <input type="hidden" id="srv-buscar-pax-id">
                    <button type="button" id="srv-btn-agregar-existente" onclick="srvAgregarExistente()" disabled
                      style="background:#7B3FA0;color:white;border:none;padding:7px 16px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;margin-top:8px;opacity:0.5;">
                      <i class="fas fa-user-plus"></i> Agregar al file y servicio
                    </button>
                    <div id="srv-buscar-msg" style="font-size:11px;margin-top:6px;"></div>
                  </div>
                </div>
              </div>

              <!-- Notas -->
              <div class="form-group">
                <label class="form-label">NOTAS</label>
                <textarea name="notas" rows="2" class="form-control" placeholder="Información adicional..."></textarea>
              </div>

              <!-- Hidden: ids de pasajeros ya en el file a asociar al servicio (se llena via JS) -->
              <input type="hidden" name="pax_ids_nuevos" id="srv-pax-ids-nuevos" value="">

              <div style="display:flex;gap:10px;">
                <button type="submit" id="btn-guardar-svc" class="btn btn-primary"><i class="fas fa-save"></i> Guardar Servicio</button>
                <button type="button" onclick="cerrarModalServicio()" class="btn btn-outline">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal Movimiento de Caja -->
      <div class="modal-overlay" id="modal-movimiento">
        <div class="modal" style="max-width:600px;">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-dollar-sign" style="color:#059669"></i> Registrar Movimiento</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-movimiento').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/tesoreria/movimiento" onsubmit="return validarFormMovimiento(event)">
              <input type="hidden" name="file_id" value="${id}">
              <input type="hidden" name="cliente_id" value="${file.cliente_id || ''}">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">TIPO *</label>
                  <select name="tipo" required class="form-control" id="sel-tipo-mov" onchange="togglePagador(this.value)">
                    <option value="ingreso">Ingreso (Cobro al cliente)</option>
                    <option value="egreso">Egreso (Pago a proveedor)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">MÉTODO *</label>
                  <select name="metodo" required class="form-control" id="mov-metodo" onchange="toggleMovMetodo(this.value)">
                    <option value="transferencia">Transferencia</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>
              <!-- Selector de pagador:
                   - El cliente del file SIEMPRE aparece (aunque no esté cargado como pasajero)
                   - Si hay titulares adicionales de otros grupos, también aparecen
              -->
              <div class="form-group" id="campo-pagador">
                <label class="form-label">¿QUIÉN PAGA?
                  ${titulares.length > 0
                    ? `<span style="color:#7B3FA0;font-weight:400;font-size:11px;">(Identificar el pagador separa cuentas por familia)</span>`
                    : `<span style="color:#9ca3af;font-weight:400;font-size:11px;">(Opcional)</span>`}
                </label>
                <select name="pasajero_pagador_id" class="form-control" style="border-color:#c4b5fd;">
                  <!-- Opción vacía = cliente principal del file (sin pasajero_pagador_id) -->
                  <option value="">— ${esc(file.cliente_nombre)} (cliente del file)</option>
                  ${titulares
                    .filter((t: any) => t.nombre_completo !== file.cliente_nombre)
                    .map((t: any) => `<option value="${t.id}">${esc(t.nombre_completo)}${t.grupo?' · '+esc(t.grupo):''} (titular)</option>`)
                    .join('')}
                </select>
                ${titulares.length > 0
                  ? `<div style="font-size:11px;color:#7B3FA0;margin-top:3px;"><i class="fas fa-info-circle"></i> Opción vacía registra el pago a nombre de <strong>${esc(file.cliente_nombre)}</strong>.</div>`
                  : `<div style="font-size:11px;color:#9ca3af;margin-top:3px;">Si agregás titulares de otros grupos aparecerán aquí para separar sus cobros.</div>`}
              </div>
              <div class="form-group">
                <label class="form-label">CONCEPTO *</label>
                <input type="text" name="concepto" required class="form-control" placeholder="Ej: Cobro parcial File #${file.numero}">
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">MONTO *</label>
                  <input type="number" name="monto" required min="0" step="0.01" class="form-control" id="mov-monto-total" oninput="calcMovTC(); calcMovEquivUSD()">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA</label>
                  <select name="moneda" class="form-control" id="mov-moneda" onchange="movCambioMoneda(this.value); calcMovTC()">
                    <option value="USD">USD — Dólar</option>
                    <option value="UYU">UYU — Peso Uruguayo</option>
                  </select>
                </div>
              </div>
              <!-- Panel cotización: aparece al seleccionar UYU -->
              <div id="mov-panel-cot" style="display:none;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                  <div>
                    <div style="font-size:11px;font-weight:700;color:#0369a1;margin-bottom:4px;"><i class="fas fa-exchange-alt"></i> COTIZACIÓN UYU/USD</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <input type="number" id="mov-cot-input" step="0.0001" min="0.0001" class="form-control" style="width:120px;font-weight:700;font-size:15px;" placeholder="43.5000" oninput="calcMovEquivUSD()">
                      <span id="mov-cot-badge" style="font-size:11px;color:#0369a1;"></span>
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Equivale a</div>
                    <div id="mov-equiv-usd" style="font-size:18px;font-weight:800;color:#059669;">—</div>
                    <div style="font-size:10px;color:#9ca3af;">USD</div>
                  </div>
                </div>
              </div>
              <input type="hidden" name="cotizacion" id="mov-cot-hidden" value="1">

              <!-- Panel Cuenta Bancaria (aparece cuando método = transferencia o cheque) -->
              <div id="mov-panel-banco" style="display:none;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:12px;">
                <div class="form-group" style="margin-bottom:0;">
                  <label class="form-label" style="color:#065f46;"><i class="fas fa-university" style="color:#059669;"></i> CUENTA BANCARIA *</label>
                  <select name="banco_id" id="mov-banco-id" class="form-control" style="border-color:#6ee7b7;">
                    <option value="">— Sin especificar cuenta —</option>
                    ${(bancos.results as any[]).map((b: any) =>
                      `<option value="${b.id}">${esc(b.nombre_entidad)} (${b.moneda})</option>`
                    ).join('')}
                  </select>
                  <div style="font-size:11px;color:#047857;margin-top:3px;"><i class="fas fa-info-circle"></i> Seleccioná la cuenta donde se acredita / debita el importe.</div>
                </div>
              </div>

              <!-- Panel Tarjetas de Crédito (aparece cuando método = tarjeta) -->
              <div id="mov-panel-tc" style="display:none;background:#faf5ff;border:2px solid #c4b5fd;border-radius:10px;padding:14px;margin-bottom:14px;">
                <div style="font-size:12px;font-weight:700;color:#5a2d75;margin-bottom:10px;">
                  <i class="fas fa-credit-card" style="color:#EC008C;"></i> DATOS DE TARJETA(S) DE CRÉDITO
                  <span style="font-size:11px;font-weight:400;color:#7B3FA0;margin-left:6px;">— Se registrarán en <strong>Tarjetas en Cartera</strong> como pendientes de autorización</span>
                </div>
                <div id="mov-lista-tc">
                  <div class="mov-fila-tc" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px;">
                    <div>
                      <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">ÚLTIMOS 4 DÍGITOS *</label>
                      <input type="text" name="tc_ultimos4" class="form-control mov-tc-ult4" maxlength="4" placeholder="1234"
                             style="letter-spacing:3px;font-weight:700;font-size:15px;" oninput="calcMovTC()">
                    </div>
                    <div>
                      <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">BANCO EMISOR</label>
                      <input type="text" name="tc_banco" class="form-control" placeholder="Ej: Santander">
                    </div>
                    <div>
                      <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">MONTO TC *</label>
                      <input type="number" name="tc_monto" class="form-control mov-tc-monto" min="0.01" step="0.01" placeholder="0.00" oninput="calcMovTC()">
                    </div>
                    <div style="padding-top:18px;">
                      <button type="button" onclick="elimMovTC(this)" style="padding:6px 9px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;">
                        <i class="fas fa-trash" style="font-size:12px;"></i>
                      </button>
                    </div>
                  </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                  <button type="button" onclick="addMovTC()" style="padding:5px 12px;background:#7B3FA0;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;">
                    <i class="fas fa-plus"></i> Agregar otra tarjeta
                  </button>
                  <span style="font-size:12px;font-weight:700;color:#5a2d75;">Total TC: <span id="mov-txt-total-tc" style="color:#EC008C;">$0.00</span></span>
                </div>
                <div id="mov-aviso-tc" style="display:none;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:6px 10px;margin-top:8px;font-size:11px;color:#92400e;">
                  <i class="fas fa-exclamation-triangle"></i> El total de tarjetas no coincide con el monto total ingresado.
                </div>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Registrar</button>
                <button type="button" onclick="document.getElementById('modal-movimiento').classList.remove('active')" class="btn btn-outline">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal Agregar Pasajero -->
      <div class="modal-overlay" id="modal-pasajero">
        <div class="modal" style="max-width:680px;">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-user-plus" style="color:#7B3FA0"></i> Agregar Pasajero al File</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-pasajero').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <!-- Tab: Nuevo vs Existente -->
            <div style="display:flex;gap:0;margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <button onclick="switchTabPax('nuevo')" id="tab-nuevo" style="flex:1;padding:10px;border:none;background:#7B3FA0;color:white;font-weight:600;font-size:13px;cursor:pointer;">
                <i class="fas fa-user-plus"></i> Nuevo Pasajero
              </button>
              <button onclick="switchTabPax('existente')" id="tab-existente" style="flex:1;padding:10px;border:none;background:white;color:#7B3FA0;font-weight:600;font-size:13px;cursor:pointer;border-left:1px solid #e5e7eb;">
                <i class="fas fa-search"></i> Buscar Existente
              </button>
            </div>
            
            <!-- Panel Nuevo Pasajero -->
            <div id="panel-nuevo">
              <form method="POST" action="/files/${id}/pasajeros">
                <input type="hidden" name="accion" value="nuevo">
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">NOMBRE <span style="color:#dc2626;">*</span></label>
                    <input type="text" name="nombre" required class="form-control" placeholder="Ej: Marcela">
                  </div>
                  <div class="form-group">
                    <label class="form-label">APELLIDO <span style="color:#dc2626;">*</span></label>
                    <input type="text" name="apellido" required class="form-control" placeholder="Ej: Moncada García">
                  </div>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">ROL EN EL FILE *</label>
                    <select name="rol" required class="form-control" id="sel-rol-pax">
                      <option value="acompañante">Acompañante / Pasajero</option>
                      <option value="titular">Titular (paga por su grupo)</option>
                    </select>
                    <div style="font-size:11px;color:#9ca3af;margin-top:3px;">El titular puede identificarse como pagador en movimientos de caja</div>
                  </div>
                  <div class="form-group" id="campo-grupo-nuevo">
                    <label class="form-label">GRUPO / FAMILIA</label>
                    <input type="text" name="grupo" class="form-control" placeholder="Ej: Familia Blanco, Familia León" list="grupos-existentes">
                    <datalist id="grupos-existentes">
                      ${[...new Set(paxList.map((p: any) => p.grupo).filter(Boolean))].map((g: any) => `<option value="${esc(g)}">`).join('')}
                    </datalist>
                    <div style="font-size:11px;color:#9ca3af;margin-top:3px;">Agrupar pasajeros de la misma familia/grupo</div>
                  </div>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">TIPO DOCUMENTO</label>
                    <select name="tipo_documento" id="pax-tipo-doc" class="form-control" onchange="actualizarDocPax(this.value)">
                      <option value="CI">C.I. (Cédula de Identidad)</option>
                      <option value="DNI">DNI</option>
                      <option value="PAS">Pasaporte</option>
                      <option value="OTRO">Otro</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Nº DOCUMENTO</label>
                    <div style="position:relative;">
                      <input type="text" name="nro_documento" id="pax-nro-doc" class="form-control" placeholder="Ej: 12345678" oninput="onInputDocPax(this.value)">
                      <span id="pax-ci-icono" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:15px;"></span>
                    </div>
                    <div id="pax-ci-msg" style="font-size:11px;margin-top:2px;"></div>
                  </div>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">FECHA DE NACIMIENTO</label>
                    <input type="date" name="fecha_nacimiento" id="pax-fecha-nac" class="form-control" oninput="actualizarTipoPax(this.value); validarFechaNac(this)">
                    <div id="err-fecha-nac-pax" style="display:none;font-size:11px;color:#dc2626;margin-top:3px;"><i class="fas fa-exclamation-circle"></i> La fecha de nacimiento no puede ser futura.</div>
                    <div id="pax-tipo-badge" style="margin-top:6px;display:none;">
                      <span id="pax-tipo-label" style="font-size:12px;font-weight:800;padding:3px 10px;border-radius:6px;letter-spacing:1px;"></span>
                      <span id="pax-tipo-desc" style="font-size:11px;color:#6b7280;margin-left:6px;"></span>
                    </div>
                  </div>
                  <div class="form-group">
                    <label class="form-label">VENCIMIENTO PASAPORTE</label>
                    <input type="date" name="vencimiento_pasaporte" class="form-control">
                  </div>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">EMAIL</label>
                    <input type="email" name="email" class="form-control" placeholder="email@ejemplo.com">
                  </div>
                  <div class="form-group">
                    <label class="form-label">TELÉFONO</label>
                    <input type="text" name="telefono" class="form-control" placeholder="+598 9x xxx xxx">
                  </div>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">PREFERENCIAS COMIDA</label>
                    <input type="text" name="preferencias_comida" class="form-control" placeholder="Ej: Vegetariano, Sin gluten">
                  </div>
                  <div class="form-group">
                    <label class="form-label">MILLAS / FREQUENT FLYER</label>
                    <input type="text" name="millas_aerolineas" class="form-control" placeholder="Ej: LATAM Pass 123456">
                  </div>
                </div>
                <div style="display:flex;gap:10px;margin-top:4px;">
                  <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Agregar al File</button>
                  <button type="button" onclick="document.getElementById('modal-pasajero').classList.remove('active')" class="btn btn-outline">Cancelar</button>
                </div>
              </form>
            </div>
            
            <!-- Panel Buscar Existente (oculto por defecto) -->
            <div id="panel-existente" style="display:none;">
              <form method="POST" action="/files/${id}/pasajeros">
                <input type="hidden" name="accion" value="existente">
                <div class="form-group">
                  <label class="form-label">BUSCAR PASAJERO <span style="font-size:11px;color:#9ca3af;">(nombre o documento)</span></label>
                  <input type="text" id="buscar-pax-input" class="form-control" placeholder="Escribí el nombre o nro. de documento..." oninput="buscarPasajeros(this.value)">
                </div>
                <div id="resultado-busqueda-pax" style="min-height:60px;margin-bottom:12px;"></div>
                <input type="hidden" name="pasajero_id" id="pax-seleccionado-id">
                <div id="pax-seleccionado-info" style="display:none;background:#f3e8ff;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#5a2d75;">
                  <i class="fas fa-check-circle" style="color:#7B3FA0;"></i> <span id="pax-seleccionado-nombre"></span>
                </div>
                <div class="grid-2">
                  <div class="form-group">
                    <label class="form-label">ROL EN ESTE FILE *</label>
                    <select name="rol" required class="form-control">
                      <option value="acompañante">Acompañante / Pasajero</option>
                      <option value="titular">Titular (paga por su grupo)</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label">GRUPO / FAMILIA</label>
                    <input type="text" name="grupo" class="form-control" placeholder="Ej: Familia Blanco" list="grupos-existentes">
                  </div>
                </div>
                <div style="display:flex;gap:10px;">
                  <button type="submit" class="btn btn-primary" id="btn-agregar-existente" disabled><i class="fas fa-user-plus"></i> Agregar al File</button>
                  <button type="button" onclick="document.getElementById('modal-pasajero').classList.remove('active')" class="btn btn-outline">Cancelar</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      <!-- Modal Asignar Pasajeros a Servicio -->
      <div class="modal-overlay" id="modal-pax-servicio">
        <div class="modal" style="max-width:520px;">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-user-check" style="color:#7B3FA0"></i> Pasajeros en el Servicio</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-pax-servicio').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <div id="modal-pax-servicio-desc" style="font-size:13px;color:#5a2d75;font-weight:600;margin-bottom:14px;padding:8px 12px;background:#f3e8ff;border-radius:8px;"></div>
            ${paxList.length === 0
              ? `<div style="text-align:center;color:#9ca3af;padding:20px;">Primero agregá pasajeros al file.</div>`
              : `<form id="form-pax-servicio" method="POST">
                  <input type="hidden" name="_servicio_id" id="hidden-servicio-id">
                  <div style="margin-bottom:14px;">
                    <label style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:0.5px;">SELECCIONÁ LOS PASAJEROS QUE INCLUYE ESTE SERVICIO:</label>
                    <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;" id="lista-pax-servicio">
                      ${paxList.map((p: any) => `
                        <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;background:white;" 
                               id="chk-pax-label-${p.id}">
                          <input type="checkbox" name="pasajero_ids" value="${p.id}" 
                                 id="chk-pax-${p.id}"
                                 style="width:16px;height:16px;accent-color:#7B3FA0;">
                          <div>
                            <div style="font-weight:600;font-size:13px;">${esc(p.nombre && p.apellido ? p.nombre+' '+p.apellido : p.nombre_completo)}</div>
                            <div style="font-size:11px;color:#9ca3af;">${p.rol==='titular'?'Titular':'Acompañante'}${p.grupo?' · '+esc(p.grupo):''}${p.nro_documento?' · Doc: '+esc(p.nro_documento):''}</div>
                          </div>
                        </label>
                      `).join('')}
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;">
                    <button type="button" onclick="seleccionarTodosPax(true)" style="background:none;border:1px solid #c4b5fd;color:#7B3FA0;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;">
                      <i class="fas fa-check-double"></i> Todos
                    </button>
                    <button type="button" onclick="seleccionarTodosPax(false)" style="background:none;border:1px solid #e5e7eb;color:#6b7280;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;">
                      Ninguno
                    </button>
                    <div style="flex:1;"></div>
                    <button type="button" onclick="guardarPaxServicio()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> Guardar</button>
                    <button type="button" onclick="document.getElementById('modal-pax-servicio').classList.remove('active')" class="btn btn-outline btn-sm">Cancelar</button>
                  </div>
                </form>`
            }
          </div>
        </div>
      </div>

      <!-- ══════════ MODAL AJUSTAR VENTA ══════════ -->
      <div class="modal-overlay" id="modal-ajustar-venta">
        <div class="modal" style="max-width:520px;">
          <div class="modal-header">
            <span class="modal-title">
              <i class="fas fa-sliders-h" style="color:#0369a1"></i> Ajustar Venta Total
            </span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-ajustar-venta').classList.remove('active')">&times;</button>
          </div>
          <div style="padding:20px;">
            ${fileLiquidado ? `
              <div style="background:#fef3c7;border:1.5px solid #f59e0b;border-radius:10px;padding:16px;display:flex;gap:12px;align-items:flex-start;">
                <i class="fas fa-exclamation-triangle" style="color:#d97706;font-size:20px;margin-top:2px;"></i>
                <div>
                  <div style="font-weight:700;color:#92400e;margin-bottom:4px;">File con liquidación aprobada</div>
                  <div style="font-size:13px;color:#78350f;">Este file tiene servicios liquidados en comisiones. Contacte al administrador para realizar modificaciones.</div>
                </div>
              </div>
            ` : `
              <!-- Resumen actual -->
              <div style="background:#f3e8ff;border-radius:10px;padding:14px;margin-bottom:18px;">
                <div style="font-size:12px;font-weight:700;color:#5a2d75;margin-bottom:10px;letter-spacing:.5px;">SITUACIÓN ACTUAL</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center;">
                  <div>
                    <div style="font-size:11px;color:#9ca3af;">Venta total</div>
                    <div style="font-size:18px;font-weight:800;color:#7B3FA0;" id="av-venta-actual">$${(file.total_venta || 0).toLocaleString('es-UY', {minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                  </div>
                  <div>
                    <div style="font-size:11px;color:#9ca3af;">Costo total</div>
                    <div style="font-size:18px;font-weight:800;color:#374151;">$${(file.total_costo || 0).toLocaleString('es-UY', {minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                  </div>
                  <div>
                    <div style="font-size:11px;color:#9ca3af;">Utilidad</div>
                    <div style="font-size:18px;font-weight:800;color:#059669;">$${((file.total_venta||0)-(file.total_costo||0)).toLocaleString('es-UY', {minimumFractionDigits:0,maximumFractionDigits:0})}</div>
                  </div>
                </div>
              </div>

              <!-- Servicios que serán ajustados -->
              <div style="margin-bottom:16px;">
                <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px;">SERVICIOS A AJUSTAR (${servicios.results.filter((s:any)=>s.estado!=='anulado').length} activos)</div>
                <div style="max-height:150px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px;">
                  ${servicios.results.filter((s:any)=>s.estado!=='anulado').map((s:any) => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;">
                      <span style="color:#374151;">${s.tipo_servicio ? s.tipo_servicio.charAt(0).toUpperCase()+s.tipo_servicio.slice(1) : '—'} ${s.descripcion ? '· '+s.descripcion.substring(0,30) : ''}</span>
                      <span style="color:#9ca3af;">Costo: <strong>$${(s.costo_original||0).toLocaleString()}</strong> / Venta: <strong>$${(s.precio_venta||0).toLocaleString()}</strong></span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <!-- Input nueva venta -->
              <div style="margin-bottom:16px;">
                <label style="font-size:12px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">NUEVA VENTA TOTAL (${file.moneda || 'USD'})</label>
                <div style="display:flex;gap:8px;align-items:center;">
                  <input type="number" id="av-nueva-venta" min="0" step="1"
                    value="${file.total_venta || 0}"
                    style="flex:1;padding:10px 14px;border:2px solid #c4b5fd;border-radius:8px;font-size:18px;font-weight:700;color:#5a2d75;outline:none;"
                    oninput="avPrevisualizar()">
                  <span style="font-size:14px;color:#6b7280;">${file.moneda || 'USD'}</span>
                </div>
                <div id="av-nueva-utilidad" style="font-size:12px;color:#059669;margin-top:6px;font-weight:600;"></div>
              </div>

              <!-- Preview -->
              <div id="av-preview" style="display:none;margin-bottom:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;">
                <div style="font-size:11px;font-weight:700;color:#166534;margin-bottom:8px;">PREVIEW DEL AJUSTE</div>
                <div id="av-preview-rows"></div>
              </div>

              <div id="av-error" style="display:none;color:#dc2626;font-size:12px;margin-bottom:10px;padding:8px 12px;background:#fef2f2;border-radius:6px;"></div>

              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button type="button" onclick="document.getElementById('modal-ajustar-venta').classList.remove('active')"
                  class="btn btn-outline">Cancelar</button>
                <button type="button" onclick="confirmarAjusteVenta()"
                  style="padding:9px 20px;background:linear-gradient(135deg,#0369a1,#0ea5e9);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
                  <i class="fas fa-check"></i> Confirmar Ajuste
                </button>
              </div>
            `}
          </div>
        </div>
      </div>

      <script>
        // ── Cotizaciones del día ────────────────────────────────────
        let _cotHoy = {}
        ;(async function() {
          try {
            const r = await fetch('/api/cotizacion-hoy')
            const d = await r.json()
            if (d.ok) _cotHoy = d.cotizaciones
          } catch(e) {}
        })()

        function movCambioMoneda(moneda) {
          const panel  = document.getElementById('mov-panel-cot')
          const hidden = document.getElementById('mov-cot-hidden')
          const input  = document.getElementById('mov-cot-input')
          const badge  = document.getElementById('mov-cot-badge')
          if (moneda === 'UYU') {
            panel.style.display = 'block'
            const cot = _cotHoy['USD_UYU'] || ''
            input.value  = cot ? Number(cot).toFixed(4) : ''
            hidden.value = cot || 1
            badge.textContent = cot ? '✓ Cotización de hoy' : '⚠ No hay cotización para hoy'
            badge.style.color = cot ? '#059669' : '#d97706'
            calcMovEquivUSD()
          } else {
            panel.style.display = 'none'
            hidden.value = 1
          }
        }

        function calcMovEquivUSD() {
          const monto  = parseFloat(document.getElementById('mov-monto-total')?.value || '0')
          const cotEl  = document.getElementById('mov-cot-input')
          const cot    = parseFloat(cotEl?.value || '0')
          const hidden = document.getElementById('mov-cot-hidden')
          const equiv  = document.getElementById('mov-equiv-usd')
          const moneda = document.getElementById('mov-moneda')?.value
          if (hidden) hidden.value = cot || 1
          if (equiv && moneda === 'UYU') {
            equiv.textContent = (monto > 0 && cot > 0)
              ? 'US$ ' + (monto / cot).toLocaleString('es-UY', {minimumFractionDigits:2, maximumFractionDigits:2})
              : '—'
          }
        }

        // ── Restricción global de fechas ────────────────────────────
        (function() {
          const hoyStr = new Date().toISOString().split('T')[0]
          // Fechas de servicio: no pueden ser pasadas
          const fi = document.getElementById('svc-fecha-inicio')
          const ff = document.getElementById('svc-fecha-fin')
          if (fi) fi.min = hoyStr
          if (ff) ff.min = hoyStr
          // Fecha de nacimiento pasajero: no puede ser futura
          const fn = document.getElementById('pax-fecha-nac')
          if (fn) fn.max = hoyStr
          // Fecha de viaje en edición: no puede ser pasada
          const fve = document.getElementById('inp-fecha-viaje-edit')
          if (fve) fve.min = hoyStr
        })()

        function validarFechasSvc() {
          // Las fechas de servicio pueden ser pasadas (vuelos/hoteles ya reservados)
          // Solo validamos que fecha_fin no sea anterior a fecha_inicio
          const fi  = document.getElementById('svc-fecha-inicio')
          const ff  = document.getElementById('svc-fecha-fin')
          const err = document.getElementById('err-fecha-svc')
          if (fi?.value && ff?.value && ff.value < fi.value) {
            if (ff) ff.style.borderColor = '#dc2626'
            if (err) { err.textContent = 'La fecha de fin no puede ser anterior a la fecha de inicio.'; err.style.display = 'block' }
            return false
          }
          if (fi) fi.style.borderColor = ''
          if (ff) ff.style.borderColor = ''
          if (err) err.style.display = 'none'
          return true
        }

        function validarFechaViajeEdit(input) {
          const hoyStr = new Date().toISOString().split('T')[0]
          const errEl  = document.getElementById('err-fecha-viaje-edit')
          if (input.value && input.value < hoyStr) {
            if (errEl) errEl.style.display = 'block'
            input.style.borderColor = '#dc2626'
            return false
          }
          if (errEl) errEl.style.display = 'none'
          input.style.borderColor = ''
          return true
        }

        function validarFechaNac(input) {
          const hoyStr = new Date().toISOString().split('T')[0]
          const errEl  = document.getElementById('err-fecha-nac-pax')
          if (input.value && input.value > hoyStr) {
            if (errEl) errEl.style.display = 'block'
            input.style.borderColor = '#dc2626'
            input.value = ''
            return false
          }
          if (errEl) errEl.style.display = 'none'
          input.style.borderColor = ''
          return true
        }

        // ── Servicios ─────────────────────────────────────────────────
        async function marcarPrepago(servicioId) {
          if(!confirm('¿Marcar prepago como realizado?')) return
          const r = await fetch('/servicios/' + servicioId + '/prepago', {method:'POST'})
          if(r.ok) location.reload()
        }
        
        async function eliminarServicio(servicioId, fileId) {
          if(!confirm('¿Eliminar este servicio?')) return
          const r = await fetch('/servicios/' + servicioId, {method:'DELETE'})
          if(r.ok) {
            location.reload()
          } else {
            const data = await r.json().catch(() => ({}))
            alert('No se puede eliminar: ' + (data.error || 'error desconocido'))
          }
        }

        function cerrarModalServicio() {
          document.getElementById('modal-servicio').classList.remove('active')
          // reset modo edición
          document.getElementById('hidden-servicio-edit-id').value = ''
          document.getElementById('form-servicio').action = '/files/${id}/servicios'
          document.getElementById('modal-servicio-titulo').innerHTML = '<i class="fas fa-plus-circle" style="color:#F7941D"></i> Agregar Servicio'
          document.getElementById('btn-guardar-svc').innerHTML = '<i class="fas fa-save"></i> Guardar Servicio'
          document.getElementById('form-servicio').reset()
          // restaurar checkboxes
          document.querySelectorAll('#srv-pax-lista input[type=checkbox]').forEach(chk => {
            chk.checked = false
            srvTogglePaxLabel(chk)
          })
        }

        function editarServicio(s) {
          // Rellenar campos del modal con los datos del servicio
          const form = document.getElementById('form-servicio')
          form.action = '/servicios/' + s.id + '/editar'
          document.getElementById('hidden-servicio-edit-id').value = s.id
          document.getElementById('modal-servicio-titulo').innerHTML = '<i class="fas fa-edit" style="color:#7B3FA0"></i> Editar Servicio'
          document.getElementById('btn-guardar-svc').innerHTML = '<i class="fas fa-save"></i> Guardar cambios'

          // Campos de texto/número
          const set = (name, val) => {
            const el = form.querySelector('[name="' + name + '"]')
            if (!el) return
            if (el.tagName === 'SELECT') {
              // Intentar seleccionar la opción correspondiente
              const opt = [...el.options].find(o => o.value == (val ?? ''))
              if (opt) el.value = opt.value
              else el.value = ''
            } else if (el.type === 'checkbox') {
              el.checked = !!val
            } else {
              el.value = val ?? ''
            }
          }

          set('tipo_servicio',         s.tipo_servicio)
          set('nro_ticket',            s.nro_ticket)
          set('descripcion',           s.descripcion)
          set('proveedor_id',          s.proveedor_id)
          set('operador_id',           s.operador_id)
          set('destino_codigo',        s.destino_codigo)
          set('fecha_inicio',          s.fecha_inicio)
          set('fecha_fin',             s.fecha_fin)
          set('moneda_origen',         s.moneda_origen)
          set('costo_original',        s.costo_original)
          set('precio_venta',          s.precio_venta)
          set('requiere_prepago',        s.requiere_prepago)
          set('fecha_limite_prepago',    s.fecha_limite_prepago)
          set('nro_factura_proveedor',   s.nro_factura_proveedor)
          set('fecha_factura_proveedor', s.fecha_factura_proveedor)
          set('notas',                   s.notas)

          // Cantidad pasajeros
          const cantEl = document.getElementById('srv-cant-pax')
          if (cantEl) cantEl.value = s.cantidad_pasajeros || 1

          // Marcar los pasajeros del servicio
          const paxDeSvc = (serviciosPaxData[s.id] || [])
          document.querySelectorAll('#srv-pax-lista input[type=checkbox]').forEach(chk => {
            chk.checked = paxDeSvc.includes(parseInt(chk.value))
            srvTogglePaxLabel(chk)
          })

          // Mostrar/ocultar campo fecha límite prepago
          const campoFecha = document.getElementById('campo-fecha-limite')
          if (campoFecha) campoFecha.style.display = s.requiere_prepago ? '' : 'none'

          document.getElementById('modal-servicio').classList.add('active')
        }

        // ── Pasajeros: tabs del modal ─────────────────────────────────
        function switchTabPax(tab) {
          const esNuevo = tab === 'nuevo'
          document.getElementById('panel-nuevo').style.display = esNuevo ? '' : 'none'
          document.getElementById('panel-existente').style.display = esNuevo ? 'none' : ''
          document.getElementById('tab-nuevo').style.background = esNuevo ? '#7B3FA0' : 'white'
          document.getElementById('tab-nuevo').style.color = esNuevo ? 'white' : '#7B3FA0'
          document.getElementById('tab-existente').style.background = esNuevo ? 'white' : '#7B3FA0'
          document.getElementById('tab-existente').style.color = esNuevo ? '#7B3FA0' : 'white'
        }

        // ── Buscar pasajero existente ─────────────────────────────────
        let buscarTimer = null
        async function buscarPasajeros(q) {
          clearTimeout(buscarTimer)
          const div = document.getElementById('resultado-busqueda-pax')
          if (q.length < 2) { div.innerHTML = ''; return }
          buscarTimer = setTimeout(async () => {
            div.innerHTML = '<div style="color:#9ca3af;font-size:12px;">Buscando...</div>'
            try {
              const r = await fetch('/pasajeros/buscar?q=' + encodeURIComponent(q))
              const data = await r.json()
              if (!data.results || data.results.length === 0) {
                div.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:8px;">No se encontraron pasajeros con ese nombre/documento.</div>'
                return
              }
              div.innerHTML = data.results.map(p => \`
                <div onclick="seleccionarPax(\${p.id}, '\${p.nombre_completo.replace(/'/g,"\\\\'")}', '\${p.nro_documento||''}')" 
                     style="padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;margin-bottom:6px;transition:all 0.1s;"
                     onmouseover="this.style.borderColor='#7B3FA0';this.style.background='#faf7ff'"
                     onmouseout="this.style.borderColor='#e5e7eb';this.style.background='white'">
                  <div style="font-weight:600;font-size:13px;">\${p.nombre_completo}</div>
                  <div style="font-size:11px;color:#9ca3af;">\${p.tipo_documento||''}: \${p.nro_documento||'—'}\${p.email?' · '+p.email:''}</div>
                </div>
              \`).join('')
            } catch(e) {
              div.innerHTML = '<div style="color:#dc2626;font-size:12px;">Error buscando</div>'
            }
          }, 300)
        }

        function seleccionarPax(id, nombre, doc) {
          document.getElementById('pax-seleccionado-id').value = id
          document.getElementById('pax-seleccionado-nombre').textContent = nombre + (doc ? ' · Doc: ' + doc : '')
          document.getElementById('pax-seleccionado-info').style.display = ''
          document.getElementById('btn-agregar-existente').disabled = false
          document.getElementById('resultado-busqueda-pax').innerHTML = ''
          document.getElementById('buscar-pax-input').value = nombre
        }

        // ── Eliminar pasajero del file ────────────────────────────────
        async function eliminarPasajero(fpId) {
          if(!confirm('¿Quitar este pasajero del file?')) return
          const r = await fetch('/files/pasajeros/' + fpId, {method:'DELETE'})
          if(r.ok) location.reload()
          else alert('Error al quitar el pasajero')
        }

        // ── Asignar pasajeros a servicio ──────────────────────────────
        // Datos de pasajeros ya en servicios (inyectados desde server)
        const serviciosPaxData = ${JSON.stringify(serviciosPasajeros)}

        function asignarPaxServicio(servicioId, descripcion) {
          // Marcar los checkboxes según los pasajeros actuales del servicio
          const paxActuales = serviciosPaxData[servicioId] || []
          document.querySelectorAll('#lista-pax-servicio input[type=checkbox]').forEach(chk => {
            const pid = parseInt(chk.value)
            chk.checked = paxActuales.includes(pid)
            const lbl = document.getElementById('chk-pax-label-' + pid)
            if(lbl) lbl.style.borderColor = chk.checked ? '#7B3FA0' : '#e5e7eb'
          })
          document.getElementById('hidden-servicio-id').value = servicioId
          document.getElementById('modal-pax-servicio-desc').innerHTML = 
            '<i class="fas fa-concierge-bell"></i> ' + descripcion
          document.getElementById('modal-pax-servicio').classList.add('active')
          
          // Listener para highlight al checkear
          document.querySelectorAll('#lista-pax-servicio input[type=checkbox]').forEach(chk => {
            chk.onchange = function() {
              const lbl = document.getElementById('chk-pax-label-' + this.value)
              if(lbl) lbl.style.borderColor = this.checked ? '#7B3FA0' : '#e5e7eb'
              if(lbl) lbl.style.background = this.checked ? '#faf7ff' : 'white'
            }
          })
        }

        function seleccionarTodosPax(marcar) {
          document.querySelectorAll('#lista-pax-servicio input[type=checkbox]').forEach(chk => {
            chk.checked = marcar
            const lbl = document.getElementById('chk-pax-label-' + chk.value)
            if(lbl) lbl.style.borderColor = marcar ? '#7B3FA0' : '#e5e7eb'
            if(lbl) lbl.style.background = marcar ? '#faf7ff' : 'white'
          })
        }

        async function guardarPaxServicio() {
          const servicioId = document.getElementById('hidden-servicio-id').value
          const checks = document.querySelectorAll('#lista-pax-servicio input[type=checkbox]:checked')
          const ids = [...checks].map(c => parseInt(c.value))
          try {
            const r = await fetch('/servicios/' + servicioId + '/pasajeros', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({ pasajero_ids: ids })
            })
            if(r.ok) location.reload()
            else alert('Error guardando pasajeros del servicio')
          } catch(e) {
            alert('Error de red')
          }
        }

        // ══ MODAL SERVICIO: lógica de pasajeros ══════════════════

        // Alternar highlight al checkear pasajero en el servicio
        function srvTogglePaxLabel(chk) {
          const lbl = document.getElementById('srv-chk-lbl-' + chk.value)
          if (lbl) {
            lbl.style.borderColor = chk.checked ? '#7B3FA0' : '#e5e7eb'
            lbl.style.background  = chk.checked ? '#faf7ff' : 'white'
          }
          actualizarContadorPax()
        }

        // Seleccionar / deseleccionar todos los pasajeros del file en el servicio
        function srvSelTodos(marcar) {
          document.querySelectorAll('#srv-pax-lista input[type=checkbox]').forEach(chk => {
            chk.checked = marcar
            srvTogglePaxLabel(chk)
          })
          actualizarContadorPax()
        }

        // Actualizar el campo cantidad_pasajeros al cambiar checkboxes
        function actualizarContadorPax() {
          const checked = document.querySelectorAll('#srv-pax-lista input[type=checkbox]:checked').length
          const inp = document.getElementById('srv-cant-pax')
          if (inp && checked > 0) inp.value = checked
        }

        // Tabs del panel de agregar pasajero en servicio
        function srvSwitchTab(tab) {
          const esNuevo = tab === 'nuevo'
          document.getElementById('srv-panel-nuevo').style.display  = esNuevo ? '' : 'none'
          document.getElementById('srv-panel-buscar').style.display = esNuevo ? 'none' : ''
          document.getElementById('srv-tab-nuevo').style.background  = esNuevo ? '#7B3FA0' : 'white'
          document.getElementById('srv-tab-nuevo').style.color       = esNuevo ? 'white'   : '#7B3FA0'
          document.getElementById('srv-tab-buscar').style.background = esNuevo ? 'white'   : '#7B3FA0'
          document.getElementById('srv-tab-buscar').style.color      = esNuevo ? '#7B3FA0' : 'white'
        }

        // Crear nuevo pasajero via API y agregarlo al file + marcarlo en el servicio
        async function srvAgregarNuevoPax() {
          const nombre   = document.getElementById('srv-pax-nombre').value.trim()
          const apellido = document.getElementById('srv-pax-apellido').value.trim()
          const msg      = document.getElementById('srv-pax-msg')
          if (!nombre || !apellido) {
            msg.innerHTML = '<span style="color:#dc2626;">⚠ Nombre y apellido son obligatorios.</span>'; return
          }
          msg.innerHTML = '<span style="color:#9ca3af;">Guardando...</span>'

          const fd = new FormData()
          fd.append('accion',      'nuevo')
          fd.append('nombre',      nombre)
          fd.append('apellido',    apellido)
          fd.append('tipo_documento', document.getElementById('srv-pax-tipo-doc').value)
          fd.append('nro_documento',  document.getElementById('srv-pax-nro-doc').value.trim())
          fd.append('rol',   document.getElementById('srv-pax-rol').value)
          fd.append('grupo', document.getElementById('srv-pax-grupo').value.trim())
          fd.append('_srv_inline', '1')  // flag: no redirigir, devolver JSON

          try {
            const r = await fetch('/files/' + ${id} + '/pasajeros', { method: 'POST', body: fd })
            const data = await r.json().catch(() => ({}))
            if (!r.ok || data.error) {
              msg.innerHTML = '<span style="color:#dc2626;">Error: ' + (data.error||'desconocido') + '</span>'; return
            }
            const paxId = data.id
            const paxNc = nombre + ' ' + apellido

            // Agregar checkbox al listado del servicio
            const lista = document.getElementById('srv-pax-lista')
            if (lista) {
              const div = document.createElement('label')
              div.id = 'srv-chk-lbl-' + paxId
              div.className = 'srv-pax-label'
              div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;border:1.5px solid #7B3FA0;border-radius:8px;cursor:pointer;background:#faf7ff;'
              div.innerHTML = \`
                <input type="checkbox" name="pax_ids" value="\${paxId}" id="srv-chk-\${paxId}"
                  checked style="width:16px;height:16px;accent-color:#7B3FA0;"
                  onchange="srvTogglePaxLabel(this)">
                <div>
                  <div style="font-weight:600;font-size:13px;">\${paxNc}</div>
                  <div style="font-size:11px;color:#9ca3af;">Nuevo pasajero</div>
                </div>
              \`
              lista.appendChild(div)
            } else {
              // Si no había lista (0 pasajeros previos), crearla
              const container = document.getElementById('srv-pax-lista-container')
              if (!container) {
                const wrapper = document.createElement('div')
                wrapper.id = 'srv-pax-lista'
                const input = document.createElement('input')
                input.type = 'checkbox'; input.name = 'pax_ids'; input.value = paxId; input.checked = true
                wrapper.appendChild(input)
                document.getElementById('srv-panel-nuevo').parentNode.insertBefore(wrapper, document.getElementById('srv-panel-nuevo'))
              }
            }
            actualizarContadorPax()
            // Limpiar form
            document.getElementById('srv-pax-nombre').value  = ''
            document.getElementById('srv-pax-apellido').value = ''
            document.getElementById('srv-pax-nro-doc').value  = ''
            msg.innerHTML = '<span style="color:#059669;"><i class="fas fa-check-circle"></i> <strong>' + paxNc + '</strong> agregado correctamente.</span>'
          } catch(e) {
            msg.innerHTML = '<span style="color:#dc2626;">Error de red</span>'
          }
        }

        // Buscar pasajero existente en el panel del servicio
        let srvBuscarTimer = null
        async function srvBuscarPax(q) {
          clearTimeout(srvBuscarTimer)
          const div = document.getElementById('srv-buscar-resultado')
          if (q.length < 2) { div.innerHTML = ''; return }
          srvBuscarTimer = setTimeout(async () => {
            div.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:6px;">Buscando...</div>'
            try {
              const r = await fetch('/pasajeros/buscar?q=' + encodeURIComponent(q))
              const data = await r.json()
              if (!data.results || data.results.length === 0) {
                div.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:6px;">Sin resultados.</div>'; return
              }
              div.innerHTML = data.results.map(p => \`
                <div onclick="srvSelPaxExistente(\${p.id}, '\${(p.nombre_completo||'').replace(/'/g,"\\\\'")}', '\${p.nro_documento||''}')"
                  style="padding:7px 12px;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;margin-bottom:5px;font-size:12px;"
                  onmouseover="this.style.borderColor='#7B3FA0';this.style.background='#faf7ff'"
                  onmouseout="this.style.borderColor='#e5e7eb';this.style.background='white'">
                  <div style="font-weight:600;">\${p.nombre_completo}</div>
                  <div style="font-size:11px;color:#9ca3af;">\${p.tipo_documento||''}: \${p.nro_documento||'—'}\${p.email?' · '+p.email:''}</div>
                </div>
              \`).join('')
            } catch(e) {
              div.innerHTML = '<div style="color:#dc2626;font-size:12px;">Error</div>'
            }
          }, 300)
        }

        function srvSelPaxExistente(id, nombre, doc) {
          document.getElementById('srv-buscar-pax-id').value      = id
          document.getElementById('srv-pax-sel-nombre').textContent = nombre + (doc ? ' · ' + doc : '')
          document.getElementById('srv-pax-sel-info').style.display  = ''
          document.getElementById('srv-buscar-rol-area').style.display = ''
          const btn = document.getElementById('srv-btn-agregar-existente')
          btn.disabled = false; btn.style.opacity = '1'
          document.getElementById('srv-buscar-resultado').innerHTML = ''
          document.getElementById('srv-buscar-input').value = nombre
        }

        // Agregar pasajero existente al file + asociar al servicio
        async function srvAgregarExistente() {
          const paxId = document.getElementById('srv-buscar-pax-id').value
          const nombre = document.getElementById('srv-pax-sel-nombre').textContent
          const msg    = document.getElementById('srv-buscar-msg')
          if (!paxId) return
          msg.innerHTML = '<span style="color:#9ca3af;">Agregando...</span>'

          const fd = new FormData()
          fd.append('accion',      'existente')
          fd.append('pasajero_id', paxId)
          fd.append('rol',   document.getElementById('srv-buscar-rol').value)
          fd.append('grupo', document.getElementById('srv-buscar-grupo').value.trim())
          fd.append('_srv_inline', '1')

          try {
            const r = await fetch('/files/' + ${id} + '/pasajeros', { method: 'POST', body: fd })
            const data = await r.json().catch(() => ({}))
            if (!r.ok || data.error) {
              msg.innerHTML = '<span style="color:#dc2626;">Error: ' + (data.error||'desconocido') + '</span>'; return
            }
            // Agregar checkbox
            const lista = document.getElementById('srv-pax-lista')
            if (lista) {
              const exists = document.getElementById('srv-chk-' + paxId)
              if (!exists) {
                const div = document.createElement('label')
                div.id = 'srv-chk-lbl-' + paxId
                div.className = 'srv-pax-label'
                div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;border:1.5px solid #7B3FA0;border-radius:8px;cursor:pointer;background:#faf7ff;'
                div.innerHTML = \`
                  <input type="checkbox" name="pax_ids" value="\${paxId}" id="srv-chk-\${paxId}"
                    checked style="width:16px;height:16px;accent-color:#7B3FA0;"
                    onchange="srvTogglePaxLabel(this)">
                  <div>
                    <div style="font-weight:600;font-size:13px;">\${nombre.split(' · ')[0]}</div>
                    <div style="font-size:11px;color:#9ca3af;">Existente</div>
                  </div>
                \`
                lista.appendChild(div)
              } else {
                exists.checked = true
                srvTogglePaxLabel(exists)
              }
            }
            actualizarContadorPax()
            msg.innerHTML = '<span style="color:#059669;"><i class="fas fa-check-circle"></i> Agregado.</span>'
            // Reset
            document.getElementById('srv-buscar-pax-id').value = ''
            document.getElementById('srv-pax-sel-info').style.display = 'none'
            document.getElementById('srv-buscar-input').value = ''
            const btn = document.getElementById('srv-btn-agregar-existente')
            btn.disabled = true; btn.style.opacity = '0.5'
          } catch(e) {
            msg.innerHTML = '<span style="color:#dc2626;">Error de red</span>'
          }
        }

        // Inicializar checkboxes al abrir el modal
        document.addEventListener('DOMContentLoaded', function() {
          document.querySelectorAll('#srv-pax-lista input[type=checkbox]').forEach(chk => {
            srvTogglePaxLabel(chk)
          })
        })

        // ── Ocultar campo pagador en egresos ──────────────────────────
        function togglePagador(tipo) {
          const campo = document.getElementById('campo-pagador')
          if(campo) campo.style.display = tipo === 'egreso' ? 'none' : ''
        }

        // ── Panel de Tarjetas en modal de movimiento ──────────────────
        function toggleMovMetodo(val) {
          // Panel tarjetas
          const panelTc = document.getElementById('mov-panel-tc')
          if (panelTc) panelTc.style.display = val === 'tarjeta' ? 'block' : 'none'
          if (val === 'tarjeta') calcMovTC()

          // Panel cuenta bancaria (transferencia o cheque)
          const panelBanco = document.getElementById('mov-panel-banco')
          if (panelBanco) panelBanco.style.display = (val === 'transferencia' || val === 'cheque') ? 'block' : 'none'

          // Limpiar banco_id si no aplica
          if (val !== 'transferencia' && val !== 'cheque') {
            const sel = document.getElementById('mov-banco-id')
            if (sel) sel.value = ''
          }
        }

        // Mostrar panel banco si el método inicial ya es transferencia
        ;(function() {
          const metodoInicial = document.getElementById('mov-metodo')?.value
          if (metodoInicial === 'transferencia' || metodoInicial === 'cheque') {
            const panelBanco = document.getElementById('mov-panel-banco')
            if (panelBanco) panelBanco.style.display = 'block'
          }
        })()

        function calcMovTC() {
          let total = 0
          document.querySelectorAll('.mov-tc-monto').forEach(i => { total += parseFloat(i.value || '0') })
          const elTotal = document.getElementById('mov-txt-total-tc')
          if (elTotal) elTotal.textContent = '$' + total.toLocaleString('es-UY', {minimumFractionDigits:2})
          // Avisar si no coincide con el monto total
          const montoTotal = parseFloat(document.querySelector('#modal-movimiento [name="monto"]')?.value || '0')
          const aviso = document.getElementById('mov-aviso-tc')
          if (aviso && montoTotal > 0) aviso.style.display = (Math.abs(total - montoTotal) > 0.01) ? 'block' : 'none'
        }

        function addMovTC() {
          const lista = document.getElementById('mov-lista-tc')
          const div = document.createElement('div')
          div.className = 'mov-fila-tc'
          div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px;'
          div.innerHTML = \`
            <div>
              <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">ÚLTIMOS 4 DÍGITOS *</label>
              <input type="text" name="tc_ultimos4" class="form-control mov-tc-ult4" maxlength="4" placeholder="1234"
                     style="letter-spacing:3px;font-weight:700;font-size:15px;" oninput="calcMovTC()">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">BANCO EMISOR</label>
              <input type="text" name="tc_banco" class="form-control" placeholder="Ej: Santander">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#5a2d75;display:block;margin-bottom:3px;">MONTO TC *</label>
              <input type="number" name="tc_monto" class="form-control mov-tc-monto" min="0.01" step="0.01" placeholder="0.00" oninput="calcMovTC()">
            </div>
            <div style="padding-top:18px;">
              <button type="button" onclick="elimMovTC(this)" style="padding:6px 9px;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;">
                <i class="fas fa-trash" style="font-size:12px;"></i>
              </button>
            </div>
          \`
          lista.appendChild(div)
        }

        function elimMovTC(btn) {
          const filas = document.querySelectorAll('.mov-fila-tc')
          if (filas.length <= 1) { alert('Debe haber al menos una tarjeta.'); return }
          btn.closest('.mov-fila-tc').remove()
          calcMovTC()
        }

        function validarFormMovimiento(e) {
          const metodo = document.getElementById('mov-metodo')?.value
          if (metodo !== 'tarjeta') return true

          // Validar que cada fila tenga ultimos4 y monto
          const filas = document.querySelectorAll('.mov-fila-tc')
          let ok = true
          let totalTC = 0
          filas.forEach(fila => {
            const ult4 = fila.querySelector('.mov-tc-ult4')
            const monto = fila.querySelector('.mov-tc-monto')
            if (!ult4?.value?.trim() || ult4.value.trim().length < 4) {
              ult4.style.borderColor = '#dc2626'
              ok = false
            } else {
              ult4.style.borderColor = ''
            }
            const m = parseFloat(monto?.value || '0')
            if (m <= 0) {
              if (monto) monto.style.borderColor = '#dc2626'
              ok = false
            } else {
              if (monto) monto.style.borderColor = ''
              totalTC += m
            }
          })

          if (!ok) {
            alert('Por favor completá los datos de todas las tarjetas (últimos 4 dígitos y monto).')
            e.preventDefault()
            return false
          }

          const montoTotal = parseFloat(document.getElementById('mov-monto-total')?.value || '0')
          if (montoTotal > 0 && Math.abs(totalTC - montoTotal) > 0.01) {
            const confirmar = confirm(
              \`El total de las tarjetas ($\${totalTC.toFixed(2)}) no coincide con el monto total ($\${montoTotal.toFixed(2)}).\\n¿Continuar de todas formas?\`
            )
            if (!confirmar) { e.preventDefault(); return false }
          }
          return true
        }

        // ── Clasificación de pasajero por fecha de nacimiento (ADT/CHD/INF) ──
        function actualizarTipoPax(fechaVal) {
          const badge = document.getElementById('pax-tipo-badge')
          const label = document.getElementById('pax-tipo-label')
          const desc  = document.getElementById('pax-tipo-desc')
          if (!badge || !label || !desc || !fechaVal) {
            if (badge) badge.style.display = 'none'
            return
          }
          const hoy  = new Date()
          const nac  = new Date(fechaVal)
          if (isNaN(nac.getTime()) || nac > hoy) { badge.style.display = 'none'; return }

          // Calcular edad exacta en años (fraccionada)
          const diffMs   = hoy.getTime() - nac.getTime()
          const edadAnos = diffMs / (1000 * 60 * 60 * 24 * 365.25)

          let codigo, bgColor, txtColor, descripcion
          if (edadAnos >= 12) {
            codigo = 'ADT'; bgColor = '#dbeafe'; txtColor = '#1e40af'
            descripcion = \`Adulto · \${Math.floor(edadAnos)} años\`
          } else if (edadAnos >= 2) {
            codigo = 'CHD'; bgColor = '#d1fae5'; txtColor = '#065f46'
            descripcion = \`Child · \${Math.floor(edadAnos)} años\`
          } else {
            codigo = 'INF'; bgColor = '#fef3c7'; txtColor = '#92400e'
            const meses = Math.floor(edadAnos * 12)
            descripcion = \`Infante · \${meses} mese\${meses !== 1 ? 's' : ''}\`
          }

          label.textContent    = codigo
          label.style.background = bgColor
          label.style.color      = txtColor
          desc.textContent     = descripcion
          badge.style.display  = 'flex'
          badge.style.alignItems = 'center'
        }

        // ── Validación Cédula Uruguaya (módulo 10) ────────────────────
        function validarCIUruguay(valor) {
          const limpio = valor.replace(/[^0-9]/g, '')
          if (limpio.length === 0) return null
          if (limpio.length < 8) return 'incompleta'
          const padded = limpio.padStart(8, '0')
          const base = padded.slice(0, 7)
          const digitoIngresado = parseInt(padded[7])
          const mult = [2, 9, 8, 7, 6, 3, 4]
          let suma = 0
          for (let i = 0; i < 7; i++) suma += parseInt(base[i]) * mult[i]
          const resto = suma % 10
          const digitoEsperado = resto === 0 ? 0 : 10 - resto
          if (digitoIngresado === digitoEsperado) return 'valida'
          return 'invalida:' + digitoEsperado
        }

        // Actualizar placeholder y estado al cambiar tipo de documento en el modal de pasajero
        function actualizarDocPax(tipo) {
          const inp = document.getElementById('pax-nro-doc')
          const msg = document.getElementById('pax-ci-msg')
          const icono = document.getElementById('pax-ci-icono')
          if (!inp) return
          inp.style.borderColor = ''
          icono.style.display = 'none'
          icono.textContent = ''
          msg.textContent = ''
          if (tipo === 'CI') {
            inp.placeholder = 'Ej: 12345678 (8 dígitos sin puntos)'
            msg.innerHTML = '<span style="color:#9ca3af;"><i class="fas fa-info-circle"></i> Ingresá los 8 dígitos. Se validará automáticamente.</span>'
            if (inp.value) onInputDocPax(inp.value)
          } else if (tipo === 'DNI') {
            inp.placeholder = 'Ej: 12345678'
          } else if (tipo === 'PAS') {
            inp.placeholder = 'Ej: ABC123456'
          } else {
            inp.placeholder = ''
          }
        }

        function onInputDocPax(valor) {
          const tipo = document.getElementById('pax-tipo-doc')?.value
          if (tipo !== 'CI') return
          const icono = document.getElementById('pax-ci-icono')
          const msg = document.getElementById('pax-ci-msg')
          const inp = document.getElementById('pax-nro-doc')
          const resultado = validarCIUruguay(valor)
          if (resultado === null || resultado === 'incompleta') {
            icono.style.display = resultado === 'incompleta' ? 'inline' : 'none'
            icono.textContent = resultado === 'incompleta' ? '⏳' : ''
            msg.innerHTML = resultado === 'incompleta' ? '<span style="color:#9ca3af;">Ingresá los 8 dígitos</span>' : ''
            inp.style.borderColor = ''
          } else if (resultado === 'valida') {
            icono.style.display = 'inline'; icono.textContent = '✅'
            msg.innerHTML = '<span style="color:#059669;font-weight:600;"><i class="fas fa-check-circle"></i> Cédula válida</span>'
            inp.style.borderColor = '#059669'
          } else {
            const esperado = resultado.split(':')[1]
            icono.style.display = 'inline'; icono.textContent = '❌'
            msg.innerHTML = '<span style="color:#dc2626;font-weight:600;"><i class="fas fa-times-circle"></i> Cédula inválida — dígito verificador esperado: <strong>' + esperado + '</strong></span>'
            inp.style.borderColor = '#dc2626'
          }
        }

        // ── Modal Compartir File ──────────────────────────────
        function abrirModalCompartir() {
          document.getElementById('modal-compartir').style.display = 'flex'
        }
        function cerrarModalCompartir() {
          document.getElementById('modal-compartir').style.display = 'none'
        }

        // ── Ajustar Venta ─────────────────────────────────────
        const _avFileId    = ${id}
        const _avCostoTotal = ${servicios.results.filter((s:any)=>s.estado!=='anulado').reduce((sum:number,s:any)=>sum+(Number(s.costo_original)||0),0)}
        const _avServicios  = ${JSON.stringify(
          servicios.results
            .filter((s:any)=>s.estado!=='anulado')
            .map((s:any)=>({
              id: s.id,
              descripcion: (s.tipo_servicio||'') + (s.descripcion ? ' · '+s.descripcion.substring(0,30) : ''),
              costo: Number(s.costo_original)||0,
              venta: Number(s.precio_venta)||0
            }))
        )}

        function abrirAjustarVenta() {
          document.getElementById('modal-ajustar-venta').classList.add('active')
          avPrevisualizar()
        }

        function avPrevisualizar() {
          const nuevaVenta = parseFloat(document.getElementById('av-nueva-venta').value) || 0
          const utilNueva  = nuevaVenta - _avCostoTotal
          const utilEl     = document.getElementById('av-nueva-utilidad')
          const previewEl  = document.getElementById('av-preview')
          const rowsEl     = document.getElementById('av-preview-rows')
          const errEl      = document.getElementById('av-error')
          if (errEl) errEl.style.display = 'none'

          if (utilEl) {
            const pct = _avCostoTotal > 0 ? ((utilNueva / _avCostoTotal) * 100).toFixed(1) : '—'
            utilEl.textContent = 'Nueva utilidad: $' + utilNueva.toLocaleString('es-UY') + ' (' + pct + '% sobre costo)'
            utilEl.style.color = utilNueva >= 0 ? '#059669' : '#dc2626'
          }

          if (_avServicios.length === 0 || !previewEl || !rowsEl) return
          previewEl.style.display = 'block'

          // Distribuir: cada servicio recibe costo + (utilidadNueva * (costoProp / costoTotal))
          const distrib = calcularDistribucion(nuevaVenta)
          rowsEl.innerHTML = distrib.map(d => \`
            <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid #d1fae5;">
              <span style="color:#374151;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\${d.descripcion}</span>
              <span style="color:#6b7280;">Costo: <b>$\${d.costo.toLocaleString()}</b> → Venta: <b style="color:#059669;">$\${d.nuevaVenta.toLocaleString()}</b></span>
            </div>
          \`).join('')
          const totalCheck = distrib.reduce((s,d)=>s+d.nuevaVenta,0)
          rowsEl.innerHTML += \`<div style="text-align:right;font-size:12px;margin-top:6px;font-weight:700;color:#166534;">Total: $\${totalCheck.toLocaleString('es-UY')}</div>\`
        }

        function calcularDistribucion(nuevaVenta) {
          const utilidad = nuevaVenta - _avCostoTotal
          const n = _avServicios.length
          if (n === 0) return []
          const resultado = _avServicios.map(s => {
            let nuevaV
            if (_avCostoTotal === 0) {
              // Sin costo: repartir venta en partes iguales
              nuevaV = nuevaVenta / n
            } else {
              nuevaV = s.costo + (utilidad * (s.costo / _avCostoTotal))
            }
            return { ...s, nuevaVenta: Math.round(nuevaV) }
          })
          // Ajustar último para que el total cierre exacto
          const sumaActual = resultado.reduce((s,d)=>s+d.nuevaVenta,0)
          const diff = Math.round(nuevaVenta) - sumaActual
          if (diff !== 0) resultado[resultado.length - 1].nuevaVenta += diff
          return resultado
        }

        async function confirmarAjusteVenta() {
          const nuevaVenta = parseFloat(document.getElementById('av-nueva-venta').value) || 0
          const errEl = document.getElementById('av-error')

          if (nuevaVenta <= 0) {
            errEl.textContent = 'La venta total debe ser mayor a cero.'
            errEl.style.display = 'block'
            return
          }
          if (nuevaVenta < _avCostoTotal) {
            errEl.textContent = 'La venta total (' + nuevaVenta + ') es menor al costo total (' + _avCostoTotal + '). El file quedará con utilidad negativa. ¿Confirmás igual?'
            errEl.style.display = 'block'
            // Permitir igual, solo advertencia
          }

          const distrib = calcularDistribucion(nuevaVenta)
          const btnConf = document.querySelector('#modal-ajustar-venta button[onclick="confirmarAjusteVenta()"]')
          if (btnConf) { btnConf.disabled = true; btnConf.textContent = '⏳ Ajustando...' }

          try {
            const res = await fetch('/api/files/' + _avFileId + '/ajustar-venta', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nueva_venta_total: Math.round(nuevaVenta), servicios: distrib.map(d=>({id:d.id,precio_venta:d.nuevaVenta})) })
            })
            const data = await res.json()
            if (!data.ok) throw new Error(data.error || 'Error desconocido')
            document.getElementById('modal-ajustar-venta').classList.remove('active')
            window.location.reload()
          } catch(e) {
            errEl.textContent = 'Error: ' + e.message
            errEl.style.display = 'block'
            if (btnConf) { btnConf.disabled = false; btnConf.textContent = '✔ Confirmar Ajuste' }
          }
        }
      </script>

      <!-- ── Modal Compartir File ──────────────────────────────── -->
      <div id="modal-compartir" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:white;border-radius:16px;padding:28px;width:100%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="margin:0;color:#1a1a2e;font-size:18px;"><i class="fas fa-share-alt" style="color:#0ea5e9;margin-right:8px;"></i>Compartir File</h3>
            <button onclick="cerrarModalCompartir()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;">×</button>
          </div>

          ${compartidoRow ? `
            <!-- YA ESTÁ COMPARTIDO -->
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;margin-bottom:20px;">
              <div style="font-size:12px;font-weight:700;color:#0369a1;letter-spacing:1px;margin-bottom:8px;">FILE ACTUALMENTE COMPARTIDO</div>
              <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:16px;">
                  ${esc(compartidoRow.vendedor_compartido_nombre?.charAt(0).toUpperCase())}
                </div>
                <div>
                  <div style="font-weight:700;color:#1a1a2e;">${esc(compartidoRow.vendedor_compartido_nombre)}</div>
                  <div style="font-size:12px;color:#6b7280;">50% de venta y utilidad · Compartido por ${esc(compartidoRow.compartido_por_nombre)}</div>
                </div>
              </div>
            </div>
            <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:20px;font-size:12px;color:#92400e;">
              <i class="fas fa-info-circle"></i> Los importes de este file se dividen <strong>50/50</strong> en los reportes de facturación y utilidad.
            </div>
            ${puedeQuitarCompartido ? `
              <form method="POST" action="/files/${id}/compartir/quitar" onsubmit="return confirm('¿Quitar el compartido? Los reportes dejarán de dividirse entre los dos vendedores.')">
                <button type="submit" class="btn btn-danger" style="width:100%;">
                  <i class="fas fa-times-circle"></i> Quitar compartido
                </button>
              </form>
            ` : `
              <div style="font-size:12px;color:#9ca3af;text-align:center;padding:8px;background:#f9fafb;border-radius:8px;">
                <i class="fas fa-lock"></i> Solo un <strong>supervisor o gerente</strong> puede quitar el compartido.
              </div>
            `}
          ` : `
            <!-- FORM PARA COMPARTIR -->
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;color:#0369a1;">
              <i class="fas fa-info-circle"></i> Al compartir, los importes de <strong>venta y utilidad</strong> se dividirán <strong>50/50</strong> en los reportes entre vos y el vendedor elegido.
            </div>
            <form method="POST" action="/files/${id}/compartir">
              <div style="margin-bottom:16px;">
                <label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">Vendedor con quien compartir</label>
                <select name="vendedor_id" class="form-control" required>
                  <option value="">— Seleccioná un vendedor —</option>
                  ${(vendedoresParaCompartir.results as any[]).map((v: any) => `
                    <option value="${v.id}">${esc(v.nombre)}</option>
                  `).join('')}
                </select>
              </div>
              <div style="background:#f9fafb;border-radius:8px;padding:12px;margin-bottom:16px;font-size:12px;">
                <div style="font-weight:700;color:#374151;margin-bottom:6px;">Resumen del reparto:</div>
                <div style="display:flex;justify-content:space-between;">
                  <span>Venta total del file:</span>
                  <strong>$${Number(file.total_venta||0).toLocaleString()} ${file.moneda}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;color:#0369a1;">
                  <span>Tu parte (50%):</span>
                  <strong>$${Number((file.total_venta||0)/2).toLocaleString()} ${file.moneda}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;color:#7c3aed;">
                  <span>Parte del otro vendedor (50%):</span>
                  <strong>$${Number((file.total_venta||0)/2).toLocaleString()} ${file.moneda}</strong>
                </div>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="button" onclick="cerrarModalCompartir()" class="btn btn-outline" style="flex:1;">Cancelar</button>
                <button type="submit" class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#0ea5e9,#6366f1);">
                  <i class="fas fa-share-alt"></i> Confirmar compartido
                </button>
              </div>
            </form>
          `}
        </div>
      </div>

      <!-- Modal nueva devolución -->
      <div id="modal-devolucion" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:center;justify-content:center;padding:16px;">
        <div style="background:white;border-radius:14px;width:100%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);border-radius:14px 14px 0 0;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
            <div style="color:white;font-size:15px;font-weight:700;"><i class="fas fa-undo-alt"></i> Nueva Devolución — File #${file.numero}</div>
            <button onclick="document.getElementById('modal-devolucion').style.display='none'" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:16px;">✕</button>
          </div>
          <form method="POST" action="/files/${id}/devoluciones">
            <div style="padding:20px;display:grid;gap:12px;">
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:12px;color:#991b1b;">
                <i class="fas fa-info-circle"></i> La devolución reduce la venta del file. Requiere aprobación de un gerente para impactar en caja.
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div>
                  <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">MONTO *</label>
                  <input type="number" name="monto" step="0.01" min="0.01" required class="form-control" style="font-size:13px;" placeholder="0.00">
                </div>
                <div>
                  <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">MONEDA</label>
                  <select name="moneda" class="form-control" style="font-size:13px;">
                    <option value="USD" ${file.moneda==='USD'?'selected':''}>USD</option>
                    <option value="UYU" ${file.moneda==='UYU'?'selected':''}>UYU</option>
                  </select>
                </div>
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">MÉTODO DE DEVOLUCIÓN</label>
                <select name="metodo" class="form-control" style="font-size:13px;">
                  <option value="transferencia">Transferencia bancaria</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                </select>
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">MOTIVO *</label>
                <textarea name="motivo" required class="form-control" rows="2" style="font-size:13px;" placeholder="Ej: Cancelación del viaje, cambio de servicio..."></textarea>
              </div>
              <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button type="button" onclick="document.getElementById('modal-devolucion').style.display='none'" class="btn btn-outline">Cancelar</button>
                <button type="submit" class="btn btn-sm" style="background:#dc2626;color:white;border:none;">
                  <i class="fas fa-paper-plane"></i> Solicitar Devolución
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <!-- Modal editar cliente desde file -->
      <div id="modal-editar-cliente" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:center;justify-content:center;padding:16px;">
        <div style="background:white;border-radius:14px;width:100%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="background:linear-gradient(135deg,#7B3FA0,#EC008C);border-radius:14px 14px 0 0;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
            <div style="color:white;font-size:15px;font-weight:700;"><i class="fas fa-user-edit"></i> Datos de ${esc(file.cliente_nombre)}</div>
            <button onclick="cerrarModalCliente()" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:16px;">✕</button>
          </div>
          <div style="padding:20px;">
            <div style="display:grid;gap:12px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div>
                  <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">TIPO DOC.</label>
                  <select id="mc-tipo-doc" class="form-control" style="font-size:13px;">
                    ${['CI','PAS','DNI','RUT','NIF','OTRO'].map(t => '<option value="' + t + '"' + (file.tipo_documento === t ? ' selected' : '') + '>' + t + '</option>').join('')}
                  </select>
                </div>
                <div>
                  <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">NRO. DOCUMENTO</label>
                  <input type="text" id="mc-nro-doc" class="form-control" style="font-size:13px;" value="${esc(file.nro_documento||'')}">
                </div>
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">VENCIMIENTO PASAPORTE</label>
                <input type="date" id="mc-vto-pas" class="form-control" style="font-size:13px;" value="${esc(file.vencimiento_pasaporte||'')}">
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">TELÉFONO</label>
                <input type="text" id="mc-telefono" class="form-control" style="font-size:13px;" value="${esc(file.cliente_tel||'')}">
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">EMAIL</label>
                <input type="email" id="mc-email" class="form-control" style="font-size:13px;" value="${esc(file.cliente_email||'')}">
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">FECHA DE NACIMIENTO</label>
                <input type="date" id="mc-fecha-nac" class="form-control" style="font-size:13px;" value="${esc(file.cliente_fecha_nac||'')}">
              </div>
            </div>
            <div id="mc-msg" style="margin-top:10px;font-size:12px;display:none;"></div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap;">
              <button onclick="cerrarModalCliente()" class="btn btn-outline">Cancelar</button>
              ${file.tipo_cliente !== 'empresa' ? `
              <button onclick="agregarComoPasajero()" class="btn btn-sm" style="background:#F7941D;color:white;border:none;">
                <i class="fas fa-user-plus"></i> Agregar como pasajero
              </button>` : ''}
              <button onclick="guardarCliente()" class="btn btn-primary"><i class="fas fa-save"></i> Guardar</button>
            </div>
          </div>
        </div>
      </div>
      <script>
        function abrirModalCliente() {
          document.getElementById('modal-editar-cliente').style.display = 'flex'
        }
        function cerrarModalCliente() {
          document.getElementById('modal-editar-cliente').style.display = 'none'
        }
        async function guardarCliente() {
          const msg = document.getElementById('mc-msg')
          msg.style.display = 'none'
          const body = {
            tipo_documento:       document.getElementById('mc-tipo-doc').value,
            nro_documento:        document.getElementById('mc-nro-doc').value,
            vencimiento_pasaporte: document.getElementById('mc-vto-pas').value,
            telefono:             document.getElementById('mc-telefono').value,
            email:                document.getElementById('mc-email').value,
            fecha_nacimiento:     document.getElementById('mc-fecha-nac').value,
          }
          try {
            const res = await fetch('/api/files/${file.id}/editar-cliente', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify(body)
            })
            const data = await res.json()
            if (data.ok) {
              msg.style.cssText = 'display:block;color:#059669;background:#f0fdf4;padding:8px;border-radius:6px;margin-top:10px;'
              msg.textContent = '✓ Datos guardados correctamente. Recargando...'
              setTimeout(() => location.reload(), 1000)
            } else {
              msg.style.cssText = 'display:block;color:#dc2626;background:#fef2f2;padding:8px;border-radius:6px;margin-top:10px;'
              msg.textContent = 'Error: ' + (data.error || 'Error desconocido')
            }
          } catch(e) {
            msg.style.cssText = 'display:block;color:#dc2626;background:#fef2f2;padding:8px;border-radius:6px;margin-top:10px;'
            msg.textContent = 'Error de conexión'
          }
        }
        document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModalCliente() })
        async function agregarComoPasajero() {
          const msg = document.getElementById('mc-msg')
          msg.style.display = 'none'
          if (!confirm('¿Crear pasajero con los datos de ${esc(file.cliente_nombre)}?')) return
          try {
            const res = await fetch('/clientes/${file.cliente_id}/agregar-pasajero', { method: 'POST' })
            // The route redirects, check final URL
            if (res.ok || res.redirected) {
              msg.style.cssText = 'display:block;color:#059669;background:#f0fdf4;padding:8px;border-radius:6px;margin-top:10px;'
              msg.textContent = '✓ Pasajero creado correctamente.'
              setTimeout(() => location.reload(), 1000)
            }
          } catch(e) {
            // Do a form POST instead
            const form = document.createElement('form')
            form.method = 'POST'
            form.action = '/clientes/${file.cliente_id}/agregar-pasajero'
            document.body.appendChild(form)
            form.submit()
          }
        }
      </script>
    `
    return c.html(baseLayout(`File #${file.numero}`, content, user, 'files'))
  } catch (e: any) {
    console.error('[FILE_DETAIL]', e.message)
    return c.html(baseLayout('File', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'files'))
  }
})

// ── POST /files/:id/devoluciones — Solicitar devolución ──────
files.post('/files/:id/devoluciones', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/login')
  const id = c.req.param('id')
  try {
    const b = await c.req.parseBody()
    const monto = Number(b.monto)
    if (!monto || monto <= 0) return c.redirect(`/files/${id}?error=monto_invalido`)
    const motivo = String(b.motivo || '').trim()
    if (!motivo) return c.redirect(`/files/${id}?error=motivo_requerido`)

    await c.env.DB.prepare(`
      INSERT INTO devoluciones (file_id, monto, moneda, motivo, metodo, estado, solicitado_por)
      VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
    `).bind(Number(id), monto, b.moneda || 'USD', motivo, b.metodo || 'transferencia', user.id).run()

    return c.redirect(`/files/${id}?ok=devolucion_solicitada`)
  } catch (e: any) {
    return c.redirect(`/files/${id}?error=1`)
  }
})

// ── POST /files/:id/devoluciones/:did/aprobar — Solo gerente ──
files.post('/files/:id/devoluciones/:did/aprobar', async (c) => {
  const user = await getUser(c)
  if (!user || !isGerente(user.rol)) return c.redirect(`/files/${c.req.param('id')}?error=sin_permiso`)
  const id  = c.req.param('id')
  const did = Number(c.req.param('did'))
  try {
    const dev = await c.env.DB.prepare(
      `SELECT * FROM devoluciones WHERE id = ? AND file_id = ? AND estado = 'pendiente'`
    ).bind(did, Number(id)).first() as any
    if (!dev) return c.redirect(`/files/${id}?error=devolucion_no_encontrada`)

    // 1. Registrar egreso en movimientos_caja
    const movRes = await c.env.DB.prepare(`
      INSERT INTO movimientos_caja (tipo, metodo, monto, moneda, concepto, file_id, usuario_id, fecha, anulado)
      VALUES ('egreso', ?, ?, ?, ?, ?, ?, datetime('now'), 0)
    `).bind(dev.metodo, dev.monto, dev.moneda,
      'Devolución aprobada: ' + (dev.motivo || ''), Number(id), user.id).run()

    // 2. Reducir total_venta del file
    await c.env.DB.prepare(
      `UPDATE files SET total_venta = MAX(0, total_venta - ?), updated_at = datetime('now') WHERE id = ?`
    ).bind(dev.monto, Number(id)).run()

    // 3. Marcar devolución como aprobada
    await c.env.DB.prepare(
      `UPDATE devoluciones SET estado = 'aprobada', aprobado_por = ?, movimiento_caja_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(user.id, movRes.meta?.last_row_id || null, did).run()

    return c.redirect(`/files/${id}?ok=devolucion_aprobada`)
  } catch (e: any) {
    return c.redirect(`/files/${id}?error=1`)
  }
})

// ── POST /files/:id/devoluciones/:did/rechazar — Solo gerente ─
files.post('/files/:id/devoluciones/:did/rechazar', async (c) => {
  const user = await getUser(c)
  if (!user || !isGerente(user.rol)) return c.redirect(`/files/${c.req.param('id')}?error=sin_permiso`)
  const id  = c.req.param('id')
  const did = Number(c.req.param('did'))
  try {
    await c.env.DB.prepare(
      `UPDATE devoluciones SET estado = 'rechazada', aprobado_por = ?, updated_at = datetime('now') WHERE id = ? AND file_id = ? AND estado = 'pendiente'`
    ).bind(user.id, did, Number(id)).run()
    return c.redirect(`/files/${id}?ok=devolucion_rechazada`)
  } catch (e: any) {
    return c.redirect(`/files/${id}?error=1`)
  }
})

// ── POST /api/files/:id/editar-cliente ───────────────────────
files.post('/api/files/:id/editar-cliente', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const fileId = Number(c.req.param('id'))
  try {
    const body = await c.req.json() as any
    const file = await c.env.DB.prepare('SELECT cliente_id FROM files WHERE id = ?').bind(fileId).first() as any
    if (!file) return c.json({ error: 'File no encontrado' }, 404)

    const clienteId = file.cliente_id
    const fields: string[] = []
    const vals: any[] = []

    if (body.email !== undefined)    { fields.push('email=?');    vals.push(body.email || null) }
    if (body.telefono !== undefined) { fields.push('telefono=?'); vals.push(body.telefono || null) }
    if (body.fecha_nacimiento !== undefined) { fields.push('fecha_nacimiento=?'); vals.push(body.fecha_nacimiento || null) }
    if (body.vencimiento_pasaporte !== undefined) { fields.push('vencimiento_pasaporte=?'); vals.push(body.vencimiento_pasaporte || null) }
    if (body.nro_documento !== undefined && body.tipo_documento !== undefined) {
      let nroDoc = String(body.nro_documento || '').trim()
      if (body.tipo_documento === 'CI' && nroDoc) {
        nroDoc = nroDoc.replace(/[^0-9]/g, '')
      } else {
        nroDoc = nroDoc.toUpperCase().replace(/[.\-\s]/g, '')
      }
      fields.push('tipo_documento=?', 'nro_documento=?')
      vals.push(body.tipo_documento, nroDoc)
    }

    if (fields.length === 0) return c.json({ ok: true })
    fields.push("updated_at=datetime('now')")
    vals.push(clienteId)
    await c.env.DB.prepare('UPDATE clientes SET ' + fields.join(', ') + ' WHERE id = ?').bind(...vals).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── POST /files/:id/compartir ────────────────────────────────
files.post('/files/:id/compartir', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')

  const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first() as any
  if (!file) return c.redirect('/files')

  // Permiso: dueño del file, o supervisor/admin/gerente
  const esOwner = user.id == file.vendedor_id
  if (!esOwner && !isSupervisorOrAbove(user.rol)) return c.redirect(`/files/${id}?error=sin_permiso`)

  // No se puede compartir un file anulado
  if (file.estado === 'anulado') return c.redirect(`/files/${id}?error=sin_permiso`)

  // File cerrado: solo supervisor/admin/gerente
  if (file.estado === 'cerrado' && !isSupervisorOrAbove(user.rol)) return c.redirect(`/files/${id}?error=sin_permiso`)

  const body = await c.req.parseBody()
  const vendedorId = Number(body.vendedor_id)
  if (!vendedorId || vendedorId === file.vendedor_id) return c.redirect(`/files/${id}`)

  // Verificar que el vendedor objetivo existe
  const vendedor = await c.env.DB.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1').bind(vendedorId).first()
  if (!vendedor) return c.redirect(`/files/${id}`)

  // Insertar o reemplazar (UNIQUE en file_id)
  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO file_compartido (file_id, vendedor_id, porcentaje, compartido_por)
    VALUES (?, ?, 50.0, ?)
  `).bind(id, vendedorId, user.id).run()

  return c.redirect(`/files/${id}`)
})

// ── POST /files/:id/compartir/quitar ────────────────────────
files.post('/files/:id/compartir/quitar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')

  const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first() as any
  if (!file) return c.redirect('/files')

  // REGLA: solo supervisor o gerente pueden quitar el compartido, sin importar el estado del file
  if (!isSupervisorOrAbove(user.rol)) return c.redirect(`/files/${id}?error=sin_permiso`)

  await c.env.DB.prepare('DELETE FROM file_compartido WHERE file_id = ?').bind(id).run()

  return c.redirect(`/files/${id}`)
})

// ══════════════════════════════════════════════════════════════
// ENDPOINTS DE PASAJEROS
// ══════════════════════════════════════════════════════════════

// Nota: /pasajeros/buscar está en pasajeros.ts (debe estar antes de /:id)

// Agregar pasajero al file (nuevo o existente)
files.post('/files/:id/pasajeros', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const accion    = String(body.accion || 'nuevo')
  const srvInline = body._srv_inline === '1'  // llamada desde modal de servicio (responde JSON)

  const errRedirect = (msg: string) =>
    srvInline ? c.json({ error: msg }, 400) : c.redirect(`/files/${id}?error=${encodeURIComponent(msg)}`)

  try {
    const fileCheck = await c.env.DB.prepare('SELECT estado FROM files WHERE id=?').bind(id).first() as any
    if (!fileCheck) return srvInline ? c.json({ error: 'File no encontrado' }, 404) : c.redirect('/files')
    if (fileCheck.estado === 'cerrado' || fileCheck.estado === 'anulado') {
      return errRedirect('file_bloqueado')
    }

    let pasajeroId: number

    if (accion === 'existente') {
      pasajeroId = Number(body.pasajero_id)
      if (!pasajeroId) return errRedirect('pax_no_seleccionado')
    } else {
      // Crear nuevo pasajero con nombre + apellido separados
      const nombre   = String(body.nombre   || body.nombre_completo || '').trim()
      const apellido = String(body.apellido || '').trim()
      if (!nombre) return errRedirect('nombre_requerido')

      // Validar fecha de nacimiento: no puede ser futura
      const hoyPax = new Date().toISOString().split('T')[0]
      if (body.fecha_nacimiento && String(body.fecha_nacimiento) > hoyPax) {
        return errRedirect('fecha_nacimiento_invalida')
      }

      const nc = apellido ? `${nombre} ${apellido}` : nombre

      const TIPOS_DOC_VALIDOS = ['CI', 'DNI', 'PAS', 'RUT', 'OTRO']
      const tipoDoc = TIPOS_DOC_VALIDOS.includes(String(body.tipo_documento)) ? String(body.tipo_documento) : 'CI'

      const result = await c.env.DB.prepare(`
        INSERT INTO pasajeros (nombre, apellido, nombre_completo,
          tipo_documento, nro_documento, fecha_nacimiento,
          vencimiento_pasaporte, nacionalidad, email, telefono,
          preferencias_comida, millas_aerolineas)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        nombre, apellido || null, nc,
        tipoDoc,
        body.nro_documento ? String(body.nro_documento).trim().substring(0, 50) : null,
        body.fecha_nacimiento || null,
        body.vencimiento_pasaporte || null,
        body.nacionalidad ? String(body.nacionalidad).trim().substring(0, 100) : null,
        body.email ? String(body.email).trim().substring(0, 200) : null,
        body.telefono ? String(body.telefono).trim().substring(0, 50) : null,
        body.preferencias_comida ? String(body.preferencias_comida).trim().substring(0, 200) : null,
        body.millas_aerolineas ? String(body.millas_aerolineas).trim().substring(0, 100) : null
      ).run()
      pasajeroId = result.meta.last_row_id as number
    }

    // Calcular orden
    const countRow = await c.env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM file_pasajeros WHERE file_id=?'
    ).bind(id).first() as any
    const orden = Number(countRow?.cnt || 0)

    // Insertar en file_pasajeros (ignorar si ya existe)
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO file_pasajeros (file_id, pasajero_id, rol, grupo, orden)
      VALUES (?,?,?,?,?)
    `).bind(id, pasajeroId, body.rol || 'acompañante', body.grupo || null, orden).run()

    // Respuesta: JSON para llamadas inline, redirect para form normal
    if (srvInline) {
      const pax = await c.env.DB.prepare('SELECT * FROM pasajeros WHERE id=?').bind(pasajeroId).first() as any
      return c.json({ ok: true, id: pasajeroId, nombre_completo: pax?.nombre_completo || '' })
    }
    return c.redirect(`/files/${id}`)
  } catch (e: any) {
    console.error('[PASAJERO]', e.message)
    return errRedirect('error_interno')
  }
})

// Quitar pasajero del file (DELETE /files/pasajeros/:fpId)
files.delete('/files/pasajeros/:fpId', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const fpId = c.req.param('fpId')
  try {
    // Verificar que el file no está bloqueado
    const fp = await c.env.DB.prepare(
      'SELECT fp.file_id, f.estado FROM file_pasajeros fp JOIN files f ON fp.file_id=f.id WHERE fp.id=?'
    ).bind(fpId).first() as any
    if (!fp) return c.json({ error: 'No encontrado' }, 404)
    if (fp.estado === 'cerrado' || fp.estado === 'anulado') {
      return c.json({ error: 'File bloqueado' }, 403)
    }
    await c.env.DB.prepare('DELETE FROM file_pasajeros WHERE id=?').bind(fpId).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: "Error interno del servidor" }, 500)
  }
})

// ── Editar servicio (POST /servicios/:id/editar) ──────────────────────────
files.post('/servicios/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const svcId = c.req.param('id')
  const body  = await c.req.parseBody()

  try {
    // Traer servicio para saber el file_id
    const svc = await c.env.DB.prepare('SELECT file_id FROM servicios WHERE id=?').bind(svcId).first() as any
    if (!svc) return c.redirect('/files')
    const fileId = svc.file_id

    // Verificar que el file no esté bloqueado
    const fileCheck = await c.env.DB.prepare('SELECT estado FROM files WHERE id=?').bind(fileId).first() as any
    if (fileCheck && (fileCheck.estado === 'cerrado' || fileCheck.estado === 'anulado')) {
      return c.redirect(`/files/${fileId}?error=file_bloqueado`)
    }

    // Cantidad de pasajeros
    const paxIdsRaw    = body['pax_ids']
    const paxIds: number[] = paxIdsRaw
      ? (Array.isArray(paxIdsRaw) ? paxIdsRaw : [paxIdsRaw]).map(Number).filter(n => n > 0)
      : []
    const cantPax = paxIds.length > 0 ? paxIds.length : Number(body.cantidad_pasajeros || 1)

    // UPDATE servicio
    await c.env.DB.prepare(`
      UPDATE servicios SET
        tipo_servicio       = ?,
        descripcion         = ?,
        proveedor_id        = ?,
        operador_id         = ?,
        destino_codigo      = ?,
        nro_ticket          = ?,
        nro_factura_proveedor     = ?,
        fecha_factura_proveedor   = ?,
        fecha_inicio        = ?,
        fecha_fin           = ?,
        costo_original      = ?,
        moneda_origen       = ?,
        precio_venta        = ?,
        requiere_prepago    = ?,
        fecha_limite_prepago = ?,
        notas               = ?,
        cantidad_pasajeros  = ?
      WHERE id = ?
    `).bind(
      body.tipo_servicio,
      body.descripcion,
      body.proveedor_id  || null,
      body.operador_id   || null,
      body.destino_codigo || null,
      body.nro_ticket    || null,
      body.nro_factura_proveedor   || null,
      body.fecha_factura_proveedor || null,
      body.fecha_inicio  || null,
      body.fecha_fin     || null,
      Number(body.costo_original  || 0),
      body.moneda_origen || 'USD',
      Number(body.precio_venta    || 0),
      body.requiere_prepago ? 1 : 0,
      body.fecha_limite_prepago || null,
      body.notas         || null,
      cantPax,
      svcId
    ).run()

    // Actualizar pasajeros del servicio (reemplazar)
    if (paxIds.length > 0) {
      await c.env.DB.prepare('DELETE FROM servicio_pasajeros WHERE servicio_id=?').bind(svcId).run()
      for (const pid of paxIds) {
        await c.env.DB.prepare(
          'INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES (?,?)'
        ).bind(svcId, pid).run()
      }
    }

    await recalcularTotalesFile(c.env.DB, Number(fileId))
    return c.redirect(`/files/${fileId}`)
  } catch (e: any) {
    console.error('[EDITAR SERVICIO]', e.message)
    const svc2 = await c.env.DB.prepare('SELECT file_id FROM servicios WHERE id=?').bind(svcId).first() as any
    return c.redirect(`/files/${svc2?.file_id || ''}?error=error_interno`)
  }
})

// Asignar pasajeros a un servicio (POST /servicios/:id/pasajeros)
files.post('/servicios/:id/pasajeros', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const servicioId = c.req.param('id')
  try {
    const body = await c.req.json() as { pasajero_ids: number[] }
    const ids = (body.pasajero_ids || []).filter(Number.isInteger)

    // Borrar asignaciones anteriores
    await c.env.DB.prepare('DELETE FROM servicio_pasajeros WHERE servicio_id=?').bind(servicioId).run()

    // Insertar las nuevas
    for (const pid of ids) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES (?,?)'
      ).bind(servicioId, pid).run()
    }
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: "Error interno del servidor" }, 500)
  }
})

// Crear servicio
files.post('/files/:id/servicios', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const body = await c.req.parseBody()

  try {
    // Verificar que el file no está cerrado o anulado
    const fileCheck = await c.env.DB.prepare('SELECT estado FROM files WHERE id = ?').bind(id).first() as any
    if (fileCheck && (fileCheck.estado === 'cerrado' || fileCheck.estado === 'anulado')) {
      return c.redirect(`/files/${id}?error=file_bloqueado`)
    }

    // ── Auto-agregar titular del file como pasajero si no existe aún ──
    const fileData = await c.env.DB.prepare(`
      SELECT f.id, f.cliente_id,
        COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre,
        c.tipo_documento, c.nro_documento
      FROM files f
      JOIN clientes c ON c.id = f.cliente_id
      WHERE f.id = ?
    `).bind(id).first() as any

    if (fileData?.cliente_id) {
      // Verificar si ya existe un pasajero titular vinculado al cliente del file
      const titularExistente = await c.env.DB.prepare(`
        SELECT fp.pasajero_id FROM file_pasajeros fp
        JOIN pasajeros p ON p.id = fp.pasajero_id
        WHERE fp.file_id = ? AND fp.rol = 'titular'
          AND (p.cliente_id = ? OR p.nombre_completo = ?)
        LIMIT 1
      `).bind(id, fileData.cliente_id, fileData.cliente_nombre).first() as any

      if (!titularExistente) {
        // Buscar si ya existe un pasajero con ese cliente_id
        let pasajeroId: number | null = null
        const pasajeroExistente = await c.env.DB.prepare(
          'SELECT id FROM pasajeros WHERE cliente_id = ? LIMIT 1'
        ).bind(fileData.cliente_id).first() as any

        if (pasajeroExistente) {
          pasajeroId = pasajeroExistente.id
        } else {
          // Crear pasajero desde los datos del cliente
          const partes = (fileData.cliente_nombre || '').split(' ')
          const nombre  = partes[0] || fileData.cliente_nombre
          const apellido = partes.slice(1).join(' ') || ''
          // Normalizar tipo_documento: pasajeros solo acepta CI/PAS/DNI/OTRO
          // RUT y NIF son tipos de empresa → se guardan como OTRO
          const TIPOS_PAX_VALIDOS = ['CI', 'PAS', 'DNI', 'OTRO']
          const tipoDocPax = TIPOS_PAX_VALIDOS.includes(fileData.tipo_documento) ? fileData.tipo_documento : 'OTRO'
          const nuevoPax = await c.env.DB.prepare(`
            INSERT INTO pasajeros (nombre_completo, nombre, apellido, tipo_documento, nro_documento, cliente_id)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(fileData.cliente_nombre, nombre, apellido,
              tipoDocPax, fileData.nro_documento || null,
              fileData.cliente_id).run()
          pasajeroId = nuevoPax.meta.last_row_id as number
        }

        // Agregar al file como titular
        await c.env.DB.prepare(`
          INSERT OR IGNORE INTO file_pasajeros (file_id, pasajero_id, rol, orden)
          VALUES (?, ?, 'titular', 1)
        `).bind(id, pasajeroId).run()
      }
    }

    // Ids de pasajeros del file seleccionados en el modal (checkboxes name="pax_ids")
    // parseBody devuelve string o string[] según cuántos haya
    const paxIdsRaw = body['pax_ids']
    const paxIds: number[] = paxIdsRaw
      ? (Array.isArray(paxIdsRaw) ? paxIdsRaw : [paxIdsRaw]).map(Number).filter(n => n > 0)
      : []

    // Si no se seleccionaron pasajeros manualmente, incluir automáticamente el titular
    let paxIdsFinales = [...paxIds]
    if (paxIdsFinales.length === 0 && fileData?.cliente_id) {
      const titular = await c.env.DB.prepare(`
        SELECT fp.pasajero_id FROM file_pasajeros fp
        WHERE fp.file_id = ? AND fp.rol = 'titular' LIMIT 1
      `).bind(id).first() as any
      if (titular) paxIdsFinales = [titular.pasajero_id]
    }

    // Cantidad de pasajeros (puede venir del input o inferirse del count de ids)
    const cantPax = paxIdsFinales.length > 0 ? paxIdsFinales.length : Number(body.cantidad_pasajeros || 1)

    // Validar solo que fecha_fin no sea anterior a fecha_inicio (si ambas están presentes)
    if (body.fecha_inicio && body.fecha_fin && String(body.fecha_fin) < String(body.fecha_inicio)) {
      return c.redirect(`/files/${id}?error=fechas_inconsistentes`)
    }

    const result = await c.env.DB.prepare(`
      INSERT INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id,
        destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen,
        precio_venta, requiere_prepago, fecha_limite_prepago, notas, cantidad_pasajeros,
        nro_factura_proveedor, fecha_factura_proveedor)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id, body.tipo_servicio, body.descripcion,
      body.proveedor_id || null, body.operador_id || null,
      body.destino_codigo || null, body.nro_ticket || null,
      body.fecha_inicio || null, body.fecha_fin || null,
      Number(body.costo_original || 0), body.moneda_origen || 'USD',
      Number(body.precio_venta || 0), body.requiere_prepago ? 1 : 0,
      body.fecha_limite_prepago || null, body.notas || null,
      cantPax,
      body.nro_factura_proveedor   || null,
      body.fecha_factura_proveedor || null
    ).run()

    const servicioId = result.meta.last_row_id as number

    // Asociar pasajeros seleccionados al servicio
    for (const pid of paxIdsFinales) {
      await c.env.DB.prepare(
        'INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES (?,?)'
      ).bind(servicioId, pid).run()
    }

    // Actualizar totales del file
    await recalcularTotalesFile(c.env.DB, Number(id))
    return c.redirect(`/files/${id}`)
  } catch (e: any) {
    console.error('[SERVICIO]', e.message)
    const msg = encodeURIComponent(e.message || 'error_desconocido')
    return c.redirect(`/files/${id}?error=error_interno&msg=${msg}`)
  }
})

// Editar file
files.get('/files/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')

  try {
    const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first() as any
    // Supervisor y vendedor solo pueden editar sus propios files; admin/gerente pueden editar todos
    if (!file || (!canSeeAllFiles(user.rol) && file.vendedor_id != user.id)) return c.redirect('/files')
    // Los supervisores NO pueden editar archivos cerrados
    if (file.estado === 'cerrado' && user.rol === 'supervisor') return c.redirect(`/files/${id}`)

    const destinoPrincipal = file.destino_principal || ''
    const [[clientes, vendedores], destinoRow] = await Promise.all([
      Promise.all([
        c.env.DB.prepare(`SELECT id, IFNULL(tipo_cliente,'persona_fisica') as tipo_cliente, COALESCE(nombre || ' ' || apellido, nombre_completo) as nombre_completo FROM clientes ORDER BY apellido, nombre`).all(),
        c.env.DB.prepare('SELECT id, nombre FROM usuarios WHERE activo=1').all(),
      ]),
      destinoPrincipal
        ? c.env.DB.prepare('SELECT name FROM destinos WHERE code = ?').bind(destinoPrincipal.toUpperCase()).first()
        : Promise.resolve(null),
    ])
    const destinoRow2 = destinoRow as any
    let destinoDisplay = destinoPrincipal
      ? (destinoRow2 ? `${destinoPrincipal.toUpperCase()} — ${destinoRow2.name}` : destinoPrincipal)
      : ''

    const content = `
      <div style="max-width:700px;">
        <a href="/files/${id}" style="color:#7B3FA0;font-size:13px;margin-bottom:20px;display:block;"><i class="fas fa-arrow-left"></i> Volver</a>
        <div class="card">
          <div class="card-header">
            <span class="card-title">Editar File #${file.numero}</span>
          </div>
          <div class="card-body">
            <form method="POST" action="/files/${id}/editar" onsubmit="return validarFechaViajeEdit(document.getElementById('inp-fecha-viaje-edit'))">
              <input type="hidden" name="_method" value="PUT">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">CLIENTE</label>
                  <select name="cliente_id" class="form-control">
                    ${clientes.results.map((cl: any) => `<option value="${cl.id}" ${cl.id==file.cliente_id?'selected':''}>${cl.tipo_cliente === 'empresa' ? '🏢 ' : ''}${cl.nombre_completo}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">VENDEDOR</label>
                  <select name="vendedor_id" class="form-control" ${!canReopenFile(user.rol)?'disabled':''}>
                    ${vendedores.results.map((v: any) => `<option value="${v.id}" ${v.id==file.vendedor_id?'selected':''}>${v.nombre}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">DESTINO</label>
                  ${destinoAutocomplete({ name: 'destino_principal', id: 'dest-editar', value: esc(file.destino_principal)||'', placeholder: 'Ej: CUN — Cancún, MVD — Montevideo...' })}
                  <script>
                    // Set display value with name if available
                    (function(){
                      const inp = document.getElementById('dest-editar-input')
                      if (inp && inp.value) {
                        const display = ${JSON.stringify(destinoDisplay)}
                        if (display && display !== inp.value) inp.value = display
                      }
                    })()
                  </script>
                </div>
                <div class="form-group">
                  <label class="form-label">FECHA VIAJE</label>
                  <input type="date" name="fecha_viaje" id="inp-fecha-viaje-edit" value="${file.fecha_viaje||''}" class="form-control" oninput="validarFechaViajeEdit(this)">
                  <div id="err-fecha-viaje-edit" style="display:none;font-size:11px;color:#dc2626;margin-top:3px;"><i class="fas fa-exclamation-circle"></i> La fecha de viaje no puede ser anterior a hoy.</div>
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">ESTADO</label>
                  <select name="estado" class="form-control" ${!canAnularFile(user.rol) ? 'disabled' : ''}>
                    ${[['en_proceso','En Proceso'],['seniado','Se\u00f1ado'],['cerrado','Cerrado'],['anulado','Anulado']].map(([v,l]) => `<option value="${v}" ${v===file.estado?'selected':''}>${l}</option>`).join('')}
                  </select>
                  ${!canAnularFile(user.rol) ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;"><i class="fas fa-lock"></i> Solo gerente o administración puede cambiar el estado desde aquí</div>` : ''}
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA</label>
                  <select name="moneda" class="form-control">
                    <option value="USD" ${file.moneda==='USD'?'selected':''}>USD</option>
                    <option value="UYU" ${file.moneda==='UYU'?'selected':''}>UYU</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">NOTAS</label>
                <textarea name="notas" rows="3" class="form-control">${esc(file.notas)||''}</textarea>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar cambios</button>
                <a href="/files/${id}" class="btn btn-outline">Cancelar</a>
              </div>
            </form>
          </div>
        </div>
      </div>
    `
    return c.html(baseLayout('Editar File', content, user, 'files'))
  } catch (e: any) {
    return c.redirect('/files')
  }
})

files.post('/files/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const body = await c.req.parseBody()

  try {
    // Solo admin/gerente pueden reasignar vendedor; supervisor y vendedor conservan el original
    const vId = canReopenFile(user.rol) ? body.vendedor_id : user.id
    // Solo admin/gerente pueden cambiar estado desde el formulario de edición
    const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first() as any
    const nuevoEstado = canAnularFile(user.rol) ? body.estado : file?.estado

    // Validar fecha_viaje: no puede ser pasada
    const hoyFileEdit = new Date().toISOString().split('T')[0]
    if (body.fecha_viaje && String(body.fecha_viaje) < hoyFileEdit) {
      return c.redirect(`/files/${id}/editar?error=fecha_viaje_pasada`)
    }

    await c.env.DB.prepare(`
      UPDATE files SET cliente_id=?, vendedor_id=?, estado=?, destino_principal=?, fecha_viaje=?, moneda=?, notas=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(body.cliente_id, vId, nuevoEstado, body.destino_principal||null, body.fecha_viaje||null, body.moneda, body.notas||null, id).run()
    return c.redirect(`/files/${id}`)
  } catch (e: any) {
    return c.redirect(`/files/${id}`)
  }
})

// Cambio de estado del file
files.post('/files/:id/estado', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const nuevoEstado = String(body.estado || '')
  const estadosValidos = ['en_proceso', 'seniado', 'cerrado', 'anulado']

  try {
    const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first() as any
    if (!file) return c.redirect('/files')

    // ── Control de acceso por rol ──────────────────────────────
    // Vendedor solo puede modificar sus propios files
    if (!canSeeAllFiles(user.rol) && file.vendedor_id != user.id) return c.redirect('/files')
    // Supervisor solo puede cambiar estado de files que le pertenecen o son de su equipo
    // (supervisor ve todos pero para cambiar estado debe ser el vendedor o tener rol superior)
    if (user.rol === 'supervisor' && file.vendedor_id != user.id && !canAnularFile(user.rol)) {
      // Supervisor puede cambiar estado de CUALQUIER file (es su función de supervisión)
      // pero no puede anular ni reabrir cerrados — se controla abajo
    }

    // Solo gerente y administración pueden anular
    if (nuevoEstado === 'anulado' && !canAnularFile(user.rol)) {
      return c.redirect(`/files/${id}?error=sin_permiso`)
    }

    // No se puede anular si hay servicios activos (no cancelados)
    if (nuevoEstado === 'anulado') {
      const serviciosActivos = await c.env.DB.prepare(
        `SELECT COUNT(*) as total FROM servicios WHERE file_id = ? AND estado != 'cancelado'`
      ).bind(id).first() as any
      if (Number(serviciosActivos?.total || 0) > 0) {
        return c.redirect(`/files/${id}?error=servicios_activos`)
      }
      // Si hay servicios pagados al proveedor, NADIE puede anular — hay que desimputar primero
      const serviciosPagados = await c.env.DB.prepare(
        `SELECT COUNT(*) as total FROM servicios WHERE file_id = ? AND (prepago_realizado = 1 OR estado_pago_proveedor = 'pagado')`
      ).bind(id).first() as any
      if (Number(serviciosPagados?.total || 0) > 0) {
        return c.redirect(`/files/${id}?error=servicios_pagados_desimputar`)
      }
    }

    // Solo gerente y administración pueden reabrir un file cerrado
    if (file.estado === 'cerrado' && nuevoEstado !== 'cerrado' && !canReopenFile(user.rol)) {
      return c.redirect(`/files/${id}?error=sin_permiso`)
    }

    if (!estadosValidos.includes(nuevoEstado)) return c.redirect(`/files/${id}`)

    // Vendedores NO pueden cerrar con utilidad negativa
    // Supervisores, administración y gerentes SÍ pueden (supervisor tiene esa autorización)
    if (nuevoEstado === 'cerrado' && !canCloseAtLoss(user.rol)) {
      const utilidad = Number(file.total_venta || 0) - Number(file.total_costo || 0)
      if (utilidad < 0) return c.redirect(`/files/${id}?error=utilidad_negativa`)
    }
    // Supervisor puede cerrar con pérdida pero se registra que fue autorizado
    if (nuevoEstado === 'cerrado' && user.rol === 'supervisor') {
      const utilidad = Number(file.total_venta || 0) - Number(file.total_costo || 0)
      // Si hay pérdida, agregar nota de autorización
      if (utilidad < 0) {
        const notaActual = file.notas || ''
        const notaAuth = `\n[Cierre autorizado con pérdida por ${user.nombre} (supervisor) el ${new Date().toLocaleDateString('es-UY')}]`
        if (!notaActual.includes('Cierre autorizado con pérdida')) {
          await c.env.DB.prepare(`UPDATE files SET notas=?, updated_at=datetime('now') WHERE id=?`)
            .bind((notaActual + notaAuth).trim(), id).run()
        }
      }
    }

    await c.env.DB.prepare(`UPDATE files SET estado=?, updated_at=datetime('now') WHERE id=?`).bind(nuevoEstado, id).run()
    return c.redirect(`/files/${id}`)
  } catch {
    return c.redirect(`/files/${id}`)
  }
})

// Voucher
files.get('/files/:id/voucher', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')

  try {
    const file = await c.env.DB.prepare(`
      SELECT f.*, c.nombre_completo, c.email as cli_email, c.telefono as cli_tel, c.nro_documento, c.tipo_documento
      FROM files f JOIN clientes c ON f.cliente_id = c.id WHERE f.id = ?
    `).bind(id).first() as any

    if (!file || (!canSeeAllFiles(user.rol) && file.vendedor_id != user.id)) return c.redirect('/files')

    const servicios = await c.env.DB.prepare(`
      SELECT s.*, p.nombre as proveedor_nombre, o.nombre as operador_nombre
      FROM servicios s LEFT JOIN proveedores p ON s.proveedor_id = p.id LEFT JOIN operadores o ON s.operador_id = o.id
      WHERE s.file_id = ? AND s.estado != 'cancelado' ORDER BY s.fecha_inicio ASC
    `).bind(id).all()

    // Cantidad total de pasajeros del file
    const paxCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM file_pasajeros WHERE file_id=?'
    ).bind(id).first() as any
    const cantPasajeros = Number(paxCount?.cnt || 1)

    const iconoSvg: Record<string, string> = {
      aereo: '✈', hotel: '🏨', traslado: '🚗', tour: '🗺', seguro: '🛡', otro: '📋'
    }

    const serviciosVoucherHtml = servicios.results.map((s: any) => `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:18px;">${iconoSvg[s.tipo_servicio] || '📋'}</span>
          <strong style="color:#5a2d75;font-size:14px;">${esc(s.tipo_servicio).toUpperCase()} · ${esc(s.descripcion)}</strong>
          ${s.nro_ticket ? `<span style="font-size:11px;background:#f3e8ff;color:#7B3FA0;padding:2px 8px;border-radius:10px;font-weight:700;">Ticket: ${esc(s.nro_ticket)}</span>` : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:12px;color:#6b7280;">
          ${s.operador_nombre ? `<span><strong>Operador:</strong> ${esc(s.operador_nombre)}</span>` : ''}
          ${s.destino_codigo ? `<span><strong>Destino:</strong> ${esc(s.destino_codigo)}</span>` : ''}
          ${s.fecha_inicio ? `<span><strong>Desde:</strong> ${esc(s.fecha_inicio)}</span>` : ''}
          ${s.fecha_fin ? `<span><strong>Hasta:</strong> ${esc(s.fecha_fin)}</span>` : ''}
        </div>
        ${s.notas ? `<div style="margin-top:6px;font-size:11px;color:#9ca3af;font-style:italic;">${esc(s.notas)}</div>` : ''}
      </div>
    `).join('')

    const voucherHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Voucher #${file.numero} - Dr. Viaje</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f0fa;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .voucher {
      max-width: 750px; margin: 20px auto; background: white;
      border-radius: 16px; overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .header {
      background: linear-gradient(135deg, #5a2d75, #7B3FA0) !important;
      padding: 28px 32px;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .destino-bar {
      background: linear-gradient(135deg, #F7941D, #EC008C) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .total-bar {
      background: linear-gradient(135deg, #5a2d75, #7B3FA0) !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .pax-box {
      border: 2px solid #f3e8ff;
      background: #faf7ff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .section-title {
      font-size: 11px; font-weight: 700; color: #9ca3af;
      letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 8px;
    }
    .body { padding: 32px; }
    .watermark {
      position: absolute; opacity: 0.04; font-size: 80px; font-weight: 900;
      color: #7B3FA0; pointer-events: none;
      top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg);
    }
    @media print {
      .no-print { display: none !important; }
      body { margin: 0; background: white; }
      .voucher { margin: 0; border-radius: 0; box-shadow: none; max-width: 100%; }
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align:center;padding:16px;background:#5a2d75;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <button onclick="window.print()" style="background:#F7941D;color:white;border:none;padding:10px 24px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;">
      🖨 Imprimir / Guardar PDF
    </button>
    <a href="/files/${id}" style="color:white;margin-left:16px;font-size:13px;">← Volver al File</a>
  </div>

  <div class="voucher" style="position:relative;">
    <div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;">
      <div class="watermark">DR.VIAJE</div>
    </div>

    <!-- Header -->
    <div class="header">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;">
        <div>
          <div style="color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:2px;margin-bottom:4px;">SERVICIOS CONTRATADOS</div>
          <div style="color:#ffffff;font-size:26px;font-weight:800;">File #${file.numero}</div>
          <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px;">${new Date().toLocaleDateString('es-UY', {day:'2-digit',month:'long',year:'numeric'})}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:800;">
            <span style="color:#F7941D;">Dr.</span><span style="color:#ffffff;">Viaje</span><span style="color:#EC008C;">.com</span>
          </div>
          <div style="color:rgba(255,255,255,0.65);font-size:11px;margin-top:4px;">drviaje.com · @drviaje.uy</div>
          <div style="color:rgba(255,255,255,0.65);font-size:11px;">+598 9668 3276</div>
          <div style="color:rgba(255,255,255,0.65);font-size:11px;">Colonia 820, Montevideo</div>
        </div>
      </div>
    </div>

    <div class="body">

      <!-- Datos del pasajero -->
      <div class="pax-box" style="border-radius:10px;padding:16px;margin-bottom:20px;">
        <div class="section-title">Datos del Pasajero</div>
        <div style="font-size:18px;font-weight:800;color:#5a2d75;margin-bottom:8px;">${esc(file.nombre_completo)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px;color:#6b7280;">
          <span>👥 Cantidad de pasajeros: <strong style="color:#374151;">${cantPasajeros}</strong></span>
          ${file.fecha_viaje ? `<span>📅 Fecha de viaje: <strong style="color:#374151;">${esc(file.fecha_viaje)}</strong></span>` : ''}
        </div>
      </div>

      <!-- Destino -->
      ${file.destino_principal ? `
        <div class="destino-bar" style="padding:12px 16px;border-radius:10px;margin-bottom:20px;text-align:center;">
          <div style="color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:2px;">DESTINO</div>
          <div style="color:#ffffff;font-size:20px;font-weight:800;">✈ ${esc(file.destino_principal)}</div>
        </div>
      ` : ''}

      <!-- Servicios -->
      <div style="margin-bottom:20px;">
        <div class="section-title">Servicios Incluidos</div>
        ${serviciosVoucherHtml}
      </div>

      <!-- Total -->
      <div class="total-bar" style="border-radius:10px;padding:16px 20px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
        <div style="color:rgba(255,255,255,0.85);font-size:13px;font-weight:600;letter-spacing:0.5px;">PRECIO TOTAL</div>
        <div style="font-size:24px;font-weight:800;">
          <span style="color:#F7941D;">$${Number(file.total_venta||0).toLocaleString('es-UY')}</span>
          <span style="font-size:14px;color:rgba(255,255,255,0.75);margin-left:6px;">${esc(file.moneda||'USD')}</span>
        </div>
      </div>

      <!-- Footer -->
      <div style="border-top:2px solid #f3e8ff;padding-top:16px;text-align:center;">
        <div style="color:#9ca3af;font-size:11px;margin-bottom:4px;">Dr. Viaje · Agencia de Viajes · Colonia 820, Montevideo, Uruguay</div>
        <div style="color:#9ca3af;font-size:11px;">📱 +598 9668 3276 · 🌐 drviaje.com · 📸 @drviaje.uy</div>
        <div style="margin-top:10px;color:#374151;font-size:12px;font-weight:700;">Esta reserva está confirmada.</div>
        <div style="margin-top:6px;color:#6b7280;font-size:10px;line-height:1.6;max-width:500px;margin-left:auto;margin-right:auto;">
          Las reservas efectuadas y boletos aéreos emitidos pueden generar multas y penalidades por cambios.
          Consulte con su agente de viajes en caso de requerir más información.
        </div>
      </div>

    </div>
  </div>
</body>
</html>`

    return c.html(voucherHtml)
  } catch (e: any) {
    return c.redirect(`/files/${id}`)
  }
})

// Marcar prepago realizado (sincroniza ambos campos)
files.post('/servicios/:id/prepago', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare(
    `UPDATE servicios SET prepago_realizado = 1, estado_pago_proveedor = 'pagado' WHERE id = ?`
  ).bind(id).run()
  return c.json({ ok: true })
})

// Eliminar servicio (bloqueo si file cerrado/anulado o servicio pagado)
files.delete('/servicios/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const id = c.req.param('id')
  const servicio = await c.env.DB.prepare(
    `SELECT s.file_id, s.estado_pago_proveedor, s.prepago_realizado, f.estado as file_estado
     FROM servicios s JOIN files f ON s.file_id = f.id WHERE s.id = ?`
  ).bind(id).first() as any

  if (!servicio) return c.json({ error: 'No encontrado' }, 404)
  // Bloquear si servicio ya fue pagado al proveedor
  if (servicio.estado_pago_proveedor === 'pagado' || servicio.prepago_realizado === 1) {
    return c.json({ error: 'No se puede eliminar: el servicio ya fue pagado al proveedor' }, 403)
  }
  // Bloquear si el file está cerrado o anulado
  if (servicio.file_estado === 'cerrado' || servicio.file_estado === 'anulado') {
    return c.json({ error: 'No se puede eliminar: el file está ' + servicio.file_estado }, 403)
  }

  await c.env.DB.prepare('DELETE FROM servicios WHERE id = ?').bind(id).run()
  await recalcularTotalesFile(c.env.DB, servicio.file_id)
  return c.json({ ok: true })
})

async function recalcularTotalesFile(db: D1Database, fileId: number) {
  const totales = await db.prepare(`
    SELECT COALESCE(SUM(precio_venta), 0) as total_venta, COALESCE(SUM(costo_original), 0) as total_costo
    FROM servicios WHERE file_id = ?
  `).bind(fileId).first() as any
  await db.prepare(`
    UPDATE files SET total_venta = ?, total_costo = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(totales?.total_venta || 0, totales?.total_costo || 0, fileId).run()
}

// ── Liquidación Interna (solo admin/gerente) ──────────────────────────────────
files.get('/files/:id/liquidacion-interna', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/files')
  const id = c.req.param('id')

  try {
    const file = await c.env.DB.prepare(`
      SELECT f.*, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre,
             u.nombre as vendedor_nombre
      FROM files f
      JOIN clientes c ON f.cliente_id = c.id
      JOIN usuarios u ON f.vendedor_id = u.id
      WHERE f.id = ?
    `).bind(id).first() as any
    if (!file) return c.redirect('/files')

    const servicios = await c.env.DB.prepare(`
      SELECT s.*, p.nombre as proveedor_nombre, o.nombre as operador_nombre
      FROM servicios s
      LEFT JOIN proveedores p ON s.proveedor_id = p.id
      LEFT JOIN operadores o  ON s.operador_id  = o.id
      WHERE s.file_id = ? AND s.estado != 'cancelado'
      ORDER BY s.fecha_inicio ASC, s.id ASC
    `).bind(id).all()

    const svcs = servicios.results as any[]
    const totalCosto  = svcs.reduce((s, x) => s + (Number(x.costo_original) || 0), 0)
    const totalVenta  = svcs.reduce((s, x) => s + (Number(x.precio_venta)   || 0), 0)
    const totalUtil   = totalVenta - totalCosto
    const pctUtil     = totalCosto > 0 ? ((totalUtil / totalCosto) * 100).toFixed(1) : '—'

    const iconoTipo: Record<string, string> = {
      aereo: '✈', hotel: '🏨', traslado: '🚗', tour: '🗺', seguro: '🛡', otro: '📋'
    }

    const filasSvcs = svcs.map((s: any, idx: number) => {
      const costo = Number(s.costo_original) || 0
      const venta = Number(s.precio_venta)   || 0
      const util  = venta - costo
      const pct   = costo > 0 ? ((util / costo) * 100).toFixed(1) + '%' : '—'
      const bgRow = idx % 2 === 0 ? '#ffffff' : '#f0f4f8'
      const fmtFecha = (f: string) => f ? f.split('-').reverse().join('/') : ''
      const fechas = s.fecha_inicio
        ? (s.fecha_fin && s.fecha_fin !== s.fecha_inicio
            ? `${fmtFecha(s.fecha_inicio)} - ${fmtFecha(s.fecha_fin)}`
            : fmtFecha(s.fecha_inicio))
        : '—'
      return `
        <tr style="background:${bgRow} !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:middle;">
            <span style="font-size:13px;line-height:1;">${iconoTipo[s.tipo_servicio] || '📋'}</span>
            <span style="font-weight:700;color:#1e3a5f;font-size:11px;margin-left:4px;">${esc((s.tipo_servicio || '').toUpperCase())}</span>
            ${s.descripcion ? `<div style="font-size:10px;color:#475569;margin-top:2px;">${esc(s.descripcion)}</div>` : ''}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:middle;text-align:center;">
            ${s.nro_ticket
              ? `<div style="display:inline-block;background:#1e3a5f !important;color:white !important;font-size:11px;font-weight:800;padding:4px 10px;border-radius:5px;letter-spacing:0.8px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
                  ${esc(s.nro_ticket)}
                </div>`
              : '<span style="color:#cbd5e1;font-size:11px;">—</span>'}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#374151;vertical-align:middle;">
            ${s.proveedor_nombre ? `<div style="font-weight:600;color:#1e3a5f;">${esc(s.proveedor_nombre)}</div>` : '<span style="color:#cbd5e1;">—</span>'}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#374151;vertical-align:middle;">
            ${s.operador_nombre ? `<div style="font-weight:600;color:#1e3a5f;">${esc(s.operador_nombre)}</div>` : '<span style="color:#cbd5e1;">—</span>'}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#374151;vertical-align:middle;white-space:nowrap;">${esc(fechas)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;vertical-align:middle;white-space:nowrap;">
            <div style="font-weight:700;font-size:12px;color:#1e3a5f;">$${costo.toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;vertical-align:middle;white-space:nowrap;">
            <div style="font-weight:700;font-size:12px;color:#059669;">$${venta.toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;vertical-align:middle;white-space:nowrap;">
            <div style="font-weight:700;font-size:12px;color:${util>=0?'#7B3FA0':'#dc2626'};">$${util.toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
            <div style="font-size:9px;color:#94a3b8;">${pct}</div>
          </td>
        </tr>`
    }).join('')

    const fechaDoc = new Date().toLocaleDateString('es-UY', { day:'2-digit', month:'long', year:'numeric' })

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Liquidación Interna #${file.numero} - Dr. Viaje</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      margin: 0; background: #eef2ff; color: #1a1a2e;
      font-size: 13px;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    @page {
      size: A4 landscape;
      margin: 10mm 12mm;
    }
    @media print {
      .no-print { display: none !important; }
      body { background: white !important; margin: 0 !important; font-size: 11px; }
      .doc-wrap {
        margin: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        max-width: 100% !important;
        width: 100% !important;
      }
    }
    .doc-wrap {
      max-width: 1000px; margin: 16px auto; background: white;
      border-radius: 12px; overflow: hidden;
      box-shadow: 0 8px 32px rgba(30,64,175,0.12);
    }
    .doc-header {
      background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 60%, #3b82f6 100%) !important;
      padding: 20px 28px;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .doc-body { padding: 20px 28px; }
    .confidencial-band {
      background: #fef3c7 !important;
      border: 1.5px solid #f59e0b;
      border-radius: 6px; padding: 6px 14px;
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 16px;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .info-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px;
    }
    .info-card {
      background: #f8fafc !important; border: 1px solid #e2e8f0;
      border-radius: 8px; padding: 10px 12px;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .info-label { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; margin-bottom: 3px; }
    .info-value { font-size: 13px; font-weight: 700; color: #1e3a5f; }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      background: #1e3a5f !important; color: white !important;
      padding: 8px 10px; text-align: left; font-size: 10px;
      font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    thead th.th-right { text-align: right; }
    thead th.th-center { text-align: center; }
    tbody tr:nth-child(even) td { background: #f0f4f8 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .totales-row {
      background: #dbeafe !important;
      border-top: 2px solid #1e3a5f !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .totales-row td { padding: 10px 10px; color: #1e3a5f !important; font-weight: 800; font-size: 12px; }
    .summary-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px;
    }
    .summary-card {
      border-radius: 8px; padding: 12px; text-align: center;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .doc-footer {
      background: #f1f5f9 !important; border-top: 2px solid #e2e8f0;
      padding: 12px 28px; text-align: center; font-size: 10px; color: #94a3b8;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  </style>
</head>
<body>
  <!-- Barra acción (no imprime) -->
  <div class="no-print" style="background:#1e3a5f;padding:10px 20px;display:flex;align-items:center;justify-content:center;gap:16px;">
    <button onclick="window.print()"
      style="background:#3b82f6;color:white;border:none;padding:9px 24px;border-radius:7px;font-weight:700;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
      🖨 Imprimir / Guardar PDF
    </button>
    <a href="/files/${id}" style="color:rgba(255,255,255,0.8);font-size:13px;text-decoration:none;">← Volver al File</a>
  </div>

  <div class="doc-wrap">
    <!-- HEADER -->
    <div class="doc-header">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;">
        <div>
          <div style="color:rgba(255,255,255,0.55);font-size:9px;letter-spacing:2.5px;margin-bottom:4px;text-transform:uppercase;">Documento Interno Confidencial</div>
          <div style="color:white;font-size:22px;font-weight:900;letter-spacing:-0.5px;">LIQUIDACIÓN INTERNA</div>
          <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:3px;">${esc(file.destino_principal || '—')}</div>
        </div>
        <!-- Código de reserva destacado -->
        <div style="background:rgba(255,255,255,0.15) !important;border:2px solid rgba(255,255,255,0.5);border-radius:10px;padding:10px 20px;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <div style="color:rgba(255,255,255,0.65);font-size:9px;letter-spacing:2px;margin-bottom:4px;text-transform:uppercase;">Nro. de Reserva</div>
          <div style="color:white;font-size:28px;font-weight:900;letter-spacing:1px;line-height:1;">#${esc(file.numero)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:20px;font-weight:900;">
            <span style="color:#F7941D;">Dr.</span><span style="color:white;">Viaje</span><span style="color:#93c5fd;">.com</span>
          </div>
          <div style="color:rgba(255,255,255,0.6);font-size:10px;margin-top:5px;">${fechaDoc}</div>
          <div style="color:rgba(255,255,255,0.45);font-size:9px;margin-top:2px;">Uso exclusivo interno — No distribuir</div>
        </div>
      </div>
    </div>

    <!-- BODY -->
    <div class="doc-body">

      <!-- Banda confidencial -->
      <div class="confidencial-band">
        <span style="font-size:14px;">⚠️</span>
        <span style="font-size:11px;font-weight:700;color:#92400e;">DOCUMENTO CONFIDENCIAL</span>
        <span style="font-size:11px;color:#78350f;">— Uso exclusivo del área de administración. Contiene costos internos.</span>
      </div>

      <!-- Info del file (4 columnas) -->
      <div class="info-grid">
        <div class="info-card">
          <div class="info-label">Cliente</div>
          <div class="info-value">${esc(file.cliente_nombre)}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Vendedor</div>
          <div class="info-value">${esc(file.vendedor_nombre)}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Estado del File</div>
          <div class="info-value">${esc(file.estado?.replace('_',' ').toUpperCase() || '—')}</div>
        </div>
        <div class="info-card">
          <div class="info-label">Fecha de Viaje</div>
          <div class="info-value">${esc(file.fecha_viaje || '—')}</div>
        </div>
      </div>

      <!-- Tabla de servicios -->
      <div style="border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
        <table>
          <thead>
            <tr>
              <th style="width:22%;">Servicio</th>
              <th style="width:12%;" class="th-center">Cód. Reserva</th>
              <th style="width:15%;">Prestador</th>
              <th style="width:14%;">Operador</th>
              <th style="width:12%;">Fechas</th>
              <th style="width:8%;" class="th-right">Costo</th>
              <th style="width:8%;" class="th-right">Venta</th>
              <th style="width:9%;" class="th-right">Utilidad</th>
            </tr>
          </thead>
          <tbody>
            ${filasSvcs || `<tr><td colspan="8" style="text-align:center;padding:20px;color:#9ca3af;">Sin servicios</td></tr>`}
            <!-- Fila de totales -->
            <tr class="totales-row">
              <td colspan="5" style="text-align:right;letter-spacing:1px;font-size:11px;padding-right:16px;color:#1e3a5f !important;font-weight:800;">TOTALES</td>
              <td style="text-align:right;color:#1e3a5f !important;font-weight:800;">$${totalCosto.toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td style="text-align:right;color:#059669 !important;font-weight:800;">$${totalVenta.toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              <td style="text-align:right;color:${totalUtil>=0?'#7B3FA0':'#dc2626'} !important;font-weight:800;">$${totalUtil.toLocaleString('es-UY',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Resumen ejecutivo -->
      <div class="summary-grid">
        <div class="summary-card" style="background:#f0fdf4 !important;border:1.5px solid #bbf7d0;">
          <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#166534;margin-bottom:4px;">COSTO TOTAL</div>
          <div style="font-size:20px;font-weight:900;color:#1e3a5f;">$${totalCosto.toLocaleString('es-UY',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
          <div style="font-size:9px;color:#94a3b8;">${esc(file.moneda || 'USD')}</div>
        </div>
        <div class="summary-card" style="background:#eff6ff !important;border:1.5px solid #bfdbfe;">
          <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#1e40af;margin-bottom:4px;">VENTA TOTAL</div>
          <div style="font-size:20px;font-weight:900;color:#1e3a5f;">$${totalVenta.toLocaleString('es-UY',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
          <div style="font-size:9px;color:#94a3b8;">${esc(file.moneda || 'USD')}</div>
        </div>
        <div class="summary-card" style="background:#faf5ff !important;border:1.5px solid #e9d5ff;">
          <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#7B3FA0;margin-bottom:4px;">UTILIDAD</div>
          <div style="font-size:20px;font-weight:900;color:${totalUtil>=0?'#7B3FA0':'#dc2626'};">$${totalUtil.toLocaleString('es-UY',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
          <div style="font-size:9px;color:#94a3b8;">${esc(file.moneda || 'USD')}</div>
        </div>
        <div class="summary-card" style="background:#fefce8 !important;border:1.5px solid #fde68a;">
          <div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#92400e;margin-bottom:4px;">% UTILIDAD</div>
          <div style="font-size:20px;font-weight:900;color:#92400e;">${pctUtil}%</div>
          <div style="font-size:9px;color:#94a3b8;">sobre costo</div>
        </div>
      </div>

    </div>

    <!-- FOOTER -->
    <div class="doc-footer">
      <div>Dr. Viaje · Administración Interna · ${fechaDoc}</div>
      <div style="margin-top:3px;">Este documento contiene información confidencial de costos. No debe ser distribuido al cliente ni a terceros.</div>
    </div>
  </div>
</body>
</html>`

    return c.html(html)
  } catch (e: any) {
    return c.redirect(`/files/${id}`)
  }
})

// ── API: Ajustar Venta Total ──────────────────────────────────────────────────
files.post('/api/files/:id/ajustar-venta', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)

  const id = Number(c.req.param('id'))
  try {
    const body = await c.req.json() as any
    const nuevaVentaTotal = Number(body.nueva_venta_total)
    const serviciosAjuste: { id: number; precio_venta: number }[] = body.servicios || []

    if (!nuevaVentaTotal || nuevaVentaTotal <= 0) return c.json({ error: 'Venta total inválida' }, 400)
    if (!serviciosAjuste.length) return c.json({ error: 'Sin servicios para ajustar' }, 400)

    // Verificar que el file existe y el usuario puede editarlo
    const file = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).first() as any
    if (!file) return c.json({ error: 'File no encontrado' }, 404)
    if (!canSeeAllFiles(user.rol) && file.vendedor_id != user.id) return c.json({ error: 'Sin permiso' }, 403)
    // Files cerrados: solo admin/gerente pueden ajustar venta
    if (file.estado === 'anulado') return c.json({ error: 'No se puede ajustar un file anulado' }, 403)
    if (file.estado === 'cerrado' && !isAdminOrAbove(user.rol)) return c.json({ error: 'Solo administración o gerencia puede ajustar la venta de un file cerrado' }, 403)

    // Verificar que no tenga liquidaciones aprobadas/pagadas
    const liqExistente = await c.env.DB.prepare(`
      SELECT lf.id FROM liquidacion_files lf
      JOIN liquidaciones l ON l.id = lf.liquidacion_id
      WHERE lf.file_id = ? AND l.estado IN ('aprobada','pagada')
      LIMIT 1
    `).bind(id).first().catch(() => null) as any
    if (liqExistente) return c.json({ error: 'El file tiene liquidaciones aprobadas. Contacte al administrador.' }, 403)

    // Actualizar precio_venta de cada servicio
    for (const svc of serviciosAjuste) {
      const svcId = Number(svc.id)
      const precio = Number(svc.precio_venta)
      if (!svcId || precio < 0) continue
      // Verificar que el servicio pertenece al file
      const svcRow = await c.env.DB.prepare('SELECT id FROM servicios WHERE id = ? AND file_id = ?').bind(svcId, id).first()
      if (!svcRow) continue
      await c.env.DB.prepare(`
        UPDATE servicios SET precio_venta = ? WHERE id = ?
      `).bind(precio, svcId).run()
    }

    // Recalcular totales del file
    await recalcularTotalesFile(c.env.DB, id)

    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: e.message || 'Error interno' }, 500)
  }
})

export default files
