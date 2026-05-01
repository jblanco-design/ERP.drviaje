import { Hono } from 'hono'
import { getUser, canAccessGastos, isAdminOrAbove } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }
const gastos = new Hono<{ Bindings: Bindings }>()

// ── Middleware: solo gerente y administración ────────────────
gastos.use('/gastos/*', async (c, next) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!canAccessGastos(user.rol)) {
    return c.html(`
      <div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;">
        <div style="background:white;border-radius:12px;padding:40px;max-width:400px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          <div style="font-size:48px;margin-bottom:16px;">🔒</div>
          <h2 style="color:#dc2626;margin-bottom:12px;">Acceso restringido</h2>
          <p style="color:#6b7280;margin-bottom:24px;">El módulo de Gastos Administrativos está disponible solo para Gerencia y Administración.</p>
          <a href="/dashboard" style="background:#7B3FA0;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">← Volver al Dashboard</a>
        </div>
      </div>
    `, 403)
  }
  return next()
})

const RUBROS: Record<string, string> = {
  marketing: 'Marketing & Publicidad',
  rrhh: 'Sueldos y Comisiones',
  oficina: 'Oficina y Servicios',
  software: 'Software y Tech',
  impuestos: 'Impuestos y Legal',
  otros: 'Otros'
}

gastos.get('/gastos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/dashboard')

  const mes = c.req.query('mes') || new Date().toISOString().substring(0, 7)
  const rubro = c.req.query('rubro') || ''

  try {
    let q = `SELECT g.*, u.nombre as usuario_nombre FROM gastos_admin g LEFT JOIN usuarios u ON g.usuario_id = u.id WHERE 1=1`
    const params: any[] = []
    if (mes) { q += ` AND strftime('%Y-%m', g.fecha) = ?`; params.push(mes) }
    if (rubro) { q += ' AND g.rubro = ?'; params.push(rubro) }
    q += ' ORDER BY g.fecha DESC LIMIT 200'
    const gastosList = await c.env.DB.prepare(q).bind(...params).all()

    // Totales por rubro
    const porRubro = await c.env.DB.prepare(`
      SELECT rubro, COALESCE(SUM(monto),0) as total, moneda
      FROM gastos_admin WHERE strftime('%Y-%m', fecha) = ?
      GROUP BY rubro, moneda ORDER BY total DESC
    `).bind(mes).all()

    const totalUYU = gastosList.results.filter((g: any) => g.moneda === 'UYU').reduce((s: number, g: any) => s + Number(g.monto), 0)
    const totalUSD = gastosList.results.filter((g: any) => g.moneda === 'USD').reduce((s: number, g: any) => s + Number(g.monto), 0)

    const rows = gastosList.results.map((g: any) => `
      <tr>
        <td style="font-size:12px;">${esc(g.fecha)}</td>
        <td>
          <span class="badge badge-cotizacion" style="font-size:11px;">${esc(RUBROS[g.rubro] || g.rubro)}</span>
        </td>
        <td>${esc(g.descripcion)}</td>
        <td>${esc(g.proveedor)||'—'}</td>
        <td><strong style="color:#dc2626;">$${Number(g.monto).toLocaleString()} ${esc(g.moneda)}</strong></td>
        <td style="font-size:11px;color:#9ca3af;">${esc(g.usuario_nombre)||''}</td>
        <td>
          <button onclick="eliminarGasto(${g.id})" class="btn btn-danger btn-sm"><i class="fas fa-trash"></i></button>
        </td>
      </tr>
    `).join('')

    const rubrosBarHtml = porRubro.results.map((r: any) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:130px;font-size:12px;color:#6b7280;">${RUBROS[r.rubro]||r.rubro}</div>
        <div style="flex:1;background:#f3e8ff;border-radius:4px;height:20px;overflow:hidden;">
          <div style="background:linear-gradient(90deg,#7B3FA0,#EC008C);height:100%;width:${Math.min(100, (r.total / Math.max(...porRubro.results.map((x: any)=>x.total))) * 100)}%;transition:width 0.5s;"></div>
        </div>
        <div style="width:100px;text-align:right;font-size:12px;font-weight:700;">$${Number(r.total).toLocaleString()} ${r.moneda}</div>
      </div>
    `).join('')

    const content = `
      <!-- Totales del mes -->
      <div class="grid-3" style="margin-bottom:20px;">
        <div class="stat-card">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">GASTOS MES (UYU)</div>
          <div style="font-size:24px;font-weight:800;color:#dc2626;">$U ${totalUYU.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:6px;">GASTOS MES (USD)</div>
          <div style="font-size:24px;font-weight:800;color:#dc2626;">$ ${totalUSD.toLocaleString()}</div>
        </div>
        <div class="stat-card" style="display:flex;align-items:center;justify-content:center;">
          <button onclick="document.getElementById('modal-gasto').classList.add('active')" class="btn btn-orange" style="width:100%;">
            <i class="fas fa-plus"></i> Registrar Gasto
          </button>
        </div>
      </div>

      ${porRubro.results.length > 0 ? `
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header"><span class="card-title">Distribución por Rubro - ${mes}</span></div>
          <div class="card-body">${rubrosBarHtml}</div>
        </div>
      ` : ''}

      <!-- Filtros -->
      <form method="GET" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:flex-end;">
        <div>
          <label class="form-label">Mes</label>
          <input type="month" name="mes" value="${mes}" class="form-control">
        </div>
        <div>
          <label class="form-label">Rubro</label>
          <select name="rubro" class="form-control" style="width:160px;">
            <option value="">Todos</option>
            ${Object.entries(RUBROS).map(([k, v]) => `<option value="${k}" ${rubro===k?'selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-filter"></i> Filtrar</button>
      </form>

      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-receipt" style="color:#dc2626"></i> Gastos de Estructura (${gastosList.results.length})</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Fecha</th><th>Rubro</th><th>Descripción</th><th>Proveedor</th><th>Monto</th><th>Operador</th><th>Acc.</th></tr></thead>
            <tbody>
              ${rows || `<tr><td colspan="7" style="text-align:center;padding:20px;color:#9ca3af;">Sin gastos registrados este mes.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal -->
      <div class="modal-overlay" id="modal-gasto">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-receipt" style="color:#dc2626"></i> Registrar Gasto</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-gasto').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/gastos">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">RUBRO *</label>
                  <select name="rubro" required class="form-control">
                    ${Object.entries(RUBROS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">FECHA *</label>
                  <input type="date" name="fecha" required value="${new Date().toISOString().split('T')[0]}" class="form-control">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">DESCRIPCIÓN *</label>
                <input type="text" name="descripcion" required class="form-control" placeholder="Ej: Alquiler oficina enero 2026">
              </div>
              <div class="form-group">
                <label class="form-label">PROVEEDOR / BENEFICIARIO</label>
                <input type="text" name="proveedor" class="form-control" placeholder="Ej: Inmobiliaria, Antel...">
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">MONTO *</label>
                  <input type="number" name="monto" required min="0" step="0.01" class="form-control">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA</label>
                  <select name="moneda" class="form-control">
                    <option value="UYU">UYU - Pesos</option>
                    <option value="USD">USD - Dólares</option>
                  </select>
                </div>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Registrar</button>
                <button type="button" onclick="document.getElementById('modal-gasto').classList.remove('active')" class="btn btn-outline">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
        async function eliminarGasto(id) {
          if(!confirm('¿Eliminar este gasto?')) return
          await fetch('/gastos/' + id, {method:'DELETE'})
          location.reload()
        }
      </script>
    `
    return c.html(baseLayout('Gastos Administrativos', content, user, 'gastos'))
  } catch (e: any) {
    return c.html(baseLayout('Gastos', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'gastos'))
  }
})

gastos.post('/gastos', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/gastos')
  const b = await c.req.parseBody()
  const monto = Number(b.monto)
  const MONEDAS_G = ['USD', 'UYU']
  const moneda = MONEDAS_G.includes(String(b.moneda)) ? String(b.moneda) : 'UYU'
  if (!isFinite(monto) || monto <= 0) return c.redirect('/gastos?error=monto_invalido')
  const rubro = String(b.rubro || '').trim().substring(0, 100)
  const descripcion = String(b.descripcion || '').trim().substring(0, 500)
  const proveedor = b.proveedor ? String(b.proveedor).trim().substring(0, 200) : null
  if (!rubro) return c.redirect('/gastos?error=rubro_requerido')
  await c.env.DB.prepare(`INSERT INTO gastos_admin (rubro, descripcion, monto, moneda, fecha, proveedor, usuario_id) VALUES (?,?,?,?,?,?,?)`).bind(rubro, descripcion, monto, moneda, b.fecha||null, proveedor, user.id).run()
  return c.redirect('/gastos')
})

gastos.delete('/gastos/:id', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'No autorizado' }, 403)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM gastos_admin WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

export default gastos
