import { Hono } from 'hono'
import { getUser, canSeeAllFiles, canAccessTesoreria, canSeeReportes, rolLabel, rolColor, rolTextColor } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }
const dashboard = new Hono<{ Bindings: Bindings }>()

dashboard.get('/dashboard', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  try {
    // Stats según rol — supervisor, admin y gerente ven todos los files
    const isGerente = canSeeAllFiles(user.rol)
    
    let totalFilesCount = 0
    let totalVentasNum  = 0
    let totalCostoNum   = 0

    if (isGerente) {
      const tf = await c.env.DB.prepare('SELECT COUNT(*) as total FROM files WHERE estado != "anulado"').first() as any
      const tv = await c.env.DB.prepare('SELECT COALESCE(SUM(total_venta),0) as total FROM files WHERE estado NOT IN ("anulado")').first() as any
      const tc = await c.env.DB.prepare('SELECT COALESCE(SUM(total_costo),0) as total FROM files WHERE estado NOT IN ("anulado")').first() as any
      totalFilesCount = Number(tf?.total || 0)
      totalVentasNum  = Number(tv?.total || 0)
      totalCostoNum   = Number(tc?.total || 0)
    } else {
      // Files propios: 50% si están compartidos, 100% si no
      const propios = await c.env.DB.prepare(`
        SELECT COUNT(f.id) as total,
               COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_venta*0.5 ELSE f.total_venta END),0) as venta,
               COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_costo*0.5 ELSE f.total_costo END),0) as costo
        FROM files f LEFT JOIN file_compartido fc ON fc.file_id = f.id
        WHERE f.vendedor_id = ? AND f.estado != "anulado"
      `).bind(user.id).first() as any
      // Files donde este vendedor es el compartido (50%)
      const compartidos = await c.env.DB.prepare(`
        SELECT COUNT(f.id) as total,
               COALESCE(SUM(f.total_venta*0.5),0) as venta,
               COALESCE(SUM(f.total_costo*0.5),0) as costo
        FROM file_compartido fc JOIN files f ON f.id = fc.file_id
        WHERE fc.vendedor_id = ? AND f.estado != "anulado"
      `).bind(user.id).first() as any
      totalFilesCount = Number(propios?.total||0) + Number(compartidos?.total||0)
      totalVentasNum  = Number(propios?.venta||0) + Number(compartidos?.venta||0)
      totalCostoNum   = Number(propios?.costo||0) + Number(compartidos?.costo||0)
    }

    const totalFiles  = { total: totalFilesCount }
    const totalVentas = { total: totalVentasNum }
    const totalCosto  = { total: totalCostoNum }

    // Clientes total (solo gerente ve todos)
    const totalClientes = await c.env.DB.prepare('SELECT COUNT(*) as total FROM clientes').first() as any

    // Files recientes (propios + compartidos)
    let filesRecientes: any
    if (isGerente) {
      filesRecientes = await c.env.DB.prepare(`
        SELECT f.*, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre,
               u.nombre as vendedor_nombre,
               fc.vendedor_id as compartido_con_id, uc.nombre as compartido_con_nombre
        FROM files f JOIN clientes c ON f.cliente_id = c.id JOIN usuarios u ON f.vendedor_id = u.id
        LEFT JOIN file_compartido fc ON fc.file_id = f.id
        LEFT JOIN usuarios uc ON uc.id = fc.vendedor_id
        ORDER BY f.created_at DESC LIMIT 5
      `).all()
    } else {
      // Propios
      const propiosRec = await c.env.DB.prepare(`
        SELECT f.*, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre,
               u.nombre as vendedor_nombre,
               fc.vendedor_id as compartido_con_id, uc.nombre as compartido_con_nombre,
               0 as es_compartido_con_yo
        FROM files f JOIN clientes c ON f.cliente_id = c.id JOIN usuarios u ON f.vendedor_id = u.id
        LEFT JOIN file_compartido fc ON fc.file_id = f.id
        LEFT JOIN usuarios uc ON uc.id = fc.vendedor_id
        WHERE f.vendedor_id = ? ORDER BY f.created_at DESC LIMIT 5
      `).bind(user.id).all()
      // Compartidos conmigo
      const compRec = await c.env.DB.prepare(`
        SELECT f.*, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre,
               u.nombre as vendedor_nombre,
               NULL as compartido_con_id, NULL as compartido_con_nombre,
               1 as es_compartido_con_yo
        FROM file_compartido fc JOIN files f ON f.id = fc.file_id
        JOIN clientes c ON f.cliente_id = c.id JOIN usuarios u ON f.vendedor_id = u.id
        WHERE fc.vendedor_id = ? ORDER BY f.created_at DESC LIMIT 5
      `).bind(user.id).all()
      const todos = [...(propiosRec.results as any[]), ...(compRec.results as any[])]
      todos.sort((a, b) => (b.created_at||'').localeCompare(a.created_at||''))
      filesRecientes = { results: todos.slice(0, 5) }
    }

    // Alertas prepago
    const hoy = new Date().toISOString().split('T')[0]
    const en3dias = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]
    
    let alertasQuery = isGerente
      ? `SELECT s.*, f.numero as file_numero, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre
         FROM servicios s JOIN files f ON s.file_id = f.id JOIN clientes c ON f.cliente_id = c.id
         WHERE s.requiere_prepago = 1 AND s.prepago_realizado = 0 AND s.fecha_limite_prepago <= ?
         AND f.estado NOT IN ('anulado') ORDER BY s.fecha_limite_prepago ASC LIMIT 10`
      : `SELECT s.*, f.numero as file_numero, COALESCE(c.nombre || ' ' || c.apellido, c.nombre_completo) as cliente_nombre
         FROM servicios s JOIN files f ON s.file_id = f.id JOIN clientes c ON f.cliente_id = c.id
         WHERE s.requiere_prepago = 1 AND s.prepago_realizado = 0 AND s.fecha_limite_prepago <= ?
         AND f.vendedor_id = ? AND f.estado NOT IN ('anulado') ORDER BY s.fecha_limite_prepago ASC LIMIT 10`

    const alertasPrepago = isGerente
      ? await c.env.DB.prepare(alertasQuery).bind(en3dias).all()
      : await c.env.DB.prepare(alertasQuery).bind(en3dias, user.id).all()

    // Pasaportes por vencer (30 días)
    const en30dias = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
    const pasaportesPorVencer = await c.env.DB.prepare(
      `SELECT COALESCE(nombre || ' ' || apellido, nombre_completo) as nombre_completo, vencimiento_pasaporte FROM clientes 
       WHERE vencimiento_pasaporte IS NOT NULL AND vencimiento_pasaporte <= ? AND vencimiento_pasaporte >= ?
       ORDER BY vencimiento_pasaporte ASC LIMIT 5`
    ).bind(en30dias, hoy).all()

    const utilidadBruta = (totalVentas?.total || 0) - (totalCosto?.total || 0)
    
    const getBadge = (estado: string) => {
      const badges: Record<string, string> = {
        en_proceso: 'badge-en_proceso', seniado: 'badge-seniado',
        cerrado: 'badge-cerrado', anulado: 'badge-anulado',
        // legado
        cotizacion: 'badge-cotizacion', confirmado: 'badge-confirmado', operado: 'badge-operado'
      }
      return badges[estado] || 'badge-pendiente'
    }
    const getLabelEstado = (estado: string) => {
      const m: Record<string,string> = {
        en_proceso: 'En Proceso', seniado: 'Señado', cerrado: 'Cerrado', anulado: 'Anulado',
        cotizacion: 'En Proceso', confirmado: 'Señado', operado: 'Cerrado'
      }
      return m[estado] || estado
    }

    const alertasHtml = alertasPrepago.results.length > 0 ? `
      <div class="alert alert-warning" style="margin-bottom:20px;">
        <i class="fas fa-exclamation-triangle"></i> <strong>${alertasPrepago.results.length} servicio(s) con prepago pendiente</strong> en los próximos 3 días
        <ul style="margin-top:8px;margin-left:16px;font-size:12px;">
          ${alertasPrepago.results.map((a: any) => `
            <li>File #${esc(a.file_numero)} · ${esc(a.cliente_nombre)} · ${esc(a.descripcion)} · 
              <strong style="color:${a.fecha_limite_prepago < hoy ? '#dc2626' : '#b45309'}">${esc(a.fecha_limite_prepago)}</strong>
              <a href="/files/${a.file_id}" style="margin-left:8px;color:#7B3FA0;font-weight:600;">Ver →</a>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''

    const pasaportesHtml = pasaportesPorVencer.results.length > 0 ? `
      <div class="alert alert-info" style="margin-bottom:20px;">
        <i class="fas fa-passport"></i> <strong>${pasaportesPorVencer.results.length} pasaporte(s) por vencer en 30 días:</strong>
        ${pasaportesPorVencer.results.map((p: any) => `<span style="margin-left:8px;">• ${esc(p.nombre_completo)} (${esc(p.vencimiento_pasaporte)})</span>`).join('')}
      </div>
    ` : ''

    const content = `
      ${alertasHtml}
      ${pasaportesHtml}
      
      <!-- Stats -->
      <div class="grid-4" style="margin-bottom:24px;">
        <div class="stat-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">MIS FILES</div>
              <div style="font-size:28px;font-weight:800;color:#5a2d75;">${totalFiles?.total || 0}</div>
            </div>
            <div class="stat-icon" style="background:#f3e8ff;color:#7B3FA0;">
              <i class="fas fa-folder-open"></i>
            </div>
          </div>
          <a href="/files" class="btn btn-outline btn-sm">Ver todos →</a>
        </div>
        
        <div class="stat-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">VENTAS</div>
              <div style="font-size:24px;font-weight:800;color:#F7941D;">$${Number(totalVentas?.total || 0).toLocaleString('es-UY', {minimumFractionDigits:0,maximumFractionDigits:0})}</div>
              <div style="font-size:11px;color:#9ca3af;">USD</div>
            </div>
            <div class="stat-icon" style="background:#fff7ed;color:#F7941D;">
              <i class="fas fa-dollar-sign"></i>
            </div>
          </div>
        </div>
        
        <div class="stat-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">UTILIDAD BRUTA</div>
              <div style="font-size:24px;font-weight:800;color:#059669;">$${Number(utilidadBruta).toLocaleString('es-UY', {minimumFractionDigits:0,maximumFractionDigits:0})}</div>
              <div style="font-size:11px;color:#9ca3af;">USD</div>
            </div>
            <div class="stat-icon" style="background:#d1fae5;color:#059669;">
              <i class="fas fa-chart-line"></i>
            </div>
          </div>
        </div>
        
        <div class="stat-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">CLIENTES</div>
              <div style="font-size:28px;font-weight:800;color:#EC008C;">${totalClientes?.total || 0}</div>
            </div>
            <div class="stat-icon" style="background:#fce7f3;color:#EC008C;">
              <i class="fas fa-users"></i>
            </div>
          </div>
          <a href="/clientes" class="btn btn-sm" style="background:#fce7f3;color:#EC008C;">Ver →</a>
        </div>
      </div>
      
      <!-- Files recientes -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-clock" style="color:#F7941D"></i> Files Recientes</span>
          <a href="/files/nuevo" class="btn btn-primary btn-sm"><i class="fas fa-plus"></i> Nuevo File</a>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>N° File</th><th>Cliente</th><th>Vendedor</th><th>Destino</th>
                <th>Estado</th><th>Venta</th><th>Apertura</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${filesRecientes.results.length === 0 ? 
                `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:30px;">No hay files aún. <a href="/files/nuevo" style="color:#7B3FA0">Crear primero</a></td></tr>` :
                filesRecientes.results.map((f: any) => {
                  const badgeComp = f.es_compartido_con_yo
                    ? `<span style="display:inline-block;background:linear-gradient(135deg,#6366f1,#0ea5e9);color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:3px;">COMP.</span>`
                    : f.compartido_con_nombre
                    ? `<span style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:white;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:3px;"><i class="fas fa-share-alt"></i></span>`
                    : ''
                  return `
                  <tr>
                    <td><strong style="color:#7B3FA0;">#${esc(f.numero)}</strong>${badgeComp}</td>
                    <td>${esc(f.cliente_nombre)}</td>
                    <td style="color:#6b7280;font-size:12px;">${esc(f.vendedor_nombre)}</td>
                    <td>${esc(f.destino_principal) || '<span style="color:#9ca3af">—</span>'}</td>
                    <td><span class="badge ${getBadge(f.estado)}">${getLabelEstado(f.estado)}</span></td>
                    <td><strong>$${Number(f.total_venta || 0).toLocaleString()}</strong></td>
                    <td style="font-size:12px;color:#9ca3af;">${esc(f.fecha_apertura?.split('T')[0]) || ''}</td>
                    <td>
                      <a href="/files/${f.id}" class="btn btn-outline btn-sm"><i class="fas fa-eye"></i></a>
                    </td>
                  </tr>
                `}).join('')}
            </tbody>
          </table>
        </div>
        <div style="padding:12px 20px;border-top:1px solid #ede5f5;text-align:center;">
          <a href="/files" style="color:#7B3FA0;font-size:13px;font-weight:600;">Ver todos los files →</a>
        </div>
      </div>
    `

    return c.html(baseLayout('Dashboard', content, user, 'dashboard'))
  } catch (e: any) {
    return c.html(baseLayout('Dashboard', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'dashboard'))
  }
})

export default dashboard
