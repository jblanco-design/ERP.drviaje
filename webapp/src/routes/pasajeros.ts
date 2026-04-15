import { Hono } from 'hono'
import { getUser } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }
const pasajeros = new Hono<{ Bindings: Bindings }>()

// Helper: nombre completo desde campos separados
function nombreCompleto(p: any): string {
  const n = p?.nombre || ''
  const a = p?.apellido || ''
  if (n && a) return `${n} ${a}`
  return n || a || p?.nombre_completo || '—'
}

// ══════════════════════════════════════════════════════════════
// LISTA
// ══════════════════════════════════════════════════════════════
pasajeros.get('/pasajeros', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const buscar   = c.req.query('buscar') || ''
  const docFiltro = c.req.query('doc') || ''

  try {
    let q = `
      SELECT p.*, COUNT(DISTINCT fp.file_id) as cant_files
      FROM pasajeros p
      LEFT JOIN file_pasajeros fp ON fp.pasajero_id = p.id
      WHERE 1=1
    `
    const params: any[] = []

    if (buscar) {
      q += ` AND (p.nombre LIKE ? OR p.apellido LIKE ?
              OR (p.nombre || ' ' || p.apellido) LIKE ?
              OR p.nro_documento LIKE ? OR p.email LIKE ?)`
      const like = `%${buscar}%`
      params.push(like, like, like, like, like)
    }
    if (docFiltro) { q += ' AND p.tipo_documento = ?'; params.push(docFiltro) }
    q += ' GROUP BY p.id ORDER BY p.apellido, p.nombre LIMIT 200'

    const result = await c.env.DB.prepare(q).bind(...params).all()

    const hoy   = new Date().toISOString().split('T')[0]
    const en30d = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

    const rows = result.results.map((p: any) => {
      const nc = nombreCompleto(p)
      const pasaVencido = p.vencimiento_pasaporte && p.vencimiento_pasaporte < hoy
      const pasaProximo = p.vencimiento_pasaporte && p.vencimiento_pasaporte >= hoy && p.vencimiento_pasaporte <= en30d
      let pasaBadge = '<span style="color:#9ca3af;font-size:11px;">—</span>'
      if (p.vencimiento_pasaporte) {
        const col  = pasaVencido ? '#dc2626' : pasaProximo ? '#d97706' : '#059669'
        const icon = pasaVencido ? '⚠ '       : pasaProximo ? '⏰ '       : '✓ '
        pasaBadge = `<span style="font-size:11px;font-weight:700;color:${col};">${icon}${esc(p.vencimiento_pasaporte)}</span>`
      }
      return `
        <tr>
          <td>
            <strong style="color:#1a1a2e;">${esc(nc)}</strong>
            ${(p.nombre && p.apellido) ? `<br><span style="font-size:11px;color:#9ca3af;">${esc(p.nombre)} / ${esc(p.apellido)}</span>` : ''}
            ${p.cant_files > 0 ? `<br><span style="font-size:11px;color:#7B3FA0;"><i class="fas fa-folder"></i> ${p.cant_files} file${p.cant_files>1?'s':''}</span>` : ''}
          </td>
          <td style="font-size:12px;">${esc(p.email) || '—'}</td>
          <td style="font-size:12px;">${esc(p.telefono) || '—'}</td>
          <td>
            <span style="font-size:11px;background:#f3e8ff;color:#7B3FA0;padding:2px 7px;border-radius:10px;font-weight:600;">${esc(p.tipo_documento||'CI')}</span>
            <span style="font-size:12px;"> ${esc(p.nro_documento) || '—'}</span>
          </td>
          <td>${pasaBadge}</td>
          <td style="font-size:12px;">${esc(p.nacionalidad) || '—'}</td>
          <td>
            <a href="/pasajeros/${p.id}" class="btn btn-outline btn-sm" title="Ver"><i class="fas fa-eye"></i></a>
            <a href="/pasajeros/${p.id}/editar" class="btn btn-sm" style="background:#f3e8ff;color:#7B3FA0;" title="Editar"><i class="fas fa-edit"></i></a>
          </td>
        </tr>
      `
    }).join('')

    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <form method="GET" style="display:flex;gap:8px;flex-wrap:wrap;">
          <input type="text" name="buscar" value="${esc(buscar)}" placeholder="Buscar por nombre, documento o email..." class="form-control" style="width:280px;">
          <select name="doc" class="form-control" style="width:140px;">
            <option value="">Todos los docs</option>
            <option value="CI"   ${docFiltro==='CI'  ?'selected':''}>C.I.</option>
            <option value="DNI"  ${docFiltro==='DNI' ?'selected':''}>DNI</option>
            <option value="PAS"  ${docFiltro==='PAS' ?'selected':''}>Pasaporte</option>
            <option value="OTRO" ${docFiltro==='OTRO'?'selected':''}>Otro</option>
          </select>
          <button type="submit" class="btn btn-primary"><i class="fas fa-search"></i></button>
          ${buscar||docFiltro ? `<a href="/pasajeros" class="btn btn-outline"><i class="fas fa-times"></i> Limpiar</a>` : ''}
        </form>
        <a href="/pasajeros/nuevo" class="btn btn-orange"><i class="fas fa-user-plus"></i> Nuevo Pasajero</a>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-users" style="color:#EC008C"></i> Pasajeros (${result.results.length})</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Documento</th><th>Pasaporte</th><th>Nacionalidad</th><th>Acciones</th></tr></thead>
            <tbody>
              ${rows || `<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af;">
                <i class="fas fa-users" style="font-size:32px;margin-bottom:10px;display:block;opacity:0.3;"></i>
                ${buscar ? 'Sin resultados.' : 'Sin pasajeros registrados. <a href="/pasajeros/nuevo" style="color:#7B3FA0;font-weight:600;">Crear primero</a>'}
              </td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `
    return c.html(baseLayout('Pasajeros', content, user, 'pasajeros'))
  } catch (e: any) {
    return c.html(baseLayout('Pasajeros', `<div class="alert alert-danger">${esc(e.message)}</div>`, user, 'pasajeros'))
  }
})

// ══════════════════════════════════════════════════════════════
// BUSCAR (API — debe ir ANTES de /:id para no ser capturado)
// ══════════════════════════════════════════════════════════════
pasajeros.get('/pasajeros/buscar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const q = (c.req.query('q') || '').trim()
  if (q.length < 2) return c.json({ results: [] })
  try {
    const like = `%${q}%`
    const results = await c.env.DB.prepare(`
      SELECT id,
             COALESCE(nombre || ' ' || apellido, nombre_completo) as nombre_completo,
             nombre, apellido, tipo_documento, nro_documento, email, fecha_nacimiento
      FROM pasajeros
      WHERE nombre LIKE ? OR apellido LIKE ?
         OR (nombre || ' ' || apellido) LIKE ?
         OR nombre_completo LIKE ?
         OR nro_documento LIKE ?
      ORDER BY apellido, nombre ASC LIMIT 20
    `).bind(like, like, like, like, like).all()
    return c.json({ results: results.results })
  } catch (e: any) {
    return c.json({ error: 'Error interno' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// NUEVO
// ══════════════════════════════════════════════════════════════
pasajeros.get('/pasajeros/nuevo', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  return c.html(baseLayout('Nuevo Pasajero', pasajeroForm(null), user, 'pasajeros'))
})

pasajeros.post('/pasajeros', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const b = await c.req.parseBody()
  try {
    const nombre   = String(b.nombre || '').trim()
    const apellido = String(b.apellido || '').trim()
    if (!nombre || !apellido) return c.redirect('/pasajeros/nuevo?error=nombre_requerido')

    const nc = `${nombre} ${apellido}`.trim()
    const TIPOS_DOC_P = ['CI', 'DNI', 'PAS', 'RUT', 'OTRO']
    const tipoDocP = TIPOS_DOC_P.includes(String(b.tipo_documento)) ? String(b.tipo_documento) : 'CI'
    const result = await c.env.DB.prepare(`
      INSERT INTO pasajeros (nombre, apellido, nombre_completo,
        tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte,
        nacionalidad, email, telefono, preferencias_comida, millas_aerolineas, notas)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      nombre.substring(0, 100), apellido.substring(0, 100), nc.substring(0, 200),
      tipoDocP,
      b.nro_documento ? String(b.nro_documento).trim().substring(0, 50) : null,
      b.fecha_nacimiento || null,
      b.vencimiento_pasaporte || null,
      b.nacionalidad ? String(b.nacionalidad).trim().substring(0, 100) : null,
      b.email ? String(b.email).trim().substring(0, 200) : null,
      b.telefono ? String(b.telefono).trim().substring(0, 50) : null,
      b.preferencias_comida ? String(b.preferencias_comida).trim().substring(0, 200) : null,
      b.millas_aerolineas ? String(b.millas_aerolineas).trim().substring(0, 100) : null,
      b.notas ? String(b.notas).trim().substring(0, 1000) : null
    ).run()
    return c.redirect(`/pasajeros/${result.meta.last_row_id}?created=1`)
  } catch (e: any) {
    return c.redirect('/pasajeros/nuevo?error=1')
  }
})

// ══════════════════════════════════════════════════════════════
// VER
// ══════════════════════════════════════════════════════════════
pasajeros.get('/pasajeros/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const created = c.req.query('created') === '1'

  try {
    const p = await c.env.DB.prepare('SELECT * FROM pasajeros WHERE id = ?').bind(id).first() as any
    if (!p) return c.redirect('/pasajeros')

    const filesP = await c.env.DB.prepare(`
      SELECT f.id, f.numero, f.destino_principal, f.estado, f.total_venta, f.created_at,
             fp.rol, fp.grupo,
             u.nombre as vendedor_nombre,
             c.nombre_completo as cliente_nombre
      FROM file_pasajeros fp
      JOIN files f ON fp.file_id = f.id
      JOIN usuarios u ON f.vendedor_id = u.id
      LEFT JOIN clientes c ON f.cliente_id = c.id
      WHERE fp.pasajero_id = ?
      ORDER BY f.created_at DESC
    `).bind(id).all()

    const hoy   = new Date().toISOString().split('T')[0]
    const en30d = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
    const pasaVencido = p.vencimiento_pasaporte && p.vencimiento_pasaporte < hoy
    const pasaProximo = p.vencimiento_pasaporte && p.vencimiento_pasaporte >= hoy && p.vencimiento_pasaporte <= en30d

    const pasaColor = !p.vencimiento_pasaporte ? '#9ca3af'
                    : pasaVencido ? '#dc2626'
                    : pasaProximo ? '#d97706' : '#059669'
    const pasaIcon  = pasaVencido ? '⚠ ' : pasaProximo ? '⏰ ' : (p.vencimiento_pasaporte ? '✓ ' : '')

    let edadStr = ''
    if (p.fecha_nacimiento) {
      const nac = new Date(p.fecha_nacimiento)
      const hoyD = new Date()
      let edad = hoyD.getFullYear() - nac.getFullYear()
      const m = hoyD.getMonth() - nac.getMonth()
      if (m < 0 || (m === 0 && hoyD.getDate() < nac.getDate())) edad--
      edadStr = ` <span style="font-size:12px;color:#9ca3af;">(${edad} años)</span>`
    }

    const estadoColor: Record<string, string> = { en_proceso:'#3b82f6', seniado:'#8b5cf6', cerrado:'#059669', anulado:'#6b7280' }
    const estadoLabel: Record<string, string> = { en_proceso:'En Proceso', seniado:'Señado', cerrado:'Cerrado', anulado:'Anulado' }

    const nc = nombreCompleto(p)

    const filesHtml = filesP.results.length > 0
      ? filesP.results.map((f: any) => {
          const col = estadoColor[f.estado] || '#9ca3af'
          const lbl = estadoLabel[f.estado] || f.estado
          return `
            <div style="background:white;border:1px solid #ede5f5;border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <div style="flex:1;min-width:0;">
                <strong style="color:#7B3FA0;">#${esc(f.numero)}</strong>
                <span style="font-size:12px;color:#6b7280;margin-left:8px;">${esc(f.destino_principal)||'—'}</span>
                <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${col}22;color:${col};">${lbl}</span>
                <br><span style="font-size:11px;color:#9ca3af;">
                  <i class="fas fa-user-tie"></i> ${esc(f.cliente_nombre)||'—'}
                  · Rol: <strong>${esc(f.rol)}</strong>
                  ${f.grupo ? `· Grupo: ${esc(f.grupo)}` : ''}
                </span>
              </div>
              <div style="text-align:right;white-space:nowrap;">
                <div style="font-weight:700;color:#059669;font-size:13px;">$${Number(f.total_venta||0).toLocaleString()}</div>
                <a href="/files/${f.id}" class="btn btn-outline btn-sm" style="margin-top:4px;font-size:11px;"><i class="fas fa-eye"></i> File</a>
              </div>
            </div>
          `
        }).join('')
      : '<div style="color:#9ca3af;font-size:13px;padding:10px 0;"><i class="fas fa-info-circle"></i> Sin files asociados.</div>'

    const content = `
      ${created ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> Pasajero creado correctamente.</div>` : ''}
      <div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <a href="/pasajeros" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver</a>
        <a href="/pasajeros/${id}/editar" class="btn btn-outline"><i class="fas fa-edit"></i> Editar</a>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="card">
          <div class="card-body">
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">
              <div style="width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#7B3FA0,#EC008C);display:flex;align-items:center;justify-content:center;color:white;font-size:22px;font-weight:800;flex-shrink:0;">
                ${esc((p.nombre || p.nombre_completo || '?').charAt(0).toUpperCase())}
              </div>
              <div>
                <div style="font-size:18px;font-weight:800;color:#1a1a2e;">${esc(nc)}</div>
                <div style="font-size:12px;color:#9ca3af;">ID Pasajero #${id}</div>
              </div>
            </div>
            <div style="display:grid;gap:10px;font-size:13px;">
              <div>
                <i class="fas fa-user" style="color:#7B3FA0;width:18px;"></i>
                <strong>Nombre:</strong> ${esc(p.nombre)||'—'} &nbsp;
                <strong>Apellido:</strong> ${esc(p.apellido)||'—'}
              </div>
              <div><i class="fas fa-id-card" style="color:#7B3FA0;width:18px;"></i> <strong>${esc(p.tipo_documento||'CI')}</strong>: ${esc(p.nro_documento)||'—'}</div>
              <div><i class="fas fa-birthday-cake" style="color:#7B3FA0;width:18px;"></i> ${esc(p.fecha_nacimiento)||'—'}${edadStr}</div>
              <div>
                <i class="fas fa-passport" style="color:${pasaColor};width:18px;"></i>
                <strong>Pasaporte vence:</strong>
                <span style="color:${pasaColor};font-weight:700;"> ${pasaIcon}${esc(p.vencimiento_pasaporte)||'—'}</span>
                ${pasaVencido ? '<span style="font-size:11px;color:#dc2626;"> VENCIDO</span>' : ''}
              </div>
              <div><i class="fas fa-globe" style="color:#7B3FA0;width:18px;"></i> ${esc(p.nacionalidad)||'—'}</div>
              <div><i class="fas fa-envelope" style="color:#7B3FA0;width:18px;"></i> ${p.email ? `<a href="mailto:${esc(p.email)}" style="color:#7B3FA0;">${esc(p.email)}</a>` : '—'}</div>
              <div><i class="fas fa-phone" style="color:#7B3FA0;width:18px;"></i> ${esc(p.telefono)||'—'}</div>
              ${p.preferencias_comida ? `<div><i class="fas fa-utensils" style="color:#7B3FA0;width:18px;"></i> ${esc(p.preferencias_comida)}</div>` : ''}
              ${p.millas_aerolineas   ? `<div><i class="fas fa-plane"    style="color:#7B3FA0;width:18px;"></i> ${esc(p.millas_aerolineas)}</div>` : ''}
              ${p.notas ? `<div style="margin-top:6px;padding:10px;background:#f8f3ff;border-radius:8px;color:#5a2d75;font-size:12px;"><i class="fas fa-sticky-note"></i> ${esc(p.notas)}</div>` : ''}
            </div>
          </div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:#5a2d75;margin-bottom:12px;">
            <i class="fas fa-folder-open" style="color:#F7941D"></i> Files (${filesP.results.length})
          </div>
          ${filesHtml}
        </div>
      </div>
    `
    return c.html(baseLayout(nc, content, user, 'pasajeros'))
  } catch (e: any) {
    return c.redirect('/pasajeros')
  }
})

// ══════════════════════════════════════════════════════════════
// EDITAR
// ══════════════════════════════════════════════════════════════
pasajeros.get('/pasajeros/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const p = await c.env.DB.prepare('SELECT * FROM pasajeros WHERE id = ?').bind(id).first() as any
  if (!p) return c.redirect('/pasajeros')
  return c.html(baseLayout('Editar Pasajero', pasajeroForm(p, id), user, 'pasajeros'))
})

pasajeros.post('/pasajeros/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')
  const b = await c.req.parseBody()
  try {
    const nombre   = String(b.nombre || '').trim()
    const apellido = String(b.apellido || '').trim()
    if (!nombre || !apellido) return c.redirect(`/pasajeros/${id}/editar?error=nombre_requerido`)

    const nc = `${nombre} ${apellido}`.trim()
    const TIPOS_DOC_P2 = ['CI', 'DNI', 'PAS', 'RUT', 'OTRO']
    const tipoDocP2 = TIPOS_DOC_P2.includes(String(b.tipo_documento)) ? String(b.tipo_documento) : 'CI'
    await c.env.DB.prepare(`
      UPDATE pasajeros SET
        nombre=?, apellido=?, nombre_completo=?,
        tipo_documento=?, nro_documento=?,
        fecha_nacimiento=?, vencimiento_pasaporte=?,
        nacionalidad=?, email=?, telefono=?,
        preferencias_comida=?, millas_aerolineas=?, notas=?,
        updated_at=datetime('now')
      WHERE id=?
    `).bind(
      nombre.substring(0, 100), apellido.substring(0, 100), nc.substring(0, 200),
      tipoDocP2,
      b.nro_documento ? String(b.nro_documento).trim().substring(0, 50) : null,
      b.fecha_nacimiento || null,
      b.vencimiento_pasaporte || null,
      b.nacionalidad ? String(b.nacionalidad).trim().substring(0, 100) : null,
      b.email ? String(b.email).trim().substring(0, 200) : null,
      b.telefono ? String(b.telefono).trim().substring(0, 50) : null,
      b.preferencias_comida ? String(b.preferencias_comida).trim().substring(0, 200) : null,
      b.millas_aerolineas ? String(b.millas_aerolineas).trim().substring(0, 100) : null,
      b.notas ? String(b.notas).trim().substring(0, 1000) : null,
      id
    ).run()
    return c.redirect(`/pasajeros/${id}`)
  } catch (e: any) {
    return c.redirect(`/pasajeros/${id}/editar?error=1`)
  }
})

// ══════════════════════════════════════════════════════════════
// FORM HELPER
// ══════════════════════════════════════════════════════════════
function pasajeroForm(p: any, id?: string): string {
  const action   = id ? `/pasajeros/${id}/editar` : '/pasajeros'
  const backHref = id ? `/pasajeros/${id}` : '/pasajeros'
  const isEdit   = !!id

  return `
    <div style="max-width:720px;">
      <a href="${backHref}" style="color:#7B3FA0;font-size:13px;margin-bottom:20px;display:block;">
        <i class="fas fa-arrow-left"></i> Volver
      </a>
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-user-${isEdit ? 'edit' : 'plus'}" style="color:#EC008C"></i>
            ${isEdit ? 'Editar' : 'Nuevo'} Pasajero
          </span>
        </div>
        <div class="card-body">
          <form method="POST" action="${action}">

            <!-- Nombre y Apellido (obligatorios) -->
            <div class="grid-2" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label">NOMBRE <span style="color:#dc2626;">*</span></label>
                <input type="text" name="nombre" required
                  value="${esc(p?.nombre) || ''}"
                  class="form-control" placeholder="Ej: María">
              </div>
              <div class="form-group">
                <label class="form-label">APELLIDO <span style="color:#dc2626;">*</span></label>
                <input type="text" name="apellido" required
                  value="${esc(p?.apellido) || ''}"
                  class="form-control" placeholder="Ej: González">
              </div>
            </div>

            <!-- Documento -->
            <div class="grid-2" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label">TIPO DOCUMENTO</label>
                <select name="tipo_documento" class="form-control"
                        id="pax-sel-tipo-doc" onchange="paxMostrarCamposDoc(this.value)">
                  <option value="CI"   ${p?.tipo_documento==='CI'  ?'selected':''}>C.I. (Cédula de Identidad)</option>
                  <option value="DNI"  ${p?.tipo_documento==='DNI' ?'selected':''}>DNI (Arg. / otro país)</option>
                  <option value="PAS"  ${p?.tipo_documento==='PAS' ?'selected':''}>Pasaporte</option>
                  <option value="OTRO" ${p?.tipo_documento==='OTRO'?'selected':''}>Otro</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">NRO DOCUMENTO</label>
                <div style="position:relative;">
                  <input type="text" name="nro_documento" id="pax-inp-nro-doc"
                    value="${esc(p?.nro_documento) || ''}"
                    class="form-control" placeholder="Ej: 12345678" autocomplete="off">
                  <span id="pax-ci-validacion" style="display:none;position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:16px;"></span>
                </div>
                <div id="pax-ci-msg" style="font-size:11px;margin-top:3px;"></div>
              </div>
            </div>

            <!-- Fechas -->
            <div class="grid-2" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label">FECHA NACIMIENTO</label>
                <input type="date" name="fecha_nacimiento" value="${p?.fecha_nacimiento||''}" class="form-control">
              </div>
              <div class="form-group">
                <label class="form-label">VENCIMIENTO PASAPORTE</label>
                <input type="date" name="vencimiento_pasaporte" value="${p?.vencimiento_pasaporte||''}" class="form-control">
              </div>
            </div>

            <!-- Contacto -->
            <div class="grid-2" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label">EMAIL</label>
                <input type="email" name="email" value="${esc(p?.email)||''}" class="form-control">
              </div>
              <div class="form-group">
                <label class="form-label">TELÉFONO</label>
                <input type="text" name="telefono" value="${esc(p?.telefono)||''}" class="form-control" placeholder="+598 9X XXX XXX">
              </div>
            </div>

            <div class="form-group" style="margin-bottom:14px;">
              <label class="form-label">NACIONALIDAD</label>
              <input type="text" name="nacionalidad" value="${esc(p?.nacionalidad)||''}" class="form-control" placeholder="Ej: Uruguaya, Argentina">
            </div>

            <div class="grid-2" style="margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label">PREFERENCIAS COMIDA</label>
                <input type="text" name="preferencias_comida" value="${esc(p?.preferencias_comida)||''}" class="form-control" placeholder="Ej: Vegano, Sin Gluten">
              </div>
              <div class="form-group">
                <label class="form-label">NRO VIAJERO FRECUENTE</label>
                <input type="text" name="millas_aerolineas" value="${esc(p?.millas_aerolineas)||''}" class="form-control" placeholder="LATAM: LTxxxxxx">
              </div>
            </div>

            <div class="form-group" style="margin-bottom:20px;">
              <label class="form-label">NOTAS</label>
              <textarea name="notas" rows="3" class="form-control">${esc(p?.notas)||''}</textarea>
            </div>

            <div style="display:flex;gap:10px;">
              <button type="submit" class="btn btn-primary">
                <i class="fas fa-save"></i> ${isEdit ? 'Guardar cambios' : 'Crear Pasajero'}
              </button>
              <a href="${backHref}" class="btn btn-outline">Cancelar</a>
            </div>
          </form>

          <script>
            function paxMostrarCamposDoc(tipo) {
              const inp   = document.getElementById('pax-inp-nro-doc')
              const msg   = document.getElementById('pax-ci-msg')
              const valid = document.getElementById('pax-ci-validacion')
              inp.style.borderColor = ''
              valid.style.display   = 'none'; valid.textContent = ''
              msg.textContent = ''; msg.style.color = '#9ca3af'
              if (tipo === 'CI') {
                inp.placeholder = 'Ej: 12345678 (sin puntos ni guión)'
                msg.innerHTML   = '<i class="fas fa-info-circle"></i> 8 dígitos. Se validará automáticamente.'
                if (inp.value) paxValidarCI(inp.value)
              } else if (tipo === 'DNI') {
                inp.placeholder = 'Ej: 12345678'
              } else if (tipo === 'PAS') {
                inp.placeholder = 'Ej: ABC123456'
              }
            }
            function paxValidarCI(valor) {
              const msg   = document.getElementById('pax-ci-msg')
              const valid = document.getElementById('pax-ci-validacion')
              const inp   = document.getElementById('pax-inp-nro-doc')
              const limpio = valor.replace(/[^0-9]/g,'')
              if (!limpio.length) { valid.style.display='none'; msg.textContent=''; inp.style.borderColor=''; return }
              if (limpio.length < 8) {
                valid.style.display='inline'; valid.textContent='⏳'
                msg.textContent='Ingresá los 8 dígitos'; msg.style.color='#9ca3af'
                inp.style.borderColor=''; return
              }
              const padded=limpio.padStart(8,'0'); const base=padded.slice(0,7); const ing=parseInt(padded[7])
              const mult=[2,9,8,7,6,3,4]; let suma=0
              for(let i=0;i<7;i++) suma+=parseInt(base[i])*mult[i]
              const esp=suma%10===0?0:10-suma%10
              if(ing===esp){
                valid.style.display='inline'; valid.textContent='✅'
                msg.innerHTML='<span style="color:#059669;font-weight:600;"><i class="fas fa-check-circle"></i> Cédula válida</span>'
                inp.style.borderColor='#059669'
              } else {
                valid.style.display='inline'; valid.textContent='❌'
                msg.innerHTML='<span style="color:#dc2626;font-weight:600;"><i class="fas fa-times-circle"></i> Inválida — dígito esperado: <strong>'+esp+'</strong></span>'
                inp.style.borderColor='#dc2626'
              }
            }
            document.addEventListener('DOMContentLoaded',function(){
              const sel=document.getElementById('pax-sel-tipo-doc')
              const inp=document.getElementById('pax-inp-nro-doc')
              if(sel && sel.value) paxMostrarCamposDoc(sel.value)
              if(inp) inp.addEventListener('input',function(){
                if(document.getElementById('pax-sel-tipo-doc')?.value==='CI') paxValidarCI(this.value)
              })
            })
          </script>
        </div>
      </div>
    </div>
  `
}

export default pasajeros
