import { Hono } from 'hono'
import { getUser, canSeeReportes, canSeeAllFiles, isAdminOrAbove } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'
import { getOrFetch } from '../lib/cache'

type Bindings = { DB: D1Database }

// ── Validación de fechas — previene SQL injection via interpolación ──────────
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const MONTH_REGEX = /^\d{4}-\d{2}$/

function safeDate(val: string | undefined, fallback: string): string {
  if (!val) return fallback
  const clean = val.trim().substring(0, 10)
  return DATE_REGEX.test(clean) ? clean : fallback
}

function safeMonth(val: string | undefined, fallback: string): string {
  if (!val) return fallback
  const clean = val.trim().substring(0, 7)
  return MONTH_REGEX.test(clean) ? clean : fallback
}
const reportes = new Hono<{ Bindings: Bindings }>()

// ── Middleware: reportes solo para supervisor, administración y gerente ──
reportes.use('*', async (c, next) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!canSeeReportes(user.rol)) {
    return c.html(`
      <div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;">
        <div style="background:white;border-radius:12px;padding:40px;max-width:400px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          <div style="font-size:48px;margin-bottom:16px;">🔒</div>
          <h2 style="color:#dc2626;margin-bottom:12px;">Acceso restringido</h2>
          <p style="color:#6b7280;margin-bottom:24px;">Los Reportes están disponibles para Supervisor, Administración y Gerencia.</p>
          <a href="/dashboard" style="background:#7B3FA0;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">← Volver al Dashboard</a>
        </div>
      </div>
    `, 403)
  }
  return next()
})

// ─────────────────────────────────────────────────────────────
// Helper: genera CSV y devuelve como descarga
// ─────────────────────────────────────────────────────────────
function csvResponse(filename: string, headers: string[], rows: string[][]): Response {
  const BOM = '\uFEFF'
  const escape = (v: any) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))]
  const body = BOM + lines.join('\r\n')
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

// ══════════════════════════════════════════════════════════════
// GET /reportes  — Dashboard principal (filtrable por mes + vendedor)
// ══════════════════════════════════════════════════════════════
reportes.get('/reportes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const vendedorId   = c.req.query('vendedor_id') || ''
  const isGerente    = isAdminOrAbove(user.rol)
  const ordenRanking = c.req.query('orden') === 'utilidad' ? 'utilidad' : 'facturacion'
  const modoFecha    = c.req.query('modo') === 'rango' ? 'rango' : 'mes'

  // Valores de fecha
  const mes   = safeMonth(c.req.query('mes'), new Date().toISOString().substring(0, 7))
  const desde = safeDate(c.req.query('desde'), mes + '-01')
  const hastaRaw = c.req.query('hasta') || ''
  const hasta = safeDate(hastaRaw || undefined, (() => {
    const [y, m2] = mes.split('-').map(Number)
    return `${mes}-${String(new Date(y, m2, 0).getDate()).padStart(2,'0')}`
  })()

  // Condición WHERE dinámica por fecha
  const fechaCond = modoFecha === 'rango'
    ? `date(f.fecha_apertura) BETWEEN '${desde}' AND '${hasta}'`
    : `strftime('%Y-%m', f.fecha_apertura) = '${mes}'`
  const fechaCondPlain = modoFecha === 'rango'
    ? `date(fecha_apertura) BETWEEN '${desde}' AND '${hasta}'`
    : `strftime('%Y-%m', fecha_apertura) = '${mes}'`
  const periodoLabel = modoFecha === 'rango' ? `${desde} → ${hasta}` : mes

  const filtroVendedor = !isGerente ? user.id : (vendedorId || null)

  try {
    // ── Datos estáticos desde caché ───────────────────────────
    const [vendedores, proveedoresList] = await Promise.all([
      isGerente
        ? getOrFetch('vendedores:reporte', () =>
            c.env.DB.prepare(`SELECT id, nombre FROM usuarios WHERE rol IN ('vendedor','supervisor','administracion','gerente') AND email != 'gerente@drviaje.com' ORDER BY nombre`).all()
          )
        : Promise.resolve({ results: [] as any[] }),
      getOrFetch('proveedores:activos', () =>
        c.env.DB.prepare(`SELECT id, nombre FROM proveedores WHERE activo = 1 ORDER BY nombre`).all()
      ),
    ])

    const whereVendF     = filtroVendedor ? ' AND f.vendedor_id = ?' : ''
    const whereVendPlain  = filtroVendedor ? ' AND vendedor_id = ?' : ''
    const paramVend: any[] = filtroVendedor ? [filtroVendedor] : []

    // ── Queries del período — todas en paralelo ───────────────
    const gastosCond = modoFecha === 'rango'
      ? `date(fecha) BETWEEN '${desde}' AND '${hasta}'`
      : `strftime('%Y-%m', fecha) = '${mes}'`

    // Evolución 6 meses: una sola query con GROUP BY en vez de 6 queries secuenciales
    const [año, mesNum] = mes.split('-')
    const meses6: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(parseInt(año), parseInt(mesNum) - 1 - i, 1)
      meses6.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const mesMin = meses6[0] + '-01'
    const mesMaxDate = new Date(parseInt(meses6[5].split('-')[0]), parseInt(meses6[5].split('-')[1]), 0)
    const mesMax = meses6[5] + '-' + String(mesMaxDate.getDate()).padStart(2, '0')

    const evolucionQuery = !filtroVendedor
      ? c.env.DB.prepare(`
          SELECT strftime('%Y-%m', fecha_apertura) as mes,
                 COALESCE(SUM(total_venta),0) as v,
                 COALESCE(SUM(total_costo),0) as c,
                 COUNT(*) as n
          FROM files
          WHERE estado NOT IN ('anulado')
            AND date(fecha_apertura) BETWEEN '${mesMin}' AND '${mesMax}'
          GROUP BY strftime('%Y-%m', fecha_apertura)
        `).all()
      : c.env.DB.prepare(`
          SELECT strftime('%Y-%m', f.fecha_apertura) as mes,
                 COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_venta*0.5 ELSE f.total_venta END),0) as v,
                 COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_costo*0.5 ELSE f.total_costo END),0) as c,
                 COUNT(f.id) as n
          FROM files f
          LEFT JOIN file_compartido fc ON fc.file_id = f.id
          WHERE f.vendedor_id = ? AND f.estado NOT IN ('anulado')
            AND date(f.fecha_apertura) BETWEEN '${mesMin}' AND '${mesMax}'
          GROUP BY strftime('%Y-%m', f.fecha_apertura)
        `).bind(filtroVendedor).all()

    const evolucionCompQuery = filtroVendedor
      ? c.env.DB.prepare(`
          SELECT strftime('%Y-%m', f.fecha_apertura) as mes,
                 COALESCE(SUM(f.total_venta*0.5),0) as v,
                 COALESCE(SUM(f.total_costo*0.5),0) as c,
                 COUNT(f.id) as n
          FROM file_compartido fc
          JOIN files f ON f.id = fc.file_id
          WHERE fc.vendedor_id = ? AND f.estado NOT IN ('anulado')
            AND date(f.fecha_apertura) BETWEEN '${mesMin}' AND '${mesMax}'
          GROUP BY strftime('%Y-%m', f.fecha_apertura)
        `).bind(filtroVendedor).all()
      : Promise.resolve({ results: [] as any[] })

    // Todas las queries del período en paralelo
    const [
      ventasMesRaw,
      ventasMesComp,
      gastosMesRaw,
      filesPorEstadoRaw,
      destinosData,
      evolucionRaw,
      evolucionCompRaw,
      propiosRankRaw,
      compartidosRankRaw,
      filesDetalleRaw,
      filesDetalleCompRaw,
    ] = await Promise.all([
      // Ventas propias del período
      !filtroVendedor
        ? c.env.DB.prepare(
            `SELECT COALESCE(SUM(total_venta),0) as venta, COALESCE(SUM(total_costo),0) as costo, COUNT(*) as total_files
             FROM files WHERE estado NOT IN ('anulado') AND ${fechaCondPlain}`
          ).first()
        : c.env.DB.prepare(`
            SELECT
              COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_venta*0.5 ELSE f.total_venta END),0) as venta,
              COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_costo*0.5 ELSE f.total_costo END),0) as costo,
              COUNT(f.id) as total_files
            FROM files f
            LEFT JOIN file_compartido fc ON fc.file_id = f.id
            WHERE f.vendedor_id = ? AND f.estado NOT IN ('anulado') AND ${fechaCondPlain}
          `).bind(filtroVendedor).first(),

      // Ventas compartidas del período
      filtroVendedor
        ? c.env.DB.prepare(`
            SELECT
              COALESCE(SUM(f.total_venta*0.5),0) as venta,
              COALESCE(SUM(f.total_costo*0.5),0) as costo,
              COUNT(f.id) as total_files
            FROM files f
            JOIN file_compartido fc ON fc.file_id = f.id AND fc.vendedor_id = ?
            WHERE f.estado NOT IN ('anulado') AND ${fechaCondPlain}
          `).bind(filtroVendedor).first()
        : Promise.resolve(null),

      // Gastos admin
      (isGerente && !filtroVendedor)
        ? c.env.DB.prepare(`SELECT COALESCE(SUM(monto),0) as total FROM gastos_admin WHERE ${gastosCond} AND moneda='USD'`).first()
        : Promise.resolve({ total: 0 }),

      // Files por estado
      c.env.DB.prepare(
        `SELECT estado, COUNT(*) as cantidad, COALESCE(SUM(total_venta),0) as total
         FROM files WHERE estado NOT IN ('anulado') AND ${fechaCondPlain}${whereVendPlain} GROUP BY estado`
      ).bind(...paramVend).all(),

      // Top destinos
      c.env.DB.prepare(`
        SELECT s.destino_codigo, COUNT(*) as cantidad,
               SUM(s.precio_venta) as total_venta, SUM(s.costo_original) as total_costo
        FROM servicios s JOIN files f ON s.file_id = f.id
        WHERE s.destino_codigo IS NOT NULL AND s.destino_codigo != ''
          AND f.estado NOT IN ('anulado') AND ${fechaCond}${whereVendF}
        GROUP BY s.destino_codigo ORDER BY total_venta DESC LIMIT 10
      `).bind(...paramVend).all(),

      // Evolución 6 meses (propios)
      evolucionQuery,

      // Evolución 6 meses (compartidos)
      evolucionCompQuery,

      // Ranking propios (solo gerente sin filtro)
      (isGerente && !filtroVendedor)
        ? c.env.DB.prepare(`
            SELECT u.id, u.nombre,
                   COUNT(f.id) as total_files,
                   COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_venta*0.5 ELSE f.total_venta END),0) as total_venta,
                   COALESCE(SUM(CASE WHEN fc.id IS NOT NULL THEN f.total_costo*0.5 ELSE f.total_costo END),0) as total_costo
            FROM usuarios u
            LEFT JOIN files f ON f.vendedor_id = u.id
              AND f.estado NOT IN ('anulado') AND ${fechaCond}
            LEFT JOIN file_compartido fc ON fc.file_id = f.id
            WHERE u.rol IN ('vendedor','supervisor','administracion','gerente') AND u.email != 'gerente@drviaje.com'
            GROUP BY u.id, u.nombre
          `).all()
        : Promise.resolve({ results: [] as any[] }),

      // Ranking compartidos (solo gerente sin filtro)
      (isGerente && !filtroVendedor)
        ? c.env.DB.prepare(`
            SELECT fc.vendedor_id as id,
                   COUNT(f.id) as total_files,
                   COALESCE(SUM(f.total_venta*0.5),0) as total_venta,
                   COALESCE(SUM(f.total_costo*0.5),0) as total_costo
            FROM file_compartido fc
            JOIN files f ON f.id = fc.file_id
              AND f.estado NOT IN ('anulado') AND ${fechaCond}
            GROUP BY fc.vendedor_id
          `).all()
        : Promise.resolve({ results: [] as any[] }),

      // Files detalle propios
      !filtroVendedor
        ? c.env.DB.prepare(`
            SELECT f.id, f.numero, f.estado, f.fecha_apertura, f.destino_principal,
                   f.total_venta, f.total_costo, f.moneda,
                   COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente,
                   u.nombre as vendedor,
                   fc2.vendedor_id as compartido_con_id,
                   uc.nombre as compartido_con_nombre,
                   NULL as es_compartido_con_yo
            FROM files f
            LEFT JOIN clientes cl ON f.cliente_id = cl.id
            LEFT JOIN usuarios u ON f.vendedor_id = u.id
            LEFT JOIN file_compartido fc2 ON fc2.file_id = f.id
            LEFT JOIN usuarios uc ON uc.id = fc2.vendedor_id
            WHERE f.estado NOT IN ('anulado') AND ${fechaCond}
            ORDER BY f.fecha_apertura DESC LIMIT 200
          `).all()
        : c.env.DB.prepare(`
            SELECT f.id, f.numero, f.estado, f.fecha_apertura, f.destino_principal,
                   CASE WHEN fc.id IS NOT NULL THEN f.total_venta*0.5 ELSE f.total_venta END as total_venta,
                   CASE WHEN fc.id IS NOT NULL THEN f.total_costo*0.5 ELSE f.total_costo END as total_costo,
                   f.moneda,
                   COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente,
                   u.nombre as vendedor,
                   fc.vendedor_id as compartido_con_id,
                   uc.nombre as compartido_con_nombre,
                   0 as es_compartido_con_yo
            FROM files f
            LEFT JOIN clientes cl ON f.cliente_id = cl.id
            LEFT JOIN usuarios u ON f.vendedor_id = u.id
            LEFT JOIN file_compartido fc ON fc.file_id = f.id
            LEFT JOIN usuarios uc ON uc.id = fc.vendedor_id
            WHERE f.vendedor_id = ? AND f.estado NOT IN ('anulado') AND ${fechaCond}
            ORDER BY f.fecha_apertura DESC LIMIT 200
          `).bind(filtroVendedor).all(),

      // Files detalle compartidos con el vendedor
      filtroVendedor
        ? c.env.DB.prepare(`
            SELECT f.id, f.numero, f.estado, f.fecha_apertura, f.destino_principal,
                   f.total_venta*0.5 as total_venta, f.total_costo*0.5 as total_costo,
                   f.moneda,
                   COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente,
                   u.nombre as vendedor,
                   NULL as compartido_con_id, NULL as compartido_con_nombre,
                   1 as es_compartido_con_yo
            FROM file_compartido fc
            JOIN files f ON f.id = fc.file_id
            LEFT JOIN clientes cl ON f.cliente_id = cl.id
            LEFT JOIN usuarios u ON f.vendedor_id = u.id
            WHERE fc.vendedor_id = ? AND f.estado NOT IN ('anulado') AND ${fechaCond}
            ORDER BY f.fecha_apertura DESC LIMIT 200
          `).bind(filtroVendedor).all()
        : Promise.resolve({ results: [] as any[] }),
    ])

    // ── Procesar resultados ───────────────────────────────────
    const ventasMesP = ventasMesRaw as any
    const ventasMesC = ventasMesComp as any
    const ventasMes = filtroVendedor
      ? {
          venta:       Number(ventasMesP?.venta||0) + Number(ventasMesC?.venta||0),
          costo:       Number(ventasMesP?.costo||0) + Number(ventasMesC?.costo||0),
          total_files: Number(ventasMesP?.total_files||0) + Number(ventasMesC?.total_files||0),
        }
      : ventasMesP

    const gastosMes = gastosMesRaw as any

    const utilidadBruta = Number(ventasMes?.venta || 0) - Number(ventasMes?.costo || 0)
    const utilidadNeta  = utilidadBruta - Number(gastosMes?.total || 0)

    // Files por estado
    const estadosMap: Record<string, any> = {}
    filesPorEstadoRaw.results.forEach((e: any) => { estadosMap[e.estado] = e })

    // Evolución 6 meses — construir desde resultados agregados
    const evMap: Record<string, any> = {}
    ;(evolucionRaw.results as any[]).forEach((r: any) => { evMap[r.mes] = { v: Number(r.v), c: Number(r.c), n: Number(r.n) } })
    ;(evolucionCompRaw.results as any[]).forEach((r: any) => {
      if (evMap[r.mes]) {
        evMap[r.mes].v += Number(r.v); evMap[r.mes].c += Number(r.c); evMap[r.mes].n += Number(r.n)
      } else {
        evMap[r.mes] = { v: Number(r.v), c: Number(r.c), n: Number(r.n) }
      }
    })
    const ultimosMeses = meses6.map(m => ({
      mes: m,
      venta: evMap[m]?.v || 0,
      costo: evMap[m]?.c || 0,
      files: evMap[m]?.n || 0,
    }))

    // Ranking vendedores
    let vendedoresRanking: any[] = []
    if (isGerente && !filtroVendedor) {
      const rankMap: Record<number, any> = {}
      ;(propiosRankRaw.results as any[]).forEach((r: any) => {
        rankMap[r.id] = { id: r.id, nombre: r.nombre, total_files: Number(r.total_files), total_venta: Number(r.total_venta), total_costo: Number(r.total_costo) }
      })
      ;(compartidosRankRaw.results as any[]).forEach((r: any) => {
        if (rankMap[r.id]) {
          rankMap[r.id].total_files += Number(r.total_files)
          rankMap[r.id].total_venta += Number(r.total_venta)
          rankMap[r.id].total_costo += Number(r.total_costo)
        }
      })
      vendedoresRanking = Object.values(rankMap).sort((a, b) =>
        ordenRanking === 'utilidad'
          ? (b.total_venta - b.total_costo) - (a.total_venta - a.total_costo)
          : b.total_venta - a.total_venta
      )
    }

    // Files detalle
    let filesDetalle: any
    if (!filtroVendedor) {
      filesDetalle = filesDetalleRaw
    } else {
      const todos = [...(filesDetalleRaw.results as any[]), ...(filesDetalleCompRaw.results as any[])]
      todos.sort((a, b) => (b.fecha_apertura || '').localeCompare(a.fecha_apertura || ''))
      filesDetalle = { results: todos.slice(0, 200) }
    }

    // ── JSON para charts ──────────────────────────────────────
    const chartLabels   = JSON.stringify(ultimosMeses.map(m => m.mes))
    const chartVentas   = JSON.stringify(ultimosMeses.map(m => m.venta))
    const chartCostos   = JSON.stringify(ultimosMeses.map(m => m.costo))
    const chartUtilidad = JSON.stringify(ultimosMeses.map(m => m.venta - m.costo))
    const chartFiles    = JSON.stringify(ultimosMeses.map(m => m.files))
    const destLabels    = JSON.stringify(destinosData.results.map((d: any) => d.destino_codigo))
    const destValues    = JSON.stringify(destinosData.results.map((d: any) => Number(d.total_venta||0)))

    // Nombre del vendedor seleccionado para el título
    const vendedorNombre = filtroVendedor
      ? ((vendedores.results as any[]).find((v: any) => String(v.id) === String(filtroVendedor))?.nombre || 'Vendedor')
      : null
    const exportParams = modoFecha === 'rango'
      ? `modo=rango&desde=${desde}&hasta=${hasta}${filtroVendedor ? '&vendedor_id='+filtroVendedor : ''}`
      : `mes=${mes}${filtroVendedor ? '&vendedor_id='+filtroVendedor : ''}`

    const content = `
      <!-- Filtros -->
      <form method="GET" style="background:white;padding:16px;border-radius:12px;border:1.5px solid #e5e7eb;margin-bottom:24px;">
        <!-- Toggle modo -->
        <div style="display:flex;gap:4px;background:#f3f4f6;padding:3px;border-radius:8px;width:fit-content;margin-bottom:14px;">
          <button type="button" id="btn-modo-mes" onclick="setModo('mes')"
            style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:6px;border:none;cursor:pointer;
                   ${modoFecha==='mes'?'background:white;color:#7B3FA0;box-shadow:0 1px 3px rgba(0,0,0,.15);':'background:transparent;color:#6b7280;'}">
            <i class="fas fa-calendar-alt"></i> Por Mes
          </button>
          <button type="button" id="btn-modo-rango" onclick="setModo('rango')"
            style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:6px;border:none;cursor:pointer;
                   ${modoFecha==='rango'?'background:white;color:#7B3FA0;box-shadow:0 1px 3px rgba(0,0,0,.15);':'background:transparent;color:#6b7280;'}">
            <i class="fas fa-calendar-week"></i> Rango de Fechas
          </button>
        </div>
        <input type="hidden" name="modo" id="input-modo" value="${modoFecha}">

        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <!-- Panel mes -->
          <div id="panel-mes" style="${modoFecha==='rango'?'display:none;':''}">
            <label class="form-label">MES / PERÍODO</label>
            <input type="month" name="mes" id="input-mes" value="${mes}" class="form-control">
          </div>
          <!-- Panel rango -->
          <div id="panel-rango" style="display:flex;gap:8px;align-items:flex-end;${modoFecha==='mes'?'display:none;':''}">
            <div>
              <label class="form-label">DESDE</label>
              <input type="date" name="desde" id="input-desde" value="${desde}" class="form-control">
            </div>
            <div>
              <label class="form-label">HASTA</label>
              <input type="date" name="hasta" id="input-hasta" value="${hasta}" class="form-control">
            </div>
          </div>
          ${isGerente ? `
          <div>
            <label class="form-label">VENDEDOR</label>
            <select name="vendedor_id" class="form-control" style="width:180px;">
              <option value="">— Todos —</option>
              ${(vendedores.results as any[]).map((v: any) => `
                <option value="${v.id}" ${String(v.id)===String(vendedorId)?'selected':''}>${esc(v.nombre)}</option>
              `).join('')}
            </select>
          </div>` : ''}
          <button type="submit" class="btn btn-primary"><i class="fas fa-chart-bar"></i> Ver Reportes</button>
          <a href="/reportes" class="btn btn-outline"><i class="fas fa-times"></i> Limpiar</a>
          <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">
            <a href="/reportes/cuentas-corrientes" class="btn btn-sm" style="background:#0369a1;color:white;border:none;">
              <i class="fas fa-file-invoice-dollar"></i> Ctas. Corrientes
            </a>
            <button type="button" onclick="abrirModalExport('conciliacion-proveedores')" class="btn btn-sm" style="background:#b45309;color:white;border:none;">
              <i class="fas fa-file-excel"></i> Proveedores
            </button>
            <button type="button" onclick="abrirModalExport('ventas')" class="btn btn-sm" style="background:#217346;color:white;border:none;">
              <i class="fas fa-file-excel"></i> Ventas
            </button>
            <button type="button" onclick="abrirModalExport('files')" class="btn btn-sm" style="background:#1d6f42;color:white;border:none;">
              <i class="fas fa-file-excel"></i> Files
            </button>
            <button type="button" onclick="abrirModalExport('servicios-pagados')" class="btn btn-sm" style="background:#0369a1;color:white;border:none;">
              <i class="fas fa-file-excel"></i> Servicios Pagados
            </button>
            <button type="button" onclick="abrirModalExport('servicios-pendientes')" class="btn btn-sm" style="background:#7B3FA0;color:white;border:none;">
              <i class="fas fa-file-excel"></i> Servicios Pendientes
            </button>
          </div>
        </div>
      </form>

      <!-- Modal de exportación con filtros -->
      <div id="modal-export" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:center;justify-content:center;padding:16px;">
        <div style="background:white;border-radius:14px;width:100%;max-width:520px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="background:linear-gradient(135deg,#217346,#1d6f42);border-radius:14px 14px 0 0;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
            <div style="color:white;font-size:16px;font-weight:700;"><i class="fas fa-file-excel"></i> <span id="modal-export-titulo">Exportar</span></div>
            <button onclick="cerrarModalExport()" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:16px;">✕</button>
          </div>
          <div style="padding:20px;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#166534;">
              <i class="fas fa-info-circle"></i> Filtrá para descargar solo lo que necesitás. Dejá los campos vacíos para exportar todo.
            </div>

            <!-- Rango de fechas -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">FECHA DESDE</label>
                <input type="date" id="exp-desde" class="form-control" style="font-size:13px;">
              </div>
              <div>
                <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">FECHA HASTA</label>
                <input type="date" id="exp-hasta" class="form-control" style="font-size:13px;">
              </div>
            </div>

            <!-- Proveedor (solo para servicios pagados/pendientes/proveedores) -->
            <div id="exp-campo-proveedor" style="margin-bottom:12px;display:none;">
              <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">PROVEEDOR</label>
              <select id="exp-proveedor" class="form-control" style="font-size:13px;">
                <option value="">Todos los proveedores</option>
                ${(proveedoresList.results as any[]).map((p: any) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
              </select>
            </div>

            <!-- Tipo de servicio (solo para servicios pagados/pendientes) -->
            <div id="exp-campo-tipo" style="margin-bottom:12px;display:none;">
              <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">TIPO DE SERVICIO</label>
              <select id="exp-tipo" class="form-control" style="font-size:13px;">
                <option value="">Todos los tipos</option>
                <option value="aereo">✈ Aéreo</option>
                <option value="hotel">🏨 Hotel</option>
                <option value="traslado">🚗 Traslado</option>
                <option value="tour">🗺 Tour</option>
                <option value="seguro">🛡 Seguro</option>
                <option value="otro">📦 Otro</option>
              </select>
            </div>

            <!-- Vendedor (para ventas y files) -->
            <div id="exp-campo-vendedor" style="margin-bottom:12px;display:none;">
              <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">VENDEDOR</label>
              <select id="exp-vendedor" class="form-control" style="font-size:13px;">
                <option value="">Todos los vendedores</option>
                ${(vendedores.results as any[]).map((v: any) => `<option value="${v.id}">${esc(v.nombre)}</option>`).join('')}
              </select>
            </div>

            <!-- Estado del file (para files) -->
            <div id="exp-campo-estado" style="margin-bottom:16px;display:none;">
              <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">ESTADO DEL FILE</label>
              <select id="exp-estado" class="form-control" style="font-size:13px;">
                <option value="">Todos los estados</option>
                <option value="en_proceso">En Proceso</option>
                <option value="seniado">Señado</option>
                <option value="cerrado">Cerrado</option>
                <option value="anulado">Anulado</option>
              </select>
            </div>

            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button onclick="cerrarModalExport()" class="btn btn-outline">Cancelar</button>
              <button onclick="ejecutarExport()" class="btn btn-primary" style="background:#217346;">
                <i class="fas fa-download"></i> Descargar CSV
              </button>
            </div>
          </div>
        </div>
      </div>

      <script>
        let tipoExportActual = ''

        const titulos = {
          'ventas': 'Exportar Ventas',
          'files': 'Exportar Files',
          'servicios-pagados': 'Exportar Servicios Pagados',
          'servicios-pendientes': 'Exportar Servicios Pendientes',
          'conciliacion-proveedores': 'Exportar Conciliación Proveedores'
        }

        function abrirModalExport(tipo) {
          tipoExportActual = tipo
          document.getElementById('modal-export-titulo').textContent = titulos[tipo] || 'Exportar'
          document.getElementById('modal-export').style.display = 'flex'

          // Mostrar/ocultar campos según tipo
          const showProv  = ['servicios-pagados','servicios-pendientes','conciliacion-proveedores'].includes(tipo)
          const showVend  = ['ventas','files'].includes(tipo)
          const showState = tipo === 'files'
          const showTipo  = ['servicios-pagados','servicios-pendientes'].includes(tipo)

          document.getElementById('exp-campo-proveedor').style.display = showProv  ? 'block' : 'none'
          document.getElementById('exp-campo-vendedor').style.display  = showVend  ? 'block' : 'none'
          document.getElementById('exp-campo-estado').style.display    = showState ? 'block' : 'none'
          document.getElementById('exp-campo-tipo').style.display      = showTipo  ? 'block' : 'none'
        }

        function cerrarModalExport() {
          document.getElementById('modal-export').style.display = 'none'
        }

        function ejecutarExport() {
          const desde    = document.getElementById('exp-desde').value
          const hasta    = document.getElementById('exp-hasta').value
          const provId   = document.getElementById('exp-proveedor')?.value || ''
          const vendId   = document.getElementById('exp-vendedor')?.value  || ''
          const estado   = document.getElementById('exp-estado')?.value    || ''
          const tipo     = document.getElementById('exp-tipo')?.value      || ''

          const params = new URLSearchParams()
          if (desde)  params.set('desde',        desde)
          if (hasta)  params.set('hasta',        hasta)
          if (provId) params.set('proveedor_id', provId)
          if (vendId) params.set('vendedor_id',  vendId)
          if (estado) params.set('estado',       estado)
          if (tipo)   params.set('tipo',         tipo)

          window.location.href = '/reportes/exportar/' + tipoExportActual + (params.toString() ? '?' + params.toString() : '')
          cerrarModalExport()
        }

        // Cerrar con Escape
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape') cerrarModalExport()
        })
      </script>

      <script>
        function setModo(modo) {
          document.getElementById('input-modo').value = modo
          const esMes = modo === 'mes'
          document.getElementById('panel-mes').style.display   = esMes ? '' : 'none'
          document.getElementById('panel-rango').style.display = esMes ? 'none' : 'flex'
          const btnM = document.getElementById('btn-modo-mes')
          const btnR = document.getElementById('btn-modo-rango')
          btnM.style.cssText = esMes
            ? 'font-size:12px;font-weight:600;padding:5px 14px;border-radius:6px;border:none;cursor:pointer;background:white;color:#7B3FA0;box-shadow:0 1px 3px rgba(0,0,0,.15);'
            : 'font-size:12px;font-weight:600;padding:5px 14px;border-radius:6px;border:none;cursor:pointer;background:transparent;color:#6b7280;'
          btnR.style.cssText = !esMes
            ? 'font-size:12px;font-weight:600;padding:5px 14px;border-radius:6px;border:none;cursor:pointer;background:white;color:#7B3FA0;box-shadow:0 1px 3px rgba(0,0,0,.15);'
            : 'font-size:12px;font-weight:600;padding:5px 14px;border-radius:6px;border:none;cursor:pointer;background:transparent;color:#6b7280;'
          if (!esMes) {
            const m = document.getElementById('input-mes').value || '${mes}'
            const [y,mo] = m.split('-').map(Number)
            const last = new Date(y,mo,0).getDate()
            document.getElementById('input-desde').value = m+'-01'
            document.getElementById('input-hasta').value = m+'-'+String(last).padStart(2,'0')
          }
        }
      </script>

      ${vendedorNombre ? `
        <div style="background:linear-gradient(135deg,#7B3FA0,#EC008C);color:white;border-radius:12px;padding:14px 20px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
          <i class="fas fa-user-tie" style="font-size:20px;"></i>
          <div>
            <div style="font-size:11px;opacity:0.8;letter-spacing:1px;">DASHBOARD DE VENDEDOR</div>
            <div style="font-size:18px;font-weight:800;">${esc(vendedorNombre)} — ${periodoLabel}</div>
          </div>
        </div>
      ` : ''}

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">VENTAS ${periodoLabel}</div>
          <div style="font-size:24px;font-weight:800;color:#5a2d75;">$${Number(ventasMes?.venta||0).toLocaleString()}</div>
          <div style="font-size:11px;color:#9ca3af;">${Number(ventasMes?.total_files||0)} files</div>
        </div>
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">COSTOS</div>
          <div style="font-size:24px;font-weight:800;color:#dc2626;">$${Number(ventasMes?.costo||0).toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">UTILIDAD BRUTA</div>
          <div style="font-size:24px;font-weight:800;color:#059669;">$${utilidadBruta.toLocaleString()}</div>
          <div style="font-size:11px;color:#9ca3af;">Margen: ${Number(ventasMes?.venta||0) > 0 ? ((utilidadBruta/Number(ventasMes.venta))*100).toFixed(1) : 0}%</div>
        </div>
        ${isGerente && !filtroVendedor ? `
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">UTILIDAD NETA</div>
          <div style="font-size:24px;font-weight:800;color:${utilidadNeta>=0?'#059669':'#dc2626'};">$${utilidadNeta.toLocaleString()}</div>
          <div style="font-size:11px;color:#9ca3af;">Gastos: $${Number(gastosMes?.total||0).toLocaleString()}</div>
        </div>
        ` : ''}
        ${['en_proceso','seniado','cerrado'].map(est => {
          const data = estadosMap[est] || { cantidad: 0, total: 0 }
          const labels: Record<string,string> = { en_proceso:'En Proceso', seniado:'Señado', cerrado:'Cerrado' }
          const colors: Record<string,string> = { en_proceso:'#0369a1', seniado:'#b45309', cerrado:'#065f46' }
          return `
            <div class="stat-card">
              <div style="font-size:10px;font-weight:700;color:${colors[est]};letter-spacing:1px;margin-bottom:4px;">${labels[est]}</div>
              <div style="font-size:24px;font-weight:800;color:${colors[est]};">${data.cantidad}</div>
              <div style="font-size:11px;color:#9ca3af;">$${Number(data.total||0).toLocaleString()}</div>
            </div>
          `
        }).join('')}
      </div>

      <!-- Gráficos -->
      ${filtroVendedor ? `
        <!-- Con filtro vendedor: 2 gráficos de barras separados (facturación y utilidad) + destinos -->
        <div class="grid-2" style="margin-bottom:24px;">
          <div class="card">
            <div class="card-header"><span class="card-title"><i class="fas fa-chart-bar" style="color:#7B3FA0"></i> Facturación últimos 6 meses</span></div>
            <div class="card-body"><canvas id="chartFacturacion" height="220"></canvas></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title"><i class="fas fa-chart-bar" style="color:#059669"></i> Utilidad últimos 6 meses</span></div>
            <div class="card-body"><canvas id="chartUtilidad" height="220"></canvas></div>
          </div>
        </div>
        <div class="card" style="margin-bottom:24px;">
          <div class="card-header"><span class="card-title"><i class="fas fa-map-marked-alt" style="color:#F7941D"></i> Top Destinos — ${periodoLabel}</span></div>
          <div class="card-body">
            ${destinosData.results.length > 0
              ? `<canvas id="chartDestinos" height="160"></canvas>`
              : `<div style="text-align:center;padding:40px;color:#9ca3af;">Sin datos de destinos</div>`}
          </div>
        </div>
      ` : `
        <!-- Sin filtro: 2 gráficos de barras separados + destinos abajo -->
        <div class="grid-2" style="margin-bottom:24px;">
          <div class="card">
            <div class="card-header"><span class="card-title"><i class="fas fa-chart-bar" style="color:#7B3FA0"></i> Facturación últimos 6 meses</span></div>
            <div class="card-body"><canvas id="chartFacturacion" height="220"></canvas></div>
          </div>
          <div class="card">
            <div class="card-header"><span class="card-title"><i class="fas fa-chart-bar" style="color:#059669"></i> Utilidad últimos 6 meses</span></div>
            <div class="card-body"><canvas id="chartUtilidad" height="220"></canvas></div>
          </div>
        </div>
        <div class="card" style="margin-bottom:24px;">
          <div class="card-header"><span class="card-title"><i class="fas fa-map-marked-alt" style="color:#F7941D"></i> Top Destinos — ${periodoLabel}</span></div>
          <div class="card-body">
            ${destinosData.results.length > 0
              ? `<canvas id="chartDestinos" height="160"></canvas>`
              : `<div style="text-align:center;padding:40px;color:#9ca3af;">Sin datos de destinos</div>`}
          </div>
        </div>
      `}

      <!-- Ranking vendedores (gerente sin filtro) -->
      ${isGerente && !filtroVendedor && vendedoresRanking.length > 0 ? `
        <div class="card" style="margin-bottom:24px;">
          <div class="card-header" style="flex-wrap:wrap;gap:8px;">
            <span class="card-title"><i class="fas fa-trophy" style="color:#F7941D"></i> Ranking Vendedores — ${periodoLabel}</span>
            <div style="display:flex;align-items:center;gap:8px;margin-left:auto;">
              <!-- Filtro de ordenamiento -->
              <div style="display:flex;gap:4px;background:#f3f4f6;padding:3px;border-radius:8px;">
                <a href="/reportes?${modoFecha==='rango'?`modo=rango&desde=${desde}&hasta=${hasta}`:`mes=${mes}`}&orden=facturacion"
                   style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;text-decoration:none;
                          ${ordenRanking === 'facturacion' ? 'background:white;color:#7B3FA0;box-shadow:0 1px 3px rgba(0,0,0,.15);' : 'color:#6b7280;'}">
                  <i class="fas fa-dollar-sign"></i> Facturación
                </a>
                <a href="/reportes?${modoFecha==='rango'?`modo=rango&desde=${desde}&hasta=${hasta}`:`mes=${mes}`}&orden=utilidad"
                   style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:6px;text-decoration:none;
                          ${ordenRanking === 'utilidad' ? 'background:white;color:#7B3FA0;box-shadow:0 1px 3px rgba(0,0,0,.15);' : 'color:#6b7280;'}">
                  <i class="fas fa-chart-line"></i> Utilidad
                </a>
              </div>
              <a href="/reportes/exportar/vendedores?mes=${mes}" class="btn btn-sm" style="background:#217346;color:white;border:none;font-size:12px;">
                <i class="fas fa-file-excel"></i> Exportar
              </a>
            </div>
          </div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>#</th><th>Vendedor</th><th>Files</th><th>Ventas</th><th>Costos</th><th>Utilidad</th><th>Margen</th><th></th></tr></thead>
              <tbody>
                ${vendedoresRanking.map((v: any, i: number) => {
                  const utilidad = Number(v.total_venta) - Number(v.total_costo)
                  const margen   = v.total_venta > 0 ? ((utilidad / v.total_venta) * 100).toFixed(1) : '0'
                  const utilNeg  = utilidad < 0
                  const margNeg  = parseFloat(margen) < 0
                  const utilColor  = utilNeg  ? '#dc2626' : '#F7941D'
                  const margColor  = margNeg  ? '#dc2626' : parseFloat(margen) >= 20 ? '#059669' : '#d97706'
                  return `
                    <tr>
                      <td style="font-size:16px;">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</td>
                      <td>
                        <strong>${esc(v.nombre)}</strong>
                        <div style="font-size:10px;color:#9ca3af;margin-top:1px;"><i class="fas fa-info-circle"></i> incluye 50% de files compartidos</div>
                      </td>
                      <td style="text-align:center;">${v.total_files}</td>
                      <td><strong style="color:#059669;">$${Number(v.total_venta).toLocaleString()}</strong></td>
                      <td style="color:#6b7280;">$${Number(v.total_costo).toLocaleString()}</td>
                      <td><strong style="color:${utilColor};">${utilNeg ? '-' : ''}$${Math.abs(utilidad).toLocaleString()}</strong></td>
                      <td><span style="font-size:12px;font-weight:700;color:${margColor};">${margen}%</span></td>
                      <td>
                        <a href="/reportes?${modoFecha==='rango'?`modo=rango&desde=${desde}&hasta=${hasta}`:`mes=${mes}`}&vendedor_id=${v.id}" class="btn btn-outline btn-sm" style="font-size:11px;">
                          <i class="fas fa-chart-bar"></i> Dashboard
                        </a>
                      </td>
                    </tr>
                  `
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Top destinos tabla -->
      ${destinosData.results.length > 0 ? `
        <div class="card" style="margin-bottom:24px;">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-globe" style="color:#7B3FA0"></i> Detalle por Destino — ${mes}</span>
            <a href="/reportes/exportar/destinos?mes=${mes}${filtroVendedor ? '&vendedor_id='+filtroVendedor : ''}" class="btn btn-sm" style="background:#217346;color:white;border:none;font-size:12px;">
              <i class="fas fa-file-excel"></i> Exportar
            </a>
          </div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Destino (IATA)</th><th>Servicios</th><th>Venta Total</th><th>Costo Total</th><th>Utilidad</th><th>Margen</th></tr></thead>
              <tbody>
                ${(destinosData.results as any[]).map((d: any) => {
                  const util   = Number(d.total_venta||0) - Number(d.total_costo||0)
                  const margen = d.total_venta > 0 ? ((util / d.total_venta) * 100).toFixed(1) : '0'
                  return `
                    <tr>
                      <td><strong style="color:#7B3FA0;">${esc(d.destino_codigo)}</strong></td>
                      <td style="text-align:center;">${d.cantidad}</td>
                      <td><strong style="color:#059669;">$${Number(d.total_venta||0).toLocaleString()}</strong></td>
                      <td style="color:#6b7280;">$${Number(d.total_costo||0).toLocaleString()}</td>
                      <td><strong style="color:${util < 0 ? '#dc2626' : '#F7941D'};">${util < 0 ? '-' : ''}$${Math.abs(util).toLocaleString()}</strong></td>
                      <td><span style="font-size:12px;font-weight:700;color:${parseFloat(margen) < 0 ? '#dc2626' : parseFloat(margen)>=20?'#059669':'#d97706'}">${margen}%</span></td>
                    </tr>
                  `
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Detalle de files del mes -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-folder-open" style="color:#5a2d75"></i> Files del período ${periodoLabel} (${filesDetalle.results.length})</span>
          <a href="/reportes/exportar/files?mes=${mes}${filtroVendedor ? '&vendedor_id='+filtroVendedor : ''}" class="btn btn-sm" style="background:#217346;color:white;border:none;font-size:12px;">
            <i class="fas fa-file-excel"></i> Exportar
          </a>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Nº File</th><th>Fecha</th><th>Cliente</th><th>Destino</th>
                ${isGerente && !filtroVendedor ? '<th>Vendedor</th>' : ''}
                <th>Estado</th><th>Venta</th><th>Costo</th><th>Utilidad</th><th>Margen</th>
              </tr>
            </thead>
            <tbody>
              ${(filesDetalle.results as any[]).length === 0 ? `
                <tr><td colspan="10" style="text-align:center;padding:24px;color:#9ca3af;">Sin files en este período</td></tr>
              ` : (filesDetalle.results as any[]).map((f: any) => {
                const util   = Number(f.total_venta||0) - Number(f.total_costo||0)
                const margen = f.total_venta > 0 ? ((util / f.total_venta) * 100).toFixed(1) : '0'
                const estColors: Record<string,string> = { en_proceso:'#0369a1', seniado:'#b45309', cerrado:'#065f46', anulado:'#991b1b' }

                // ── Opción B: importe ya viene dividido 50% cuando aplica ──
                // f.es_compartido_con_yo = este vendedor es el secundario (ve 50% de un file ajeno)
                // f.compartido_con_nombre = este vendedor es el dueño y compartió con alguien
                const esComp = f.es_compartido_con_yo || !!f.compartido_con_nombre
                const notaComp = f.es_compartido_con_yo
                  ? `<div style="font-size:10px;color:#6366f1;font-weight:600;margin-top:1px;">
                       <i class="fas fa-share-alt"></i> 50% · compartido con ${esc(f.vendedor)}
                     </div>`
                  : f.compartido_con_nombre
                  ? `<div style="font-size:10px;color:#6366f1;font-weight:600;margin-top:1px;">
                       <i class="fas fa-share-alt"></i> 50% · compartido con ${esc(f.compartido_con_nombre)}
                     </div>`
                  : ''

                return `
                  <tr>
                    <td><a href="/files/${f.id}" style="color:#7B3FA0;font-weight:700;">#${esc(f.numero)}</a></td>
                    <td style="font-size:12px;">${(f.fecha_apertura||'').split('T')[0]}</td>
                    <td style="font-size:12px;">${esc(f.cliente)}</td>
                    <td style="font-size:12px;">${esc(f.destino_principal||'—')}</td>
                    ${isGerente && !filtroVendedor ? `<td style="font-size:12px;">${esc(f.vendedor)}${f.compartido_con_nombre ? `<div style="font-size:10px;color:#6366f1;"><i class="fas fa-share-alt"></i> +${esc(f.compartido_con_nombre)}</div>` : ''}</td>` : ''}
                    <td><span style="font-size:11px;font-weight:700;color:${estColors[f.estado]||'#374151'};background:#f3f4f6;padding:2px 8px;border-radius:8px;">${esc(f.estado)}</span></td>
                    <td>
                      <strong style="color:#059669;">$${Number(f.total_venta||0).toLocaleString()}</strong>
                      ${notaComp}
                    </td>
                    <td style="color:#6b7280;">$${Number(f.total_costo||0).toLocaleString()}</td>
                    <td><strong style="color:${util < 0 ? '#dc2626' : '#F7941D'};">${util < 0 ? '-' : ''}$${Math.abs(util).toLocaleString()}</strong></td>
                    <td style="font-size:12px;font-weight:700;color:${parseFloat(margen) < 0 ? '#dc2626' : parseFloat(margen)>=20?'#059669':'#d97706'}">${margen}%</td>
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <script>
        const _labels    = ${chartLabels};
        const _ventas    = ${chartVentas};
        const _costos    = ${chartCostos};
        const _utilidad  = ${chartUtilidad};
        const _hayVendedor = ${filtroVendedor ? 'true' : 'false'};

        const barOpts = (color) => ({
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + Number(v).toLocaleString() } } }
        });

        if (_hayVendedor) {
          // Gráfico facturación (barras púrpura)
          const ctxFact = document.getElementById('chartFacturacion')
          if (ctxFact) {
            new Chart(ctxFact, {
              type: 'bar',
              data: {
                labels: _labels,
                datasets: [{ label: 'Facturación', data: _ventas, backgroundColor: 'rgba(123,63,160,0.75)', borderColor: '#7B3FA0', borderWidth: 1, borderRadius: 6 }]
              },
              options: barOpts('#7B3FA0')
            })
          }
          // Gráfico utilidad (barras verde)
          const ctxUtil = document.getElementById('chartUtilidad')
          if (ctxUtil) {
            new Chart(ctxUtil, {
              type: 'bar',
              data: {
                labels: _labels,
                datasets: [{ label: 'Utilidad', data: _utilidad, backgroundColor: _utilidad.map(v => v >= 0 ? 'rgba(5,150,105,0.75)' : 'rgba(220,38,38,0.75)'), borderColor: _utilidad.map(v => v >= 0 ? '#059669' : '#dc2626'), borderWidth: 1, borderRadius: 6 }]
              },
              options: barOpts('#059669')
            })
          }
        } else {
          // Sin filtro: mismos gráficos de barras separados (facturación y utilidad)
          const ctxFact2 = document.getElementById('chartFacturacion')
          if (ctxFact2) {
            new Chart(ctxFact2, {
              type: 'bar',
              data: {
                labels: _labels,
                datasets: [{ label: 'Facturación', data: _ventas, backgroundColor: 'rgba(123,63,160,0.75)', borderColor: '#7B3FA0', borderWidth: 1, borderRadius: 6 }]
              },
              options: barOpts('#7B3FA0')
            })
          }
          const ctxUtil2 = document.getElementById('chartUtilidad')
          if (ctxUtil2) {
            new Chart(ctxUtil2, {
              type: 'bar',
              data: {
                labels: _labels,
                datasets: [{ label: 'Utilidad', data: _utilidad, backgroundColor: _utilidad.map(v => v >= 0 ? 'rgba(5,150,105,0.75)' : 'rgba(220,38,38,0.75)'), borderColor: _utilidad.map(v => v >= 0 ? '#059669' : '#dc2626'), borderWidth: 1, borderRadius: 6 }]
              },
              options: barOpts('#059669')
            })
          }
        }

        // Top destinos (siempre)
        const ctxDest = document.getElementById('chartDestinos')
        if (ctxDest) {
          new Chart(ctxDest, {
            type: 'bar',
            data: {
              labels: ${destLabels},
              datasets: [{ label: 'Venta USD', data: ${destValues},
                backgroundColor: ['#7B3FA0','#EC008C','#F7941D','#059669','#0369a1','#6b21a8','#9333ea','#db2777','#d97706','#047857']
              }]
            },
            options: { indexAxis:'y', responsive:true, plugins:{ legend:{ display:false } }, scales:{ x:{ beginAtZero:true, ticks:{ callback: v => '$'+Number(v).toLocaleString() } } } }
          })
        }
      </script>
    `
    const titulo = vendedorNombre ? `Dashboard — ${vendedorNombre}` : 'Reportes y BI'
    return c.html(baseLayout(titulo, content, user, 'reportes'))
  } catch (e: any) {
    return c.html(baseLayout('Reportes', `<div class="alert alert-danger">${esc(e.message)}</div>`, user, 'reportes'))
  }
})

// ══════════════════════════════════════════════════════════════
// EXPORTACIONES A EXCEL (CSV con BOM para Excel)
// ══════════════════════════════════════════════════════════════

// ── Exportar ventas resumen ───────────────────────────────────
reportes.get('/reportes/exportar/ventas', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const mes        = safeMonth(c.req.query('mes'), new Date().toISOString().substring(0, 7))
  const vendedorId = c.req.query('vendedor_id') || (!canSeeAllFiles(user.rol) ? String(user.id) : '')

  try {
    const modoFecha  = c.req.query('modo') === 'rango' ? 'rango' : 'mes'
    const desde      = safeDate(c.req.query('desde'), mes + '-01')
    const hasta      = safeDate(c.req.query('hasta') || '', (() => { const [y,m2]=mes.split('-').map(Number); return mes+'-'+String(new Date(y,m2,0).getDate()).padStart(2,'0') })())
    const fechaCond  = modoFecha === 'rango'
      ? `date(f.fecha_apertura) BETWEEN '${desde}' AND '${hasta}'`
      : `strftime('%Y-%m', f.fecha_apertura) = '${mes}'`
    const periodoLabel = modoFecha === 'rango' ? `${desde}_${hasta}` : mes
    const params: any[] = vendedorId ? [vendedorId] : []
    const whereVend = vendedorId ? ' AND f.vendedor_id = ?' : ''

    const rows = await c.env.DB.prepare(`
      SELECT f.numero, f.fecha_apertura, f.estado, f.destino_principal, f.moneda,
             f.total_venta, f.total_costo,
             COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente,
             u.nombre as vendedor
      FROM files f
      LEFT JOIN clientes cl ON f.cliente_id = cl.id
      LEFT JOIN usuarios u  ON f.vendedor_id = u.id
      WHERE f.estado NOT IN ('anulado') AND ${fechaCond}${whereVend}
      ORDER BY f.fecha_apertura DESC
    `).bind(...params).all()

    const headers = ['Nº File','Fecha','Cliente','Destino','Vendedor','Estado','Moneda','Venta','Costo','Utilidad','Margen%']
    const data = (rows.results as any[]).map((f: any) => {
      const util   = Number(f.total_venta||0) - Number(f.total_costo||0)
      const margen = f.total_venta > 0 ? ((util / f.total_venta) * 100).toFixed(2) : '0'
      return [f.numero, (f.fecha_apertura||'').split('T')[0], f.cliente, f.destino_principal||'', f.vendedor, f.estado, f.moneda||'USD',
              Number(f.total_venta||0).toFixed(2), Number(f.total_costo||0).toFixed(2), util.toFixed(2), margen]
    })
    return csvResponse(`ventas_${periodoLabel}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── Exportar detalle de files ─────────────────────────────────
reportes.get('/reportes/exportar/files', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const mes        = safeMonth(c.req.query('mes'), new Date().toISOString().substring(0, 7))
  const vendedorId = c.req.query('vendedor_id') || (!canSeeAllFiles(user.rol) ? String(user.id) : '')

  try {
    const modoFecha  = c.req.query('modo') === 'rango' ? 'rango' : 'mes'
    const desde      = safeDate(c.req.query('desde'), mes + '-01')
    const hasta      = safeDate(c.req.query('hasta') || '', (() => { const [y,m2]=mes.split('-').map(Number); return mes+'-'+String(new Date(y,m2,0).getDate()).padStart(2,'0') })())
    const fechaCond  = modoFecha === 'rango'
      ? `date(f.fecha_apertura) BETWEEN '${desde}' AND '${hasta}'`
      : `strftime('%Y-%m', f.fecha_apertura) = '${mes}'`
    const periodoLabel = modoFecha === 'rango' ? `${desde}_${hasta}` : mes
    const estadoFilter = c.req.query('estado') || ''
    const params: any[] = vendedorId ? [vendedorId] : []
    const rows = await c.env.DB.prepare(`
      SELECT f.numero, f.fecha_apertura, f.estado, f.destino_principal, f.moneda, f.notas,
             f.total_venta, f.total_costo,
             COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente,
             cl.email as cliente_email, cl.telefono as cliente_tel,
             u.nombre as vendedor
      FROM files f
      LEFT JOIN clientes cl ON f.cliente_id = cl.id
      LEFT JOIN usuarios u  ON f.vendedor_id = u.id
      WHERE ${estadoFilter ? `f.estado = '${estadoFilter}'` : "f.estado NOT IN ('anulado')"} AND ${fechaCond}
      ${vendedorId ? 'AND f.vendedor_id = ?' : ''}
      ORDER BY f.numero DESC
    `).bind(...params).all()

    const headers = ['Nº File','Fecha','Cliente','Email Cliente','Tel. Cliente','Destino','Vendedor','Estado','Moneda','Venta','Costo','Utilidad','Notas']
    const data = (rows.results as any[]).map((f: any) => [
      f.numero, (f.fecha_apertura||'').split('T')[0], f.cliente, f.cliente_email||'', f.cliente_tel||'',
      f.destino_principal||'', f.vendedor, f.estado, f.moneda||'USD',
      Number(f.total_venta||0).toFixed(2), Number(f.total_costo||0).toFixed(2),
      (Number(f.total_venta||0)-Number(f.total_costo||0)).toFixed(2), f.notas||''
    ])
    return csvResponse(`files_${periodoLabel}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── Exportar ranking vendedores ───────────────────────────────
reportes.get('/reportes/exportar/vendedores', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/login')
  const mes = safeMonth(c.req.query('mes'), new Date().toISOString().substring(0, 7))

  try {
    const rows = await c.env.DB.prepare(`
      SELECT u.nombre, COUNT(f.id) as total_files,
             COALESCE(SUM(f.total_venta),0) as total_venta,
             COALESCE(SUM(f.total_costo),0) as total_costo
      FROM usuarios u
      LEFT JOIN files f ON f.vendedor_id = u.id
        AND f.estado NOT IN ('anulado')
        AND strftime('%Y-%m', f.fecha_apertura) = ?
      WHERE u.rol IN ('vendedor','supervisor','administracion','gerente') AND u.email != 'gerente@drviaje.com'
      GROUP BY u.id, u.nombre ORDER BY total_venta DESC
    `).bind(mes).all()

    const headers = ['Vendedor','Files','Venta Total','Costo Total','Utilidad Bruta','Margen%']
    const data = (rows.results as any[]).map((v: any) => {
      const util = Number(v.total_venta) - Number(v.total_costo)
      const mg   = v.total_venta > 0 ? ((util/v.total_venta)*100).toFixed(2) : '0'
      return [v.nombre, v.total_files, Number(v.total_venta).toFixed(2), Number(v.total_costo).toFixed(2), util.toFixed(2), mg]
    })
    return csvResponse(`vendedores_${mes}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── Exportar destinos ─────────────────────────────────────────
reportes.get('/reportes/exportar/destinos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const mes        = safeMonth(c.req.query('mes'), new Date().toISOString().substring(0, 7))
  const vendedorId = c.req.query('vendedor_id') || (!canSeeAllFiles(user.rol) ? String(user.id) : '')

  try {
    const params: any[] = [mes]
    if (vendedorId) params.push(vendedorId)
    const rows = await c.env.DB.prepare(`
      SELECT s.destino_codigo, COUNT(*) as cantidad,
             SUM(s.precio_venta) as total_venta, SUM(s.costo_original) as total_costo
      FROM servicios s JOIN files f ON s.file_id = f.id
      WHERE s.destino_codigo IS NOT NULL AND s.destino_codigo != ''
        AND f.estado NOT IN ('anulado')
        AND strftime('%Y-%m', f.fecha_apertura) = ?
        ${vendedorId ? 'AND f.vendedor_id = ?' : ''}
      GROUP BY s.destino_codigo ORDER BY total_venta DESC
    `).bind(...params).all()

    const headers = ['Destino IATA','Servicios','Venta Total','Costo Total','Utilidad','Margen%']
    const data = (rows.results as any[]).map((d: any) => {
      const util = Number(d.total_venta||0) - Number(d.total_costo||0)
      const mg   = d.total_venta > 0 ? ((util/d.total_venta)*100).toFixed(2) : '0'
      return [d.destino_codigo, d.cantidad, Number(d.total_venta||0).toFixed(2), Number(d.total_costo||0).toFixed(2), util.toFixed(2), mg]
    })
    return csvResponse(`destinos_${mes}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── Exportar cuenta corriente proveedor ──────────────────────
reportes.get('/reportes/exportar/proveedor/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const provId = c.req.param('id')

  try {
    const proveedor = await c.env.DB.prepare('SELECT nombre FROM proveedores WHERE id = ?').bind(provId).first() as any
    if (!proveedor) return c.text('Proveedor no encontrado', 404)

    const rows = await c.env.DB.prepare(`
      SELECT pcc.created_at, pcc.tipo, pcc.metodo, pcc.concepto,
             pcc.monto, pcc.moneda, pcc.estado, pcc.referencia,
             pcc.servicios_ids, u.nombre as usuario
      FROM proveedor_cuenta_corriente pcc
      LEFT JOIN usuarios u ON u.id = pcc.usuario_id
      WHERE pcc.proveedor_id = ?
      ORDER BY pcc.created_at ASC
    `).bind(provId).all()

    // Resolver facturas de proveedor para cada movimiento
    const allRows = rows.results as any[]
    const facturasMap: Record<number, string> = {}
    for (const mov of allRows) {
      if (!mov.servicios_ids) continue
      const ids = String(mov.servicios_ids).split(',').map((s: string) => Number(s.trim())).filter((n: number) => n > 0)
      if (!ids.length) continue
      const ph = ids.map(() => '?').join(',')
      const svcs = await c.env.DB.prepare(
        `SELECT id, nro_factura_proveedor FROM servicios WHERE id IN (${ph}) AND nro_factura_proveedor IS NOT NULL`
      ).bind(...ids).all()
      const facturas = (svcs.results as any[]).map((s: any) => s.nro_factura_proveedor).filter(Boolean)
      if (facturas.length) facturasMap[allRows.indexOf(mov)] = [...new Set(facturas)].join(' / ')
    }

    const headers = ['Fecha','Tipo','Método','Concepto','Monto','Moneda','Estado','Referencia','Nº Factura Proveedor','Usuario']
    const data = allRows.map((m: any, i: number) => [
      (m.created_at||'').substring(0,16), m.tipo, m.metodo, m.concepto||'',
      Number(m.monto).toFixed(2), m.moneda, m.estado, m.referencia||'',
      facturasMap[i] || '',
      m.usuario||''
    ])
    const nombre = (proveedor.nombre || 'proveedor').replace(/[^a-z0-9]/gi, '_')
    return csvResponse(`cta_cte_${nombre}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── Exportar estado de cuenta de cliente ─────────────────────
reportes.get('/reportes/exportar/cliente/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const id   = c.req.param('id')
  const tipo = c.req.query('tipo') || 'movimientos' // 'movimientos' | 'files'

  try {
    const cl = await c.env.DB.prepare('SELECT * FROM clientes WHERE id = ?').bind(id).first() as any
    if (!cl) return c.text('Cliente no encontrado', 404)

    const nc = [cl.nombre, cl.apellido].filter(Boolean).join(' ') || cl.nombre_completo || 'Cliente'
    const safeName = nc.replace(/[^a-z0-9áéíóúüñ\s]/gi, '_').replace(/\s+/g, '_').substring(0, 40)

    if (tipo === 'files') {
      const rows = await c.env.DB.prepare(`
        SELECT f.numero, f.fecha_apertura, f.estado, f.destino_principal, f.moneda,
               f.total_venta, f.total_costo,
               u.nombre as vendedor
        FROM files f
        LEFT JOIN usuarios u ON f.vendedor_id = u.id
        WHERE f.cliente_id = ? AND f.estado != 'anulado'
        ORDER BY f.fecha_apertura DESC
      `).bind(id).all()

      const headers = ['Nº File', 'Fecha', 'Destino', 'Vendedor', 'Estado', 'Moneda', 'Venta', 'Costo', 'Utilidad', 'Margen%']
      const data = (rows.results as any[]).map((f: any) => {
        const util   = Number(f.total_venta || 0) - Number(f.total_costo || 0)
        const margen = f.total_venta > 0 ? ((util / f.total_venta) * 100).toFixed(2) : '0'
        return [f.numero, (f.fecha_apertura || '').split('T')[0], f.destino_principal || '', f.vendedor || '',
                f.estado, f.moneda || 'USD', Number(f.total_venta || 0).toFixed(2),
                Number(f.total_costo || 0).toFixed(2), util.toFixed(2), margen]
      })
      return csvResponse(`files_${safeName}.csv`, headers, data)
    }

    // Movimientos (default)
    const rows = await c.env.DB.prepare(`
      SELECT m.fecha, m.tipo, m.concepto, m.metodo, m.moneda, m.monto, m.referencia,
             f.numero as file_numero, b.nombre_entidad as banco, u.nombre as operador
      FROM movimientos_caja m
      LEFT JOIN files f ON m.file_id = f.id
      LEFT JOIN bancos b ON m.banco_id = b.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      WHERE m.cliente_id = ? AND (m.anulado IS NULL OR m.anulado = 0)
      ORDER BY m.fecha DESC
    `).bind(id).all()

    const headers = ['Fecha', 'Tipo', 'Concepto', 'File', 'Método', 'Banco', 'Moneda', 'Monto', 'Referencia', 'Operador']
    const data = (rows.results as any[]).map((m: any) => [
      (m.fecha || '').substring(0, 16), m.tipo, m.concepto || '', m.file_numero || '',
      m.metodo, m.banco || '', m.moneda, Number(m.monto || 0).toFixed(2), m.referencia || '', m.operador || ''
    ])
    return csvResponse(`estado_cuenta_${safeName}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── Exportar conciliación proveedores ────────────────────────
reportes.get('/reportes/exportar/conciliacion-proveedores', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/login')

  try {
    const rows = await c.env.DB.prepare(`
      SELECT p.nombre as proveedor,
             COUNT(DISTINCT s.id) as total_servicios,
             COALESCE(SUM(s.costo_original),0) as total_costo,
             COALESCE(SUM(CASE WHEN s.prepago_realizado=1 THEN s.costo_original ELSE 0 END),0) as total_pagado,
             COALESCE(SUM(CASE WHEN s.prepago_realizado=0 THEN s.costo_original ELSE 0 END),0) as total_pendiente,
             s.moneda_origen as moneda
      FROM servicios s
      JOIN proveedores p ON s.proveedor_id = p.id
      JOIN files f ON s.file_id = f.id
      WHERE f.estado != 'anulado' AND s.estado != 'cancelado'
      GROUP BY p.id, p.nombre, s.moneda_origen
      ORDER BY total_pendiente DESC
    `).all()

    const headers = ['Proveedor','Servicios','Total Costo','Total Pagado','Total Pendiente','Moneda']
    const data = (rows.results as any[]).map((r: any) => [
      r.proveedor, r.total_servicios,
      Number(r.total_costo).toFixed(2), Number(r.total_pagado).toFixed(2), Number(r.total_pendiente).toFixed(2),
      r.moneda
    ])
    return csvResponse(`conciliacion_proveedores.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// GET /reportes/cuentas-corrientes — Cuentas corrientes de clientes
// ══════════════════════════════════════════════════════════════
reportes.get('/reportes/cuentas-corrientes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  const buscar     = c.req.query('buscar') || ''
  const soloDeuda  = c.req.query('solo_deuda') === '1'
  const soloEmpres = c.req.query('solo_empresas') === '1'

  try {
    // Buscar clientes con actividad
    let qClientes = `
      SELECT cl.id, cl.nombre, cl.apellido, cl.nombre_completo, cl.email, cl.telefono, cl.tipo_documento,
             COUNT(DISTINCT f.id) as total_files,
             COALESCE(SUM(CASE WHEN f.estado != 'anulado' THEN f.total_venta ELSE 0 END), 0) as total_facturado,
             COALESCE(SUM(CASE WHEN m.tipo='ingreso' AND (m.anulado IS NULL OR m.anulado=0) THEN m.monto ELSE 0 END), 0) as total_cobrado,
             MAX(f.fecha_apertura) as ultimo_file,
             f.moneda as moneda_principal
      FROM clientes cl
      LEFT JOIN files f ON f.cliente_id = cl.id
      LEFT JOIN movimientos_caja m ON m.cliente_id = cl.id
      WHERE 1=1
    `
    const params: any[] = []
    if (buscar) {
      qClientes += ` AND (cl.nombre LIKE ? OR cl.apellido LIKE ? OR cl.email LIKE ? OR cl.nro_documento LIKE ? OR (cl.nombre || ' ' || cl.apellido) LIKE ?)`
      const like = `%${buscar}%`
      params.push(like, like, like, like, like)
    }
    if (soloEmpres) {
      qClientes += ` AND cl.tipo_documento = 'RUT'`
    }
    qClientes += ` GROUP BY cl.id HAVING total_files > 0`
    if (soloDeuda) qClientes += ` AND (total_facturado - total_cobrado) > 0.5`
    qClientes += ` ORDER BY total_facturado DESC LIMIT 200`

    const clientes = await c.env.DB.prepare(qClientes).bind(...params).all()

    // Totales globales
    const globalTotales = await c.env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN f.estado != 'anulado' THEN f.total_venta ELSE 0 END), 0) as total_facturado,
        COALESCE(SUM(CASE WHEN m.tipo='ingreso' AND (m.anulado IS NULL OR m.anulado=0) THEN m.monto ELSE 0 END), 0) as total_cobrado,
        COUNT(DISTINCT cl.id) as total_clientes
      FROM clientes cl
      LEFT JOIN files f ON f.cliente_id = cl.id
      LEFT JOIN movimientos_caja m ON m.cliente_id = cl.id
    `).first() as any

    const totalFacturado = Number(globalTotales?.total_facturado || 0)
    const totalCobrado   = Number(globalTotales?.total_cobrado || 0)
    const totalPendiente = Math.max(0, totalFacturado - totalCobrado)

    const filas = (clientes.results as any[]).map((cl: any) => {
      const nc       = [cl.nombre, cl.apellido].filter(Boolean).join(' ') || cl.nombre_completo || '—'
      const facturado = Number(cl.total_facturado || 0)
      const cobrado   = Number(cl.total_cobrado || 0)
      const deuda     = Math.max(0, facturado - cobrado)
      const saldoFavor = Math.max(0, cobrado - facturado)
      const pct       = facturado > 0 ? Math.min(100, (cobrado / facturado) * 100).toFixed(0) : '100'
      const deudaColor = deuda > 0 ? '#dc2626' : '#059669'
      const esEmpresa = cl.tipo_documento === 'RUT'

      return `
        <tr>
          <td>
            <a href="/clientes/${cl.id}/cuenta-corriente" style="color:#7B3FA0;font-weight:700;text-decoration:none;">
              ${esEmpresa ? '<i class="fas fa-building" style="font-size:11px;margin-right:4px;color:#F7941D;"></i>' : ''}
              ${esc(nc)}
            </a>
            <br><span style="font-size:11px;color:#9ca3af;">${esc(cl.email || '')}</span>
          </td>
          <td style="text-align:center;font-size:12px;">${cl.total_files}</td>
          <td style="font-size:12px;">${(cl.ultimo_file || '').split('T')[0] || '—'}</td>
          <td style="text-align:right;font-weight:700;color:#5a2d75;">$${facturado.toLocaleString()}</td>
          <td style="text-align:right;color:#059669;font-weight:700;">$${cobrado.toLocaleString()}</td>
          <td style="text-align:right;font-weight:700;color:${deudaColor};">
            ${deuda > 0 ? `$${deuda.toLocaleString()}` : (saldoFavor > 0 ? `<span style="color:#059669;">a favor $${saldoFavor.toLocaleString()}</span>` : '✓ Al día')}
          </td>
          <td>
            <div style="background:#f3f4f6;border-radius:4px;height:6px;overflow:hidden;min-width:60px;">
              <div style="width:${pct}%;height:100%;background:${deuda > 0 ? 'linear-gradient(90deg,#7B3FA0,#EC008C)' : '#059669'};border-radius:4px;"></div>
            </div>
            <span style="font-size:10px;color:#9ca3af;">${pct}%</span>
          </td>
          <td>
            <a href="/clientes/${cl.id}/cuenta-corriente" class="btn btn-outline btn-sm" style="font-size:11px;">
              <i class="fas fa-file-invoice-dollar"></i> Ver
            </a>
            <a href="/reportes/exportar/cliente/${cl.id}" class="btn btn-sm" style="background:#217346;color:white;font-size:11px;">
              <i class="fas fa-file-excel"></i>
            </a>
          </td>
        </tr>
      `
    }).join('')

    const content = `
      <!-- Filtros -->
      <form method="GET" style="display:flex;gap:10px;margin-bottom:24px;align-items:flex-end;flex-wrap:wrap;background:white;padding:16px;border-radius:12px;border:1.5px solid #e5e7eb;">
        <div>
          <label class="form-label">BUSCAR CLIENTE</label>
          <input type="text" name="buscar" value="${esc(buscar)}" placeholder="Nombre, email, documento..." class="form-control" style="width:280px;">
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" name="solo_deuda" value="1" ${soloDeuda ? 'checked' : ''}> Solo con deuda pendiente
          </label>
          <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" name="solo_empresas" value="1" ${soloEmpres ? 'checked' : ''}> <i class="fas fa-building" style="color:#F7941D;"></i> Solo empresas (RUT)
          </label>
        </div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-search"></i> Buscar</button>
        <a href="/reportes/cuentas-corrientes" class="btn btn-outline"><i class="fas fa-times"></i> Limpiar</a>
        <div style="margin-left:auto;">
          <a href="/reportes/exportar/cuentas-corrientes${soloDeuda ? '?solo_deuda=1' : ''}" class="btn btn-sm" style="background:#217346;color:white;border:none;">
            <i class="fas fa-file-excel"></i> Exportar Todo
          </a>
        </div>
      </form>

      <!-- KPIs globales -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">CLIENTES ACTIVOS</div>
          <div style="font-size:28px;font-weight:800;color:#5a2d75;">${Number(globalTotales?.total_clientes || 0)}</div>
        </div>
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">TOTAL FACTURADO</div>
          <div style="font-size:22px;font-weight:800;color:#5a2d75;">$${totalFacturado.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">TOTAL COBRADO</div>
          <div style="font-size:22px;font-weight:800;color:#059669;">$${totalCobrado.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">DEUDA PENDIENTE</div>
          <div style="font-size:22px;font-weight:800;color:${totalPendiente > 0 ? '#dc2626' : '#059669'};">$${totalPendiente.toLocaleString()}</div>
        </div>
      </div>

      <!-- Tabla -->
      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-file-invoice-dollar" style="color:#7B3FA0"></i> Cuentas Corrientes (${clientes.results.length})</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Cliente / Empresa</th><th style="text-align:center;">Files</th><th>Último File</th>
                <th style="text-align:right;">Facturado</th><th style="text-align:right;">Cobrado</th>
                <th style="text-align:right;">Saldo</th><th>% Cobrado</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${filas || `<tr><td colspan="8" style="text-align:center;padding:32px;color:#9ca3af;">No se encontraron clientes con actividad.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `
    return c.html(baseLayout('Cuentas Corrientes', content, user, 'reportes'))
  } catch (e: any) {
    return c.html(baseLayout('Cuentas Corrientes', `<div class="alert alert-danger">${esc(e.message)}</div>`, user, 'reportes'))
  }
})

// ── Exportar todas las cuentas corrientes ─────────────────────
reportes.get('/reportes/exportar/cuentas-corrientes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const soloDeuda = c.req.query('solo_deuda') === '1'

  try {
    let q = `
      SELECT cl.id, cl.nombre, cl.apellido, cl.nombre_completo, cl.email, cl.telefono, cl.tipo_documento,
             cl.nro_documento,
             COUNT(DISTINCT f.id) as total_files,
             COALESCE(SUM(CASE WHEN f.estado != 'anulado' THEN f.total_venta ELSE 0 END), 0) as total_facturado,
             COALESCE(SUM(CASE WHEN m.tipo='ingreso' AND (m.anulado IS NULL OR m.anulado=0) THEN m.monto ELSE 0 END), 0) as total_cobrado,
             MAX(f.fecha_apertura) as ultimo_file
      FROM clientes cl
      LEFT JOIN files f ON f.cliente_id = cl.id
      LEFT JOIN movimientos_caja m ON m.cliente_id = cl.id
      GROUP BY cl.id HAVING total_files > 0
    `
    if (soloDeuda) q += ` AND (total_facturado - total_cobrado) > 0.5`
    q += ` ORDER BY total_facturado DESC`

    const rows = await c.env.DB.prepare(q).all()

    const headers = ['ID', 'Nombre', 'Apellido', 'Email', 'Teléfono', 'Tipo Doc', 'Nro Doc', 'Files', 'Último File', 'Facturado', 'Cobrado', 'Deuda Pendiente']
    const data = (rows.results as any[]).map((cl: any) => {
      const facturado = Number(cl.total_facturado || 0)
      const cobrado   = Number(cl.total_cobrado || 0)
      return [cl.id, cl.nombre || cl.nombre_completo, cl.apellido || '', cl.email || '', cl.telefono || '',
              cl.tipo_documento || '', cl.nro_documento || '', cl.total_files,
              (cl.ultimo_file || '').split('T')[0],
              facturado.toFixed(2), cobrado.toFixed(2), Math.max(0, facturado - cobrado).toFixed(2)]
    })
    return csvResponse(`cuentas_corrientes_clientes.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

export default reportes

// ── GET /reportes/exportar/servicios-pagados ─────────────────
reportes.get('/reportes/exportar/servicios-pagados', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const desde       = safeDate(c.req.query('desde'), '')
  const hasta       = safeDate(c.req.query('hasta'), '')
  const proveedorId = c.req.query('proveedor_id') || ''

  try {
    let q = `
      SELECT s.id, s.tipo_servicio, s.descripcion, s.nro_ticket,
             s.nro_factura_proveedor, s.fecha_factura_proveedor,
             p.nombre as proveedor, o.nombre as operador,
             s.costo_original, s.moneda_origen, s.precio_venta,
             s.fecha_inicio, s.estado_pago_proveedor,
             f.numero as file_numero,
             COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente,
             u.nombre as vendedor,
             s.created_at
      FROM servicios s
      JOIN files f ON f.id = s.file_id
      LEFT JOIN proveedores p ON p.id = s.proveedor_id
      LEFT JOIN operadores o ON o.id = s.operador_id
      LEFT JOIN clientes cl ON cl.id = f.cliente_id
      LEFT JOIN usuarios u ON u.id = f.vendedor_id
      WHERE (s.prepago_realizado = 1 OR s.estado_pago_proveedor = 'pagado')
        AND f.estado != 'anulado'
    `
    const tipoFilter = c.req.query('tipo') || ''
    const params: string[] = []
    if (proveedorId) { q += ` AND s.proveedor_id = ?`; params.push(proveedorId) }
    if (tipoFilter)  { q += ` AND s.tipo_servicio = ?`; params.push(tipoFilter) }
    if (desde) { q += ` AND date(s.created_at) >= ?`; params.push(desde) }
    if (hasta) { q += ` AND date(s.created_at) <= ?`; params.push(hasta) }
    q += ` ORDER BY s.created_at DESC`

    const rows = await c.env.DB.prepare(q).bind(...params).all()
    const headers = ['ID', 'File', 'Cliente', 'Vendedor', 'Tipo', 'Descripción', 'Ticket/Reserva', 'Nº Factura Proveedor', 'Fecha Factura', 'Proveedor', 'Operador', 'Costo', 'Moneda', 'Venta', 'Fecha Servicio', 'Estado Pago', 'Fecha Registro']
    const data = (rows.results as any[]).map((s: any) => [
      s.id, s.file_numero, s.cliente, s.vendedor,
      s.tipo_servicio, s.descripcion, s.nro_ticket || '',
      s.nro_factura_proveedor || '', s.fecha_factura_proveedor || '',
      s.proveedor || '', s.operador || '',
      Number(s.costo_original).toFixed(2), s.moneda_origen,
      Number(s.precio_venta).toFixed(2),
      (s.fecha_inicio || ''), s.estado_pago_proveedor,
      (s.created_at || '').split('T')[0]
    ])
    const label = desde && hasta ? `${desde}_${hasta}` : new Date().toISOString().split('T')[0]
    return csvResponse(`servicios_pagados_${label}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})

// ── GET /reportes/exportar/servicios-pendientes ──────────────
reportes.get('/reportes/exportar/servicios-pendientes', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  const desde = safeDate(c.req.query('desde'), '')
  const hasta = safeDate(c.req.query('hasta'), '')

  try {
    let q = `
      SELECT s.id, s.tipo_servicio, s.descripcion, s.nro_ticket,
             p.nombre as proveedor, o.nombre as operador,
             s.costo_original, s.moneda_origen, s.precio_venta,
             s.fecha_inicio, s.fecha_limite_prepago, s.estado_pago_proveedor,
             f.numero as file_numero,
             COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo, '—') as cliente,
             u.nombre as vendedor,
             s.created_at
      FROM servicios s
      JOIN files f ON f.id = s.file_id
      LEFT JOIN proveedores p ON p.id = s.proveedor_id
      LEFT JOIN operadores o ON o.id = s.operador_id
      LEFT JOIN clientes cl ON cl.id = f.cliente_id
      LEFT JOIN usuarios u ON u.id = f.vendedor_id
      WHERE s.prepago_realizado = 0
        AND s.estado_pago_proveedor NOT IN ('pagado')
        AND f.estado != 'anulado'
        AND s.estado != 'cancelado'
    `
    const params: string[] = []
    if (proveedorId) { q += ` AND s.proveedor_id = ?`; params.push(proveedorId) }
    const tipoFilterP = c.req.query('tipo') || ''
    if (tipoFilterP) { q += ` AND s.tipo_servicio = ?`; params.push(tipoFilterP) }
    if (desde) { q += ` AND date(s.created_at) >= ?`; params.push(desde) }
    if (hasta) { q += ` AND date(s.created_at) <= ?`; params.push(hasta) }
    q += ` ORDER BY s.fecha_limite_prepago ASC NULLS LAST, f.numero ASC`

    const rows = await c.env.DB.prepare(q).bind(...params).all()
    const headers = ['ID', 'File', 'Cliente', 'Vendedor', 'Tipo', 'Descripción', 'Ticket/Reserva', 'Proveedor', 'Operador', 'Costo', 'Moneda', 'Venta', 'Fecha Servicio', 'Fecha Límite Pago', 'Estado Pago']
    const data = (rows.results as any[]).map((s: any) => [
      s.id, s.file_numero, s.cliente, s.vendedor,
      s.tipo_servicio, s.descripcion, s.nro_ticket || '',
      s.proveedor || '', s.operador || '',
      Number(s.costo_original).toFixed(2), s.moneda_origen,
      Number(s.precio_venta).toFixed(2),
      (s.fecha_inicio || ''), (s.fecha_limite_prepago || '—'),
      s.estado_pago_proveedor || 'pendiente'
    ])
    const label = desde && hasta ? `${desde}_${hasta}` : new Date().toISOString().split('T')[0]
    return csvResponse(`servicios_pendientes_${label}.csv`, headers, data)
  } catch (e: any) {
    return c.text('Error: ' + e.message, 500)
  }
})
