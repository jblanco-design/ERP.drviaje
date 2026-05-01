import { Hono } from 'hono'
import { getUser, isAdminOrAbove, isSupervisorOrAbove } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }
const liquidaciones = new Hono<{ Bindings: Bindings }>()

// ── Helpers ───────────────────────────────────────────────────
function fmtUSD(n: number): string {
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(n: number): string {
  return (n < 0 ? '' : '+') + n.toFixed(2) + '%'
}

// Calcula la utilidad que le corresponde al vendedor en un file,
// teniendo en cuenta si es dueño o vendedor compartido (50%)
async function calcUtilidadVendedor(db: D1Database, fileId: number, vendedorId: number): Promise<{ utilidad: number; esCompartido: boolean; venta: number; costo: number }> {
  const file = await db.prepare('SELECT * FROM files WHERE id = ?').bind(fileId).first() as any
  if (!file) return { utilidad: 0, esCompartido: false, venta: 0, costo: 0 }
  const venta = Number(file.total_venta || 0)
  const costo = Number(file.total_costo || 0)
  const utilTotal = venta - costo

  // ¿Es el vendedor compartido?
  const comp = await db.prepare('SELECT * FROM file_compartido WHERE file_id = ? AND vendedor_id = ?').bind(fileId, vendedorId).first() as any
  if (comp) return { utilidad: utilTotal * 0.5, esCompartido: true, venta, costo }

  // ¿El file está compartido con otro? → el dueño recibe 50%
  const compOtro = await db.prepare('SELECT * FROM file_compartido WHERE file_id = ?').bind(fileId).first() as any
  if (compOtro) return { utilidad: utilTotal * 0.5, esCompartido: false, venta, costo }

  return { utilidad: utilTotal, esCompartido: false, venta, costo }
}

// Calcula cuánto ya se liquidó para un file+vendedor en liquidaciones aprobadas/pagadas
async function getUtilidadYaLiquidada(db: D1Database, fileId: number, vendedorId: number): Promise<number> {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(lf.utilidad_delta), 0) as total
    FROM liquidacion_files lf
    JOIN liquidaciones l ON l.id = lf.liquidacion_id
    WHERE lf.file_id = ? AND l.vendedor_id = ? AND l.estado IN ('aprobada','pagada')
  `).bind(fileId, vendedorId).first() as any
  return Number(row?.total || 0)
}

// ══════════════════════════════════════════════════════════════
// GET /liquidaciones — Lista de liquidaciones
// ══════════════════════════════════════════════════════════════
liquidaciones.get('/liquidaciones', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  // Vendedores pueden ver solo las suyas; superiores ven todas
  const puedeVerTodas = isSupervisorOrAbove(user.rol)

  try {
    const vendedores = puedeVerTodas
      ? await c.env.DB.prepare(`SELECT id, nombre FROM usuarios WHERE activo=1 AND rol IN ('vendedor','supervisor','administracion','gerente') ORDER BY nombre`).all()
      : { results: [] as any[] }

    const filtroVend = c.req.query('vendedor_id') || ''
    const whereVend = puedeVerTodas
      ? (filtroVend ? 'AND l.vendedor_id = ?' : '')
      : 'AND l.vendedor_id = ?'
    const bindVend: any[] = puedeVerTodas
      ? (filtroVend ? [filtroVend] : [])
      : [user.id]

    const lista = await c.env.DB.prepare(`
      SELECT l.*, u.nombre as vendedor_nombre,
             ap.nombre as aprobado_por_nombre,
             (SELECT COUNT(*) FROM liquidacion_files lf WHERE lf.liquidacion_id = l.id) as cant_files
      FROM liquidaciones l
      JOIN usuarios u ON u.id = l.vendedor_id
      LEFT JOIN usuarios ap ON ap.id = l.aprobado_por
      WHERE 1=1 ${whereVend}
      ORDER BY l.created_at DESC LIMIT 200
    `).bind(...bindVend).all()

    const estadoBadge = (e: string) => {
      if (e === 'borrador')  return `<span style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;">BORRADOR</span>`
      if (e === 'aprobada')  return `<span style="background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;">APROBADA</span>`
      if (e === 'pagada')    return `<span style="background:#e0e7ff;color:#3730a3;font-size:11px;font-weight:700;padding:2px 10px;border-radius:12px;">PAGADA</span>`
      return e
    }

    const rows = (lista.results as any[]).map(l => `
      <tr>
        <td><a href="/liquidaciones/${l.id}" style="color:#7B3FA0;font-weight:700;">#${l.id}</a></td>
        <td style="font-size:12px;">${esc(l.vendedor_nombre)}</td>
        <td style="font-size:12px;">${esc(l.periodo)}</td>
        <td style="font-size:12px;">${(l.fecha_liquidacion||'').split('T')[0]}</td>
        <td style="text-align:center;">${l.cant_files}</td>
        <td>
          <strong style="color:${Number(l.total_utilidad)<0?'#dc2626':'#059669'};">
            ${fmtUSD(Number(l.total_utilidad))} USD
          </strong>
        </td>
        <td>${estadoBadge(l.estado)}</td>
        <td style="font-size:11px;color:#9ca3af;">${esc(l.aprobado_por_nombre||'—')}</td>
        <td>
          <a href="/liquidaciones/${l.id}" class="btn btn-outline btn-sm"><i class="fas fa-eye"></i></a>
          ${l.estado === 'borrador' && isAdminOrAbove(user.rol) ? `
            <form method="POST" action="/liquidaciones/${l.id}/aprobar" style="display:inline;"
                  onsubmit="return confirm('¿Aprobar esta liquidación? No se podrán agregar más files.')">
              <button type="submit" class="btn btn-sm" style="background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;">
                <i class="fas fa-check"></i> Aprobar
              </button>
            </form>
          ` : ''}
          ${l.estado === 'aprobada' && isAdminOrAbove(user.rol) ? `
            <form method="POST" action="/liquidaciones/${l.id}/marcar-pagada" style="display:inline;"
                  onsubmit="return confirm('¿Marcar como pagada? Registra que el pago al vendedor fue realizado.')">
              <button type="submit" class="btn btn-sm" style="background:#e0e7ff;color:#3730a3;border:1px solid #c7d2fe;">
                <i class="fas fa-money-bill-wave"></i> Pagada
              </button>
            </form>
          ` : ''}
        </td>
      </tr>
    `).join('')

    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <h2 style="font-size:20px;font-weight:800;color:#1a1a2e;">
          <i class="fas fa-file-invoice-dollar" style="color:#7B3FA0;margin-right:8px;"></i>
          Liquidación de Comisiones
        </h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isAdminOrAbove(user.rol) ? `
            <a href="/liquidaciones/nueva" class="btn btn-primary">
              <i class="fas fa-plus"></i> Nueva Liquidación
            </a>
          ` : ''}
          <a href="/liquidaciones/pendientes" class="btn btn-outline" style="border-color:#F7941D;color:#F7941D;">
            <i class="fas fa-clock"></i> Ver Pendientes
          </a>
        </div>
      </div>

      <!-- Filtros -->
      ${puedeVerTodas ? `
        <form method="GET" style="background:white;padding:14px 16px;border-radius:10px;border:1.5px solid #e5e7eb;margin-bottom:20px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label style="display:block;font-size:11px;font-weight:700;color:#6b7280;margin-bottom:4px;">VENDEDOR</label>
            <select name="vendedor_id" class="form-control" style="min-width:180px;">
              <option value="">— Todos —</option>
              ${(vendedores.results as any[]).map(v => `<option value="${v.id}" ${filtroVend==v.id?'selected':''}>${esc(v.nombre)}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Filtrar</button>
          <a href="/liquidaciones" class="btn btn-outline btn-sm">Limpiar</a>
        </form>
      ` : ''}

      <div class="card">
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>#</th><th>Vendedor</th><th>Período</th><th>Fecha</th>
                <th>Files</th><th>Utilidad Total</th><th>Estado</th><th>Aprobado por</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="9" style="text-align:center;padding:30px;color:#9ca3af;">No hay liquidaciones aún.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `
    return c.html(baseLayout('Liquidaciones', content, user, 'liquidaciones'))
  } catch (e: any) {
    return c.html(baseLayout('Liquidaciones', `<div class="alert alert-danger">Error: ${e.message}</div>`, user, 'liquidaciones'))
  }
})

// ══════════════════════════════════════════════════════════════
// GET /liquidaciones/pendientes — Files con utilidad no liquidada
// ══════════════════════════════════════════════════════════════
liquidaciones.get('/liquidaciones/pendientes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const puedeVerTodas = isSupervisorOrAbove(user.rol)
  const filtroVend = c.req.query('vendedor_id') || (puedeVerTodas ? '' : String(user.id))

  try {
    const vendedores = puedeVerTodas
      ? await c.env.DB.prepare(`SELECT id, nombre FROM usuarios WHERE activo=1 AND rol IN ('vendedor','supervisor','administracion','gerente') ORDER BY nombre`).all()
      : { results: [] as any[] }

    // Files en estado seniado o cerrado con utilidad pendiente de liquidar
    // Para cada vendedor buscamos:
    //   1. Files donde es el dueño (con ajuste si está compartido)
    //   2. Files donde es el compartido
    const whereVend = filtroVend ? 'AND (f.vendedor_id = ? OR fc_mine.vendedor_id = ?)' : ''
    const bindWhere = filtroVend ? [filtroVend, filtroVend] : []

    const filesRows = await c.env.DB.prepare(`
      SELECT
        f.id, f.numero, f.estado, f.total_venta, f.total_costo, f.moneda, f.fecha_apertura,
        COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo) as cliente,
        u.nombre as vendedor_nombre, u.id as vendedor_id,
        fc.vendedor_id as compartido_con_id,
        uc.nombre as compartido_con_nombre,
        fc_mine.vendedor_id as es_compartido_conmigo
      FROM files f
      JOIN clientes cl ON cl.id = f.cliente_id
      JOIN usuarios u  ON u.id  = f.vendedor_id
      LEFT JOIN file_compartido fc      ON fc.file_id      = f.id
      LEFT JOIN usuarios uc             ON uc.id           = fc.vendedor_id
      LEFT JOIN file_compartido fc_mine ON fc_mine.file_id = f.id AND fc_mine.vendedor_id = ${filtroVend || 'NULL'}
      WHERE f.estado IN ('seniado','cerrado')
      ${whereVend}
      ORDER BY u.nombre, f.fecha_apertura DESC
    `).bind(...bindWhere).all()

    // Para cada file calculamos utilidad pendiente por vendedor
    type FilePendiente = {
      file: any
      vendedorId: number
      vendedorNombre: string
      esCompartido: boolean
      utilTotal: number
      utilVendedor: number
      yaLiquidado: number
      pendiente: number
    }

    const pendientes: FilePendiente[] = []

    for (const f of filesRows.results as any[]) {
      const venta  = Number(f.total_venta || 0)
      const costo  = Number(f.total_costo || 0)
      const utilTotal = venta - costo

      // Dueño del file
      const tieneCompartido = !!f.compartido_con_id
      const utilDuenio = tieneCompartido ? utilTotal * 0.5 : utilTotal
      const yaLiqDuenio = await getUtilidadYaLiquidada(c.env.DB, f.id, f.vendedor_id)
      const pendienteDuenio = utilDuenio - yaLiqDuenio

      if (!filtroVend || String(f.vendedor_id) === String(filtroVend)) {
        pendientes.push({
          file: f,
          vendedorId:     f.vendedor_id,
          vendedorNombre: f.vendedor_nombre,
          esCompartido:   false,
          utilTotal,
          utilVendedor:   utilDuenio,
          yaLiquidado:    yaLiqDuenio,
          pendiente:      pendienteDuenio,
        })
      }

      // Vendedor compartido
      if (f.compartido_con_id) {
        const yaLiqComp = await getUtilidadYaLiquidada(c.env.DB, f.id, f.compartido_con_id)
        const utilComp  = utilTotal * 0.5
        const pendienteComp = utilComp - yaLiqComp

        if (!filtroVend || String(f.compartido_con_id) === String(filtroVend)) {
          const vendNombre = await c.env.DB.prepare('SELECT nombre FROM usuarios WHERE id=?').bind(f.compartido_con_id).first() as any
          pendientes.push({
            file: f,
            vendedorId:     f.compartido_con_id,
            vendedorNombre: vendNombre?.nombre || '?',
            esCompartido:   true,
            utilTotal,
            utilVendedor:   utilComp,
            yaLiquidado:    yaLiqComp,
            pendiente:      pendienteComp,
          })
        }
      }
    }

    // Filtrar solo los que tienen algo pendiente (≠ 0)
    const conPendiente = pendientes.filter(p => Math.abs(p.pendiente) > 0.001)

    // Agrupar por vendedor para mostrar totales
    const porVendedor: Record<number, { nombre: string; total: number; files: FilePendiente[] }> = {}
    for (const p of conPendiente) {
      if (!porVendedor[p.vendedorId]) porVendedor[p.vendedorId] = { nombre: p.vendedorNombre, total: 0, files: [] }
      porVendedor[p.vendedorId].total += p.pendiente
      porVendedor[p.vendedorId].files.push(p)
    }

    // HTML de tarjetas por vendedor
    const cardsHtml = Object.entries(porVendedor).map(([vId, vData]) => `
      <div class="card" style="margin-bottom:20px;">
        <div style="padding:16px 20px;background:linear-gradient(135deg,#5a2d75,#7B3FA0);border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:1px;">VENDEDOR</div>
            <div style="color:white;font-size:18px;font-weight:800;">${esc(vData.nombre)}</div>
          </div>
          <div style="text-align:right;">
            <div style="color:rgba(255,255,255,0.7);font-size:11px;">TOTAL PENDIENTE</div>
            <div style="font-size:22px;font-weight:800;color:${vData.total<0?'#fca5a5':'#F7941D'};">
              ${fmtUSD(vData.total)} USD
            </div>
          </div>
        </div>
        <div class="table-wrapper">
          <table class="table" style="margin:0;">
            <thead>
              <tr>
                <th>File</th><th>Cliente</th><th>Estado</th>
                <th>Venta Total</th><th>Costo Total</th><th>Util. Total</th>
                <th style="color:#7B3FA0;">% Util.</th>
                <th>Util. Vendedor</th><th>Ya Liquidado</th>
                <th style="color:#F7941D;">PENDIENTE</th><th>Compartido</th>
              </tr>
            </thead>
            <tbody>
              ${vData.files.map(p => {
                const venta = Number(p.file.total_venta || 0)
                const pctUtil = venta > 0 ? (p.utilTotal / venta * 100) : 0
                const pctColor = pctUtil >= 10 ? '#059669' : pctUtil >= 5 ? '#d97706' : '#dc2626'
                return `
                <tr style="${Math.abs(p.pendiente) > 0 && p.pendiente < 0 ? 'background:#fff5f5;' : ''}">
                  <td><a href="/files/${p.file.id}" style="color:#7B3FA0;font-weight:700;">#${esc(p.file.numero).replace(/^\d{4}/,'')}</a></td>
                  <td style="font-size:12px;">${esc(p.file.cliente)}</td>
                  <td><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:#f3f4f6;">${esc(p.file.estado)}</span></td>
                  <td style="font-size:12px;">${fmtUSD(Number(p.file.total_venta||0))}</td>
                  <td style="font-size:12px;color:#6b7280;">${fmtUSD(Number(p.file.total_costo||0))}</td>
                  <td style="font-size:12px;">${fmtUSD(p.utilTotal)}</td>
                  <td style="font-size:12px;font-weight:700;color:${pctColor};">
                    ${pctUtil.toFixed(1)}%
                  </td>
                  <td style="font-size:12px;color:#7B3FA0;font-weight:600;">
                    ${fmtUSD(p.utilVendedor)}
                    ${p.esCompartido ? '<span style="font-size:9px;background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:8px;margin-left:3px;">50%</span>' : ''}
                  </td>
                  <td style="font-size:12px;color:#6b7280;">${fmtUSD(p.yaLiquidado)}</td>
                  <td style="font-weight:800;color:${p.pendiente<0?'#dc2626':'#059669'};">${fmtUSD(p.pendiente)}</td>
                  <td style="font-size:11px;color:#6b7280;">
                    ${p.esCompartido ? `con ${esc(p.file.vendedor_nombre)}` : (p.file.compartido_con_nombre ? `con ${esc(p.file.compartido_con_nombre)}` : '—')}
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
        ${isAdminOrAbove(user.rol) ? `
          <div style="padding:14px 20px;border-top:1px solid #f3e8ff;background:#faf5ff;border-radius:0 0 12px 12px;">
            <form method="POST" action="/liquidaciones/generar" style="display:inline-flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <input type="hidden" name="vendedor_id" value="${vId}">
              <div>
                <label style="font-size:11px;font-weight:700;color:#6b7280;">PERÍODO</label>
                <input type="month" name="periodo" class="form-control" style="width:160px;"
                       value="${(() => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth() - 1, 1).toISOString().substring(0,7) })()}" required>
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#6b7280;">FECHA DE LIQUIDACIÓN</label>
                <input type="date" name="fecha_liquidacion" class="form-control" style="width:160px;"
                       value="${new Date().toISOString().split('T')[0]}" required>
              </div>
              <div style="padding-top:18px;">
                <button type="submit" class="btn btn-primary"
                        onclick="return confirm('¿Generar liquidación en BORRADOR para ${esc(vData.nombre)}?')">
                  <i class="fas fa-file-invoice-dollar"></i> Generar Liquidación
                </button>
              </div>
            </form>
          </div>
        ` : ''}
      </div>
    `).join('')

    const content = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <div>
          <a href="/liquidaciones" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver a Liquidaciones</a>
          <h2 style="font-size:20px;font-weight:800;color:#1a1a2e;margin-top:6px;">
            <i class="fas fa-clock" style="color:#F7941D;margin-right:8px;"></i>
            Utilidades Pendientes de Liquidar
          </h2>
        </div>
        ${puedeVerTodas ? `
          <form method="GET" style="display:flex;gap:10px;align-items:flex-end;">
            <div>
              <label style="display:block;font-size:11px;font-weight:700;color:#6b7280;margin-bottom:3px;">FILTRAR VENDEDOR</label>
              <select name="vendedor_id" class="form-control" style="min-width:180px;">
                <option value="">— Todos —</option>
                ${(vendedores.results as any[]).map(v => `<option value="${v.id}" ${filtroVend==String(v.id)?'selected':''}>${esc(v.nombre)}</option>`).join('')}
              </select>
            </div>
            <button type="submit" class="btn btn-primary btn-sm">Filtrar</button>
          </form>
        ` : ''}
      </div>

      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#92400e;">
        <i class="fas fa-info-circle"></i>
        Se muestran los files en estado <strong>Señado</strong> o <strong>Cerrado</strong> que tienen utilidad pendiente de liquidar.
        El importe pendiente considera lo ya abonado en liquidaciones anteriores (aprobadas o pagadas).
      </div>

      ${Object.keys(porVendedor).length === 0
        ? `<div class="card" style="padding:40px;text-align:center;color:#9ca3af;">
             <i class="fas fa-check-circle" style="font-size:40px;color:#059669;margin-bottom:12px;"></i>
             <div style="font-size:16px;font-weight:700;">Todo liquidado</div>
             <div style="margin-top:6px;">No hay utilidades pendientes de liquidar.</div>
           </div>`
        : cardsHtml
      }
    `
    return c.html(baseLayout('Pendientes de Liquidar', content, user, 'liquidaciones'))
  } catch (e: any) {
    return c.html(baseLayout('Pendientes', `<div class="alert alert-danger">Error: ${e.message}</div>`, user, 'liquidaciones'))
  }
})

// ══════════════════════════════════════════════════════════════
// POST /liquidaciones/generar — Genera borrador con todos los
// files pendientes de un vendedor
// ══════════════════════════════════════════════════════════════
liquidaciones.post('/liquidaciones/generar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/liquidaciones?error=sin_permiso')

  const body = await c.req.parseBody()
  const vendedorId = Number(body.vendedor_id)
  const periodo    = String(body.periodo || '')
  const fechaLiq   = String(body.fecha_liquidacion || new Date().toISOString().split('T')[0])

  if (!vendedorId || !periodo) return c.redirect('/liquidaciones/pendientes?error=datos_invalidos')

  try {
    // Obtener todos los files seniados/cerrados del vendedor con pendiente
    const filesOwn = await c.env.DB.prepare(`
      SELECT f.*, COALESCE(cl.nombre||' '||cl.apellido,cl.nombre_completo) as cliente,
             fc.vendedor_id as compartido_con_id
      FROM files f
      JOIN clientes cl ON cl.id = f.cliente_id
      LEFT JOIN file_compartido fc ON fc.file_id = f.id
      WHERE f.estado IN ('seniado','cerrado') AND f.vendedor_id = ?
    `).bind(vendedorId).all()

    const filesComp = await c.env.DB.prepare(`
      SELECT f.*, COALESCE(cl.nombre||' '||cl.apellido,cl.nombre_completo) as cliente,
             1 as es_comp
      FROM files f
      JOIN clientes cl ON cl.id = f.cliente_id
      JOIN file_compartido fc ON fc.file_id = f.id AND fc.vendedor_id = ?
      WHERE f.estado IN ('seniado','cerrado')
    `).bind(vendedorId).all()

    type FilePend = { file: any; esComp: boolean; utilVend: number; yaLiq: number; delta: number }
    const lineas: FilePend[] = []

    for (const f of [...(filesOwn.results as any[])]) {
      const venta = Number(f.total_venta || 0)
      const costo = Number(f.total_costo || 0)
      const utilTotal = venta - costo
      const tieneComp = !!f.compartido_con_id
      const utilVend = tieneComp ? utilTotal * 0.5 : utilTotal
      const yaLiq = await getUtilidadYaLiquidada(c.env.DB, f.id, vendedorId)
      const delta = utilVend - yaLiq
      if (Math.abs(delta) > 0.001) lineas.push({ file: f, esComp: false, utilVend, yaLiq, delta })
    }

    for (const f of filesComp.results as any[]) {
      const venta = Number(f.total_venta || 0)
      const costo = Number(f.total_costo || 0)
      const utilTotal = venta - costo
      const utilVend = utilTotal * 0.5
      const yaLiq = await getUtilidadYaLiquidada(c.env.DB, f.id, vendedorId)
      const delta = utilVend - yaLiq
      if (Math.abs(delta) > 0.001) lineas.push({ file: f, esComp: true, utilVend, yaLiq, delta })
    }

    if (lineas.length === 0) return c.redirect('/liquidaciones/pendientes?info=sin_pendientes')

    const totalUtilidad = lineas.reduce((s, l) => s + l.delta, 0)

    // Crear la liquidación en estado borrador
    const liqResult = await c.env.DB.prepare(`
      INSERT INTO liquidaciones (vendedor_id, periodo, fecha_liquidacion, estado, total_utilidad, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'borrador', ?, ?, datetime('now'), datetime('now'))
    `).bind(vendedorId, periodo, fechaLiq, totalUtilidad, user.id).run()

    const liqId = liqResult.meta.last_row_id

    // Insertar líneas de detalle
    for (const l of lineas) {
      const esAjuste = l.yaLiq !== 0 ? 1 : 0
      await c.env.DB.prepare(`
        INSERT INTO liquidacion_files
          (liquidacion_id, file_id, utilidad_anterior, utilidad_base, utilidad_delta,
           file_numero, file_total_venta, file_total_costo, es_compartido, es_ajuste)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).bind(
        liqId, l.file.id,
        l.yaLiq, l.utilVend, l.delta,
        l.file.numero, l.file.total_venta, l.file.total_costo,
        l.esComp ? 1 : 0, esAjuste
      ).run()
    }

    return c.redirect(`/liquidaciones/${liqId}`)
  } catch (e: any) {
    return c.redirect(`/liquidaciones/pendientes?error=${encodeURIComponent(e.message)}`)
  }
})

// ══════════════════════════════════════════════════════════════
// GET /liquidaciones/:id — Detalle de una liquidación
// ══════════════════════════════════════════════════════════════
liquidaciones.get('/liquidaciones/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id = c.req.param('id')

  try {
    const liq = await c.env.DB.prepare(`
      SELECT l.*, u.nombre as vendedor_nombre,
             ap.nombre as aprobado_por_nombre,
             cr.nombre as created_by_nombre
      FROM liquidaciones l
      JOIN usuarios u  ON u.id  = l.vendedor_id
      LEFT JOIN usuarios ap ON ap.id = l.aprobado_por
      LEFT JOIN usuarios cr ON cr.id = l.created_by
      WHERE l.id = ?
    `).bind(id).first() as any

    if (!liq) return c.redirect('/liquidaciones')

    // Solo el propio vendedor o superiores pueden ver
    if (!isSupervisorOrAbove(user.rol) && user.id != liq.vendedor_id)
      return c.redirect('/liquidaciones')

    const detalles = await c.env.DB.prepare(`
      SELECT lf.*,
             COALESCE(cl.nombre||' '||cl.apellido,cl.nombre_completo,'—') as cliente,
             f.estado as file_estado, f.destino_principal
      FROM liquidacion_files lf
      JOIN files f ON f.id = lf.file_id
      LEFT JOIN clientes cl ON cl.id = f.cliente_id
      WHERE lf.liquidacion_id = ?
      ORDER BY lf.es_ajuste ASC, lf.id ASC
    `).bind(id).all()

    const estadoBadge = (e: string) => {
      if (e === 'borrador') return `<span style="background:#fef3c7;color:#92400e;font-size:13px;font-weight:700;padding:3px 12px;border-radius:14px;">BORRADOR</span>`
      if (e === 'aprobada') return `<span style="background:#d1fae5;color:#065f46;font-size:13px;font-weight:700;padding:3px 12px;border-radius:14px;">APROBADA</span>`
      if (e === 'pagada')   return `<span style="background:#e0e7ff;color:#3730a3;font-size:13px;font-weight:700;padding:3px 12px;border-radius:14px;">PAGADA</span>`
      return e
    }

    const totalPos = (detalles.results as any[]).filter(d => Number(d.utilidad_delta) >= 0).reduce((s, d) => s + Number(d.utilidad_delta), 0)
    const totalNeg = (detalles.results as any[]).filter(d => Number(d.utilidad_delta) < 0).reduce((s, d) => s + Number(d.utilidad_delta), 0)
    const totalNet = Number(liq.total_utilidad)

    const filasDetalle = (detalles.results as any[]).map(d => {
      const delta = Number(d.utilidad_delta)
      const esNeg = delta < 0
      const esAj  = d.es_ajuste
      return `
        <tr style="${esNeg ? 'background:#fff5f5;' : esAj ? 'background:#fffbeb;' : ''}">
          <td>
            <a href="/files/${d.file_id}" style="color:#7B3FA0;font-weight:700;">#${esc(d.file_numero)}</a>
            ${d.es_compartido ? `<span style="display:inline-block;background:#e0e7ff;color:#3730a3;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:4px;">50%</span>` : ''}
            ${esAj ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:9px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:4px;">AJUSTE</span>` : ''}
          </td>
          <td style="font-size:12px;">${esc(d.cliente)}</td>
          <td style="font-size:12px;">${esc(d.destino_principal||'—')}</td>
          <td><span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:8px;background:#f3f4f6;">${esc(d.file_estado)}</span></td>
          <td style="font-size:12px;">${fmtUSD(Number(d.file_total_venta))}</td>
          <td style="font-size:12px;color:#6b7280;">${fmtUSD(Number(d.file_total_costo))}</td>
          <td style="font-size:12px;color:#7B3FA0;font-weight:600;">${fmtUSD(Number(d.utilidad_base))}</td>
          <td style="font-size:12px;color:#9ca3af;">${fmtUSD(Number(d.utilidad_anterior))}</td>
          <td style="font-weight:800;font-size:14px;color:${esNeg?'#dc2626':'#059669'};">
            ${esNeg?'':'+'} ${fmtUSD(delta)}
          </td>
        </tr>
      `
    }).join('')

    const content = `
      <div style="margin-bottom:20px;">
        <a href="/liquidaciones" style="color:#7B3FA0;font-size:13px;"><i class="fas fa-arrow-left"></i> Volver a Liquidaciones</a>
      </div>

      <!-- Cabezal -->
      <div class="card" style="margin-bottom:20px;">
        <div style="padding:20px;background:linear-gradient(135deg,#5a2d75,#7B3FA0);border-radius:12px 12px 0 0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:1px;">LIQUIDACIÓN DE COMISIONES</div>
              <div style="color:white;font-size:26px;font-weight:800;">#${liq.id} — ${esc(liq.vendedor_nombre)}</div>
              <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                ${estadoBadge(liq.estado)}
                <span style="color:rgba(255,255,255,0.7);font-size:12px;">Período: <strong style="color:white;">${esc(liq.periodo)}</strong></span>
                <span style="color:rgba(255,255,255,0.7);font-size:12px;">Fecha: <strong style="color:white;">${(liq.fecha_liquidacion||'').split('T')[0]}</strong></span>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="color:rgba(255,255,255,0.7);font-size:11px;">UTILIDAD TOTAL A LIQUIDAR</div>
              <div style="font-size:28px;font-weight:800;color:${totalNet<0?'#fca5a5':'#F7941D'};">${fmtUSD(totalNet)} USD</div>
            </div>
          </div>
        </div>
        <div class="card-body">
          <div class="grid-3">
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;">CREADA POR</div>
              <div style="font-weight:700;">${esc(liq.created_by_nombre||'—')}</div>
              <div style="font-size:12px;color:#9ca3af;">${(liq.created_at||'').split('T')[0]}</div>
            </div>
            ${liq.aprobado_por ? `
              <div>
                <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;">APROBADA POR</div>
                <div style="font-weight:700;">${esc(liq.aprobado_por_nombre||'—')}</div>
                <div style="font-size:12px;color:#9ca3af;">${(liq.aprobado_at||'').split('T')[0]}</div>
              </div>
            ` : '<div></div>'}
            <div>
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;">RESUMEN</div>
              <div style="font-size:13px;">
                <span style="color:#059669;font-weight:700;">+${fmtUSD(totalPos)}</span> nuevas utilidades
              </div>
              ${totalNeg < 0 ? `
                <div style="font-size:13px;">
                  <span style="color:#dc2626;font-weight:700;">${fmtUSD(totalNeg)}</span> ajustes negativos
                </div>
              ` : ''}
            </div>
          </div>
          ${liq.notas ? `<div style="margin-top:12px;padding:10px;background:#f9fafb;border-radius:8px;font-size:13px;"><i class="fas fa-sticky-note" style="color:#9ca3af;margin-right:6px;"></i>${esc(liq.notas)}</div>` : ''}
        </div>
      </div>

      <!-- Acciones según estado -->
      ${liq.estado === 'borrador' && isAdminOrAbove(user.rol) ? `
        <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
          <form method="POST" action="/liquidaciones/${id}/aprobar"
                onsubmit="return confirm('¿Aprobar la liquidación? Los files quedarán registrados como liquidados.')">
            <button type="submit" class="btn btn-primary" style="background:linear-gradient(135deg,#059669,#10b981);">
              <i class="fas fa-check-circle"></i> Aprobar Liquidación
            </button>
          </form>
          <form method="POST" action="/liquidaciones/${id}/eliminar"
                onsubmit="return confirm('¿Eliminar este borrador?')">
            <button type="submit" class="btn btn-danger">
              <i class="fas fa-trash"></i> Eliminar Borrador
            </button>
          </form>
        </div>
      ` : ''}
      ${liq.estado === 'aprobada' && isAdminOrAbove(user.rol) ? `
        <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;">
          <form method="POST" action="/liquidaciones/${id}/marcar-pagada"
                onsubmit="return confirm('¿Marcar como pagada? Registra que el pago al vendedor fue efectuado.')">
            <button type="submit" class="btn btn-primary" style="background:linear-gradient(135deg,#3730a3,#6366f1);">
              <i class="fas fa-money-bill-wave"></i> Marcar como Pagada
            </button>
          </form>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#92400e;">
          <i class="fas fa-info-circle"></i> Esta liquidación fue aprobada. Para registrar el pago, utilizá el botón "Marcar como Pagada".
          El movimiento de caja se registra manualmente en <a href="/tesoreria" style="color:#92400e;font-weight:700;">Tesorería</a>.
        </div>
      ` : ''}
      ${liq.estado === 'pagada' ? `
        <div style="background:#e0e7ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#3730a3;">
          <i class="fas fa-check-circle"></i> Esta liquidación fue <strong>pagada</strong> el ${(liq.aprobado_at||'').split('T')[0]}.
        </div>
      ` : ''}

      <!-- Tabla de detalle -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-list" style="color:#7B3FA0;"></i> Detalle de Files (${detalles.results.length})</span>
        </div>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>File</th><th>Cliente</th><th>Destino</th><th>Estado</th>
                <th>Venta</th><th>Costo</th>
                <th>Util. Vendedor</th><th>Ya Liquidado</th>
                <th style="color:#F7941D;">DELTA (a pagar)</th>
              </tr>
            </thead>
            <tbody>${filasDetalle}</tbody>
            <tfoot>
              <tr style="background:#f9fafb;font-weight:800;">
                <td colspan="8" style="text-align:right;padding:10px 16px;font-size:14px;">TOTAL NETO A PAGAR:</td>
                <td style="font-size:16px;color:${totalNet<0?'#dc2626':'#059669'};">${fmtUSD(totalNet)} USD</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `
    return c.html(baseLayout(`Liquidación #${id}`, content, user, 'liquidaciones'))
  } catch (e: any) {
    return c.html(baseLayout('Liquidación', `<div class="alert alert-danger">Error: ${e.message}</div>`, user, 'liquidaciones'))
  }
})

// ══════════════════════════════════════════════════════════════
// POST /liquidaciones/:id/aprobar
// ══════════════════════════════════════════════════════════════
liquidaciones.post('/liquidaciones/:id/aprobar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect(`/liquidaciones/${c.req.param('id')}?error=sin_permiso`)

  const id = c.req.param('id')
  try {
    const liq = await c.env.DB.prepare('SELECT * FROM liquidaciones WHERE id = ?').bind(id).first() as any
    if (!liq || liq.estado !== 'borrador') return c.redirect(`/liquidaciones/${id}`)

    await c.env.DB.prepare(`
      UPDATE liquidaciones
      SET estado='aprobada', aprobado_por=?, aprobado_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).bind(user.id, id).run()

    return c.redirect(`/liquidaciones/${id}`)
  } catch (e: any) {
    return c.redirect(`/liquidaciones/${id}?error=${encodeURIComponent(e.message)}`)
  }
})

// ══════════════════════════════════════════════════════════════
// POST /liquidaciones/:id/marcar-pagada
// ══════════════════════════════════════════════════════════════
liquidaciones.post('/liquidaciones/:id/marcar-pagada', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect(`/liquidaciones/${c.req.param('id')}?error=sin_permiso`)

  const id = c.req.param('id')
  try {
    const liq = await c.env.DB.prepare('SELECT * FROM liquidaciones WHERE id = ?').bind(id).first() as any
    if (!liq || liq.estado !== 'aprobada') return c.redirect(`/liquidaciones/${id}`)

    await c.env.DB.prepare(`
      UPDATE liquidaciones
      SET estado='pagada', aprobado_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).bind(id).run()

    return c.redirect(`/liquidaciones/${id}`)
  } catch (e: any) {
    return c.redirect(`/liquidaciones/${id}?error=${encodeURIComponent(e.message)}`)
  }
})

// ══════════════════════════════════════════════════════════════
// POST /liquidaciones/:id/eliminar — Solo borradores
// ══════════════════════════════════════════════════════════════
liquidaciones.post('/liquidaciones/:id/eliminar', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/liquidaciones')

  const id = c.req.param('id')
  try {
    const liq = await c.env.DB.prepare('SELECT estado FROM liquidaciones WHERE id=?').bind(id).first() as any
    if (!liq || liq.estado !== 'borrador') return c.redirect(`/liquidaciones/${id}`)

    await c.env.DB.prepare('DELETE FROM liquidaciones WHERE id=?').bind(id).run()
    return c.redirect('/liquidaciones')
  } catch {
    return c.redirect('/liquidaciones')
  }
})

export default liquidaciones
