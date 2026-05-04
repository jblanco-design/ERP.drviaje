import { Hono } from 'hono'
import { getUser, canAccessTesoreria, isAdminOrAbove } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'
import { invalidateCache } from '../lib/cache'

type Bindings = { DB: D1Database }
const bancos = new Hono<{ Bindings: Bindings }>()

// ── Middleware: bancos solo para gerente y administración ────
bancos.use('/bancos/*', async (c, next) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!canAccessTesoreria(user.rol)) {
    return c.html(`
      <div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;">
        <div style="background:white;border-radius:12px;padding:40px;max-width:400px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          <div style="font-size:48px;margin-bottom:16px;">🔒</div>
          <h2 style="color:#dc2626;margin-bottom:12px;">Acceso restringido</h2>
          <p style="color:#6b7280;margin-bottom:24px;">El módulo de Bancos está disponible solo para Gerencia y Administración.</p>
          <a href="/dashboard" style="background:#7B3FA0;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">← Volver al Dashboard</a>
        </div>
      </div>
    `, 403)
  }
  return next()
})

// ── GET /bancos ───────────────────────────────────────────────
bancos.get('/bancos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  try {
    const error    = c.req.query('error')    || ''
    const success  = c.req.query('success')  || ''
    const autoOpen = c.req.query('banco_id') || ''
    const okMsg    = c.req.query('ok')       || ''

    // Traer todas las cuentas (activas e inactivas) con saldo calculado
    const bancosList = await c.env.DB.prepare(
      'SELECT * FROM bancos ORDER BY activo DESC, nombre_entidad ASC'
    ).all()

    const bancosConSaldo = await Promise.all(bancosList.results.map(async (b: any) => {
      const ing = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(monto),0) as total FROM movimientos_caja WHERE banco_id=? AND tipo='ingreso' AND anulado=0`
      ).bind(b.id).first() as any
      const egr = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(monto),0) as total FROM movimientos_caja WHERE banco_id=? AND tipo='egreso' AND anulado=0`
      ).bind(b.id).first() as any
      const movCount = await c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM movimientos_caja WHERE banco_id=? AND anulado=0`
      ).bind(b.id).first() as any
      return {
        ...b,
        saldo_actual: Number(b.saldo_inicial) + Number(ing?.total || 0) - Number(egr?.total || 0),
        tiene_movimientos: (movCount?.n || 0) > 0,
        total_movimientos: movCount?.n || 0
      }
    }))

    const activas   = bancosConSaldo.filter((b: any) => b.activo === 1)
    const inactivas = bancosConSaldo.filter((b: any) => b.activo !== 1)

    const errorMsg   = error   === 'nombre_requerido' ? 'El nombre de la entidad es obligatorio.'
                     : error   === 'no_encontrado'    ? 'Cuenta bancaria no encontrada.'
                     : error   === 'sin_permiso'      ? 'No tenés permiso para realizar esta acción.'
                     : ''
    const successMsg = success === 'creada'      ? 'Cuenta bancaria creada correctamente.'
                     : success === 'actualizada' ? 'Cuenta bancaria actualizada correctamente.'
                     : success === 'cerrada'     ? 'Cuenta cerrada. Los movimientos existentes no fueron afectados.'
                     : success === 'reactivada'  ? 'Cuenta reactivada correctamente.'
                     : ''

    // Renderizar card de banco
    const renderCard = (b: any) => {
      const estaActiva  = b.activo === 1
      const gradiente   = !estaActiva
        ? 'linear-gradient(135deg,#6b7280,#4b5563)'
        : b.moneda === 'USD'
          ? 'linear-gradient(135deg,#059669,#047857)'
          : 'linear-gradient(135deg,#2563eb,#1d4ed8)'
      const signo = b.moneda === 'USD' ? '$' : '$U'

      return `
        <div class="card" style="opacity:${estaActiva ? '1' : '0.75'};">
          <div style="padding:20px;background:${gradiente};border-radius:12px 12px 0 0;position:relative;">
            ${!estaActiva ? `<div style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.35);color:white;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;letter-spacing:1px;">CERRADA</div>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <div style="color:rgba(255,255,255,0.7);font-size:11px;letter-spacing:1px;margin-bottom:4px;">
                  ${b.moneda === 'USD' ? 'DÓLARES' : 'PESOS URUGUAYOS'}
                </div>
                <div style="color:white;font-size:18px;font-weight:800;">${esc(b.nombre_entidad)}</div>
                ${b.nro_cuenta ? `<div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:2px;"><i class="fas fa-hashtag" style="font-size:10px;"></i> ${esc(b.nro_cuenta)}</div>` : ''}
                ${b.descripcion ? `<div style="color:rgba(255,255,255,0.55);font-size:11px;margin-top:2px;font-style:italic;">${esc(b.descripcion)}</div>` : ''}
              </div>
              <div style="text-align:right;">
                <div style="color:rgba(255,255,255,0.7);font-size:11px;">SALDO ACTUAL</div>
                <div style="color:white;font-size:22px;font-weight:800;">
                  ${signo} ${Number(b.saldo_actual).toLocaleString('es-UY', {minimumFractionDigits:2, maximumFractionDigits:2})}
                </div>
                <div style="color:rgba(255,255,255,0.55);font-size:10px;">${b.total_movimientos} movimiento(s)</div>
              </div>
            </div>
          </div>

          <div class="card-body">
            <div style="display:flex;gap:16px;font-size:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #f3f4f6;">
              <div>
                <div style="color:#9ca3af;margin-bottom:1px;">Saldo inicial</div>
                <div style="font-weight:600;">${signo} ${Number(b.saldo_inicial).toLocaleString('es-UY', {minimumFractionDigits:2})}</div>
              </div>
              <div>
                <div style="color:#9ca3af;margin-bottom:1px;">Estado</div>
                <div style="font-weight:700;color:${estaActiva ? '#059669' : '#6b7280'};">
                  <i class="fas fa-${estaActiva ? 'check-circle' : 'lock'}" style="font-size:11px;"></i>
                  ${estaActiva ? 'Activa' : 'Cerrada'}
                </div>
              </div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button onclick="verConciliacion(${b.id}, '${esc(b.nombre_entidad)}')"
                class="btn btn-outline btn-sm" style="flex:1;min-width:120px;">
                <i class="fas fa-balance-scale"></i> Conciliación
              </button>
              ${isAdminOrAbove(user.rol) ? `
                <button onclick="abrirEditarBanco(${b.id},'${esc(b.nombre_entidad)}','${esc(b.nro_cuenta||'')}','${b.moneda}',${b.saldo_inicial},'${esc(b.descripcion||'')}')"
                  class="btn btn-outline btn-sm" title="Editar cuenta">
                  <i class="fas fa-edit"></i>
                </button>
                <button onclick="confirmarToggleBanco(${b.id}, ${estaActiva ? 1 : 0}, '${esc(b.nombre_entidad)}', ${b.tiene_movimientos ? 1 : 0})"
                  class="btn btn-sm" title="${estaActiva ? 'Cerrar cuenta' : 'Reactivar cuenta'}"
                  style="background:${estaActiva ? '#fee2e2' : '#d1fae5'};color:${estaActiva ? '#dc2626' : '#059669'};border:1px solid ${estaActiva ? '#fecaca' : '#6ee7b7'};">
                  <i class="fas fa-${estaActiva ? 'lock' : 'lock-open'}"></i>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `
    }

    const content = `
      ${errorMsg   ? `<div class="alert alert-danger"  style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> ${errorMsg}</div>`   : ''}
      ${successMsg ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> ${successMsg}</div>` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div>
          <span style="font-size:13px;color:#6b7280;">
            ${activas.length} cuenta(s) activa(s)
            ${inactivas.length > 0 ? `· <span style="color:#9ca3af;">${inactivas.length} cerrada(s)</span>` : ''}
          </span>
        </div>
        <div style="display:flex;gap:10px;">
          ${isAdminOrAbove(user.rol) ? `
            <a href="/tesoreria/transferencias" class="btn btn-outline">
              <i class="fas fa-exchange-alt"></i> Transferencias
            </a>
            <button onclick="document.getElementById('modal-banco-nueva').classList.add('active')" class="btn btn-orange">
              <i class="fas fa-plus"></i> Nueva Cuenta Bancaria
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Cuentas activas -->
      ${activas.length > 0 ? `
        <div class="grid-2" style="margin-bottom:24px;">
          ${activas.map(renderCard).join('')}
        </div>
      ` : `
        <div class="card" style="margin-bottom:24px;">
          <div class="card-body" style="text-align:center;color:#9ca3af;padding:30px;">
            <i class="fas fa-university" style="font-size:32px;margin-bottom:12px;display:block;"></i>
            Sin cuentas bancarias activas.
            ${isAdminOrAbove(user.rol) ? `<br><a href="#" onclick="document.getElementById('modal-banco-nueva').classList.add('active')">Crear primera cuenta</a>` : ''}
          </div>
        </div>
      `}

      <!-- Cuentas cerradas (colapsable) -->
      ${inactivas.length > 0 ? `
        <div style="margin-bottom:24px;">
          <button onclick="toggleCerradas()" id="btn-toggle-cerradas"
            style="background:none;border:1px dashed #d1d5db;border-radius:8px;padding:8px 16px;font-size:13px;color:#6b7280;cursor:pointer;width:100%;text-align:left;">
            <i class="fas fa-chevron-right" id="icon-cerradas"></i>
            &nbsp; Cuentas cerradas (${inactivas.length})
          </button>
          <div id="panel-cerradas" style="display:none;margin-top:12px;">
            <div class="grid-2">
              ${inactivas.map(renderCard).join('')}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Panel conciliación -->
      <div class="card" id="conciliacion-section" style="display:none;">
        <div class="card-header">
          <span class="card-title" id="conciliacion-title">
            <i class="fas fa-balance-scale" style="color:#F7941D"></i> Conciliación Bancaria
          </span>
          <button onclick="document.getElementById('conciliacion-section').style.display='none'" class="btn btn-outline btn-sm">Cerrar</button>
        </div>
        <div class="card-body" id="conciliacion-body">
          <div style="text-align:center;color:#9ca3af;">Cargando...</div>
        </div>
      </div>

      ${isAdminOrAbove(user.rol) ? `
      <!-- Modal: Nueva Cuenta -->
      <div class="modal-overlay" id="modal-banco-nueva">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-university" style="color:#059669"></i> Nueva Cuenta Bancaria</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-banco-nueva').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/bancos">
              <div class="form-group">
                <label class="form-label">ENTIDAD BANCARIA *</label>
                <input type="text" name="nombre_entidad" required class="form-control" placeholder="Ej: Banco Itaú, Santander, Cuenta Caja">
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">NRO. DE CUENTA</label>
                  <input type="text" name="nro_cuenta" class="form-control" placeholder="Opcional">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA *</label>
                  <select name="moneda" class="form-control">
                    <option value="USD">USD — Dólares</option>
                    <option value="UYU">UYU — Pesos Uruguayos</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">DESCRIPCIÓN / ALIAS</label>
                <input type="text" name="descripcion" class="form-control" placeholder="Ej: Cuenta operativa principal, Caja chica, etc." maxlength="200">
              </div>
              <div class="form-group">
                <label class="form-label">SALDO INICIAL</label>
                <input type="number" name="saldo_inicial" value="0" step="0.01" class="form-control">
                <div style="font-size:11px;color:#9ca3af;margin-top:4px;">
                  <i class="fas fa-info-circle"></i> Saldo con el que comienza la cuenta en el sistema (saldo real al momento del alta).
                </div>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Crear Cuenta</button>
                <button type="button" onclick="document.getElementById('modal-banco-nueva').classList.remove('active')" class="btn btn-outline">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal: Editar Cuenta -->
      <div class="modal-overlay" id="modal-banco-editar">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-edit" style="color:#F7941D"></i> Editar Cuenta Bancaria</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-banco-editar').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" id="form-editar-banco">
              <input type="hidden" name="_method" value="PUT">
              <div class="form-group">
                <label class="form-label">ENTIDAD BANCARIA *</label>
                <input type="text" name="nombre_entidad" id="edit-nombre" required class="form-control">
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">NRO. DE CUENTA</label>
                  <input type="text" name="nro_cuenta" id="edit-nro" class="form-control">
                </div>
                <div class="form-group">
                  <label class="form-label">MONEDA *</label>
                  <select name="moneda" id="edit-moneda" class="form-control">
                    <option value="USD">USD — Dólares</option>
                    <option value="UYU">UYU — Pesos Uruguayos</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">DESCRIPCIÓN / ALIAS</label>
                <input type="text" name="descripcion" id="edit-desc" class="form-control" maxlength="200">
              </div>
              <div class="form-group">
                <label class="form-label">SALDO INICIAL</label>
                <input type="number" name="saldo_inicial" id="edit-saldo" step="0.01" class="form-control">
                <div style="font-size:11px;color:#e57309;margin-top:4px;">
                  <i class="fas fa-exclamation-triangle"></i> Modificar el saldo inicial afecta el saldo actual calculado.
                </div>
              </div>
              <div style="display:flex;gap:10px;">
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Guardar cambios</button>
                <button type="button" onclick="document.getElementById('modal-banco-editar').classList.remove('active')" class="btn btn-outline">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal: Confirmar cierre/reactivación -->
      <div class="modal-overlay" id="modal-banco-toggle">
        <div class="modal" style="max-width:460px;">
          <div class="modal-header">
            <span class="modal-title" id="toggle-titulo"></span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-banco-toggle').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <p id="toggle-mensaje" style="margin-bottom:16px;color:#374151;line-height:1.6;"></p>
            <div id="toggle-aviso-movimientos" style="display:none;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#92400e;">
              <i class="fas fa-exclamation-triangle"></i>
              <strong>Esta cuenta tiene movimientos registrados.</strong> Al cerrarla quedará deshabilitada
              pero todos los movimientos existentes se conservan intactos.
            </div>
            <div style="display:flex;gap:10px;">
              <button id="btn-confirmar-toggle" class="btn btn-primary" onclick="ejecutarToggleBanco()">
                Confirmar
              </button>
              <button class="btn btn-outline" onclick="document.getElementById('modal-banco-toggle').classList.remove('active')">Cancelar</button>
            </div>
          </div>
        </div>
      </div>
      ` : ''}

      <script>
        let _bancoToggleId = null
        let _bancoToggleActivo = null

        function hEsc(str) {
          if (str == null) return ''
          return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;')
        }

        function toggleCerradas() {
          const panel = document.getElementById('panel-cerradas')
          const icon  = document.getElementById('icon-cerradas')
          const open  = panel.style.display !== 'none'
          panel.style.display = open ? 'none' : 'block'
          icon.className = open ? 'fas fa-chevron-right' : 'fas fa-chevron-down'
        }

        function abrirEditarBanco(id, nombre, nro, moneda, saldo, desc) {
          document.getElementById('edit-nombre').value = nombre
          document.getElementById('edit-nro').value    = nro
          document.getElementById('edit-desc').value   = desc
          document.getElementById('edit-saldo').value  = saldo
          const sel = document.getElementById('edit-moneda')
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === moneda) { sel.selectedIndex = i; break }
          }
          document.getElementById('form-editar-banco').action = '/bancos/' + id + '/editar'
          document.getElementById('modal-banco-editar').classList.add('active')
        }

        function confirmarToggleBanco(id, activo, nombre, tieneMovimientos) {
          _bancoToggleId     = id
          _bancoToggleActivo = activo
          const cerrando = activo === 1
          document.getElementById('toggle-titulo').innerHTML =
            cerrando
              ? '<i class="fas fa-lock" style="color:#dc2626"></i> Cerrar cuenta'
              : '<i class="fas fa-lock-open" style="color:#059669"></i> Reactivar cuenta'
          document.getElementById('toggle-mensaje').innerHTML = cerrando
            ? \`¿Confirmás que querés <strong>cerrar</strong> la cuenta <strong>\${hEsc(nombre)}</strong>?<br>No estará disponible para nuevos movimientos.\`
            : \`¿Confirmás que querés <strong>reactivar</strong> la cuenta <strong>\${hEsc(nombre)}</strong>?<br>Volverá a estar disponible para registrar movimientos.\`
          document.getElementById('toggle-aviso-movimientos').style.display = (cerrando && tieneMovimientos) ? 'block' : 'none'
          const btn = document.getElementById('btn-confirmar-toggle')
          btn.style.background = cerrando ? '#dc2626' : '#059669'
          btn.textContent      = cerrando ? 'Sí, cerrar cuenta' : 'Sí, reactivar'
          document.getElementById('modal-banco-toggle').classList.add('active')
        }

        async function ejecutarToggleBanco() {
          if (!_bancoToggleId) return
          try {
            const r = await fetch('/bancos/' + _bancoToggleId + '/toggle-activo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ activo: _bancoToggleActivo === 1 ? 0 : 1 })
            })
            const d = await r.json()
            if (d.ok) {
              window.location.href = '/bancos?success=' + (d.activo ? 'reactivada' : 'cerrada')
            } else {
              alert('Error: ' + (d.error || 'desconocido'))
            }
          } catch(e) {
            alert('Error de conexión')
          }
        }

        // ── Conciliación ──────────────────────────────────────
        async function verConciliacion(bancoId, nombre) {
          document.getElementById('conciliacion-section').style.display = 'block'
          document.getElementById('conciliacion-section').scrollIntoView({ behavior: 'smooth', block: 'start' })
          const titleEl = document.getElementById('conciliacion-title')
          titleEl.innerHTML = '<i class="fas fa-balance-scale" style="color:#F7941D"></i> Conciliación: '
          const span = document.createElement('span')
          span.textContent = nombre
          titleEl.appendChild(span)
          document.getElementById('conciliacion-body').innerHTML =
            '<div style="text-align:center;padding:20px;color:#9ca3af;">Cargando movimientos...</div>'

          try {
            const r    = await fetch('/bancos/' + encodeURIComponent(bancoId) + '/movimientos')
            const data = await r.json()

            let html = '<div class="table-wrapper"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Monto</th><th>✓ Conciliado</th></tr></thead><tbody>'
            if (data.movimientos.length === 0) {
              html += '<tr><td colspan="5" style="text-align:center;padding:20px;color:#9ca3af;">Sin movimientos en este banco</td></tr>'
            } else {
              data.movimientos.forEach(m => {
                const safeId    = Number.isInteger(m.id) ? m.id : 0
                const safeFecha = hEsc((m.fecha||'').split('T')[0])
                const safeConc  = hEsc(m.concepto)
                const safeTipo  = m.tipo === 'ingreso' ? 'ingreso' : 'egreso'
                const safeColor = safeTipo === 'ingreso' ? '#059669' : '#dc2626'
                const safeBadge = safeTipo === 'ingreso' ? 'badge-confirmado' : 'badge-anulado'
                const safeMonto = hEsc(Number(m.monto).toLocaleString('es-UY',{minimumFractionDigits:2}))
                const safeMoneda = hEsc(m.moneda)
                html += \`<tr>
                  <td style="font-size:12px;">\${safeFecha}</td>
                  <td>\${safeConc}</td>
                  <td><span class="badge \${safeBadge}">\${safeTipo}</span></td>
                  <td><strong style="color:\${safeColor}">\${safeTipo==='ingreso'?'+':'-'} \${safeMonto} \${safeMoneda}</strong></td>
                  <td style="text-align:center;">
                    <input type="checkbox" \${m.conciliado?'checked':''} onchange="toggleConciliacion(\${safeId}, this.checked)"
                      style="width:16px;height:16px;cursor:pointer;accent-color:#7B3FA0;">
                  </td>
                </tr>\`
              })
            }
            html += '</tbody></table></div>'

            const safeBId = encodeURIComponent(bancoId)
            html += \`
              <div style="margin-top:16px;padding-top:16px;border-top:1px solid #ede5f5;">
                <div style="font-size:13px;font-weight:700;color:#5a2d75;margin-bottom:10px;">
                  <i class="fas fa-plus-circle" style="color:#F7941D"></i> Agregar línea de extracto bancario
                </div>
                <form method="POST" action="/bancos/\${safeBId}/conciliacion"
                  style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:flex-end;">
                  <div>
                    <label class="form-label">Descripción</label>
                    <input type="text" name="descripcion" class="form-control" placeholder="Descripción extracto" maxlength="500">
                  </div>
                  <div>
                    <label class="form-label">Monto</label>
                    <input type="number" name="monto" step="0.01" min="0.01" class="form-control" placeholder="0.00">
                  </div>
                  <div>
                    <label class="form-label">Tipo</label>
                    <select name="tipo" class="form-control">
                      <option value="ingreso">Ingreso</option>
                      <option value="egreso">Egreso</option>
                    </select>
                  </div>
                  <button type="submit" class="btn btn-primary btn-sm"><i class="fas fa-plus"></i></button>
                </form>
              </div>
            \`

            document.getElementById('conciliacion-body').innerHTML = html
          } catch(e) {
            document.getElementById('conciliacion-body').innerHTML =
              '<div class="alert alert-danger">Error al cargar movimientos</div>'
          }
        }

        async function toggleConciliacion(id, conciliado) {
          await fetch('/bancos/conciliacion/' + encodeURIComponent(id) + '/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conciliado: conciliado ? 1 : 0 })
          })
        }
        // Auto-abrir conciliación si viene de un redirect
        ${autoOpen ? `
        document.addEventListener('DOMContentLoaded', function() {
          abrirConciliacion(${autoOpen})
          ${okMsg === 'linea_agregada' ? `
          const toast = document.createElement('div')
          toast.innerHTML = '<i class="fas fa-check-circle"></i> Línea agregada correctamente'
          toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#059669;color:white;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);'
          document.body.appendChild(toast)
          setTimeout(() => toast.remove(), 3000)
          ` : ''}
        })
        ` : ''}
      </script>
    `
    return c.html(baseLayout('Bancos', content, user, 'bancos'))
  } catch (e: any) {
    console.error('[BANCOS]', e.message)
    return c.html(baseLayout('Bancos', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'bancos'))
  }
})

// ── POST /bancos — Crear cuenta nueva ────────────────────────
bancos.post('/bancos', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/bancos?error=sin_permiso')
  const b = await c.req.parseBody()
  const MONEDAS_B = ['USD', 'UYU']
  const moneda       = MONEDAS_B.includes(String(b.moneda)) ? String(b.moneda) : 'USD'
  const nombreEntidad = String(b.nombre_entidad || '').trim().substring(0, 200)
  const nroCuenta     = b.nro_cuenta    ? String(b.nro_cuenta).trim().substring(0, 100)   : null
  const descripcion   = b.descripcion   ? String(b.descripcion).trim().substring(0, 200)  : null
  const saldoInicial  = Number(b.saldo_inicial || 0)
  if (!nombreEntidad) return c.redirect('/bancos?error=nombre_requerido')
  await c.env.DB.prepare(
    `INSERT INTO bancos (nombre_entidad, nro_cuenta, moneda, saldo_inicial, descripcion, activo) VALUES (?,?,?,?,?,1)`
  ).bind(nombreEntidad, nroCuenta, moneda, isFinite(saldoInicial) ? saldoInicial : 0, descripcion).run()
  invalidateCache('bancos:activos')
  return c.redirect('/bancos?success=creada')
})

// ── POST /bancos/:id/editar — Actualizar cuenta ───────────────
bancos.post('/bancos/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/bancos?error=sin_permiso')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.redirect('/bancos?error=no_encontrado')

  const b = await c.req.parseBody()
  const MONEDAS_B = ['USD', 'UYU']
  const moneda        = MONEDAS_B.includes(String(b.moneda)) ? String(b.moneda) : 'USD'
  const nombreEntidad = String(b.nombre_entidad || '').trim().substring(0, 200)
  const nroCuenta     = b.nro_cuenta   ? String(b.nro_cuenta).trim().substring(0, 100)  : null
  const descripcion   = b.descripcion  ? String(b.descripcion).trim().substring(0, 200) : null
  const saldoInicial  = Number(b.saldo_inicial || 0)

  if (!nombreEntidad) return c.redirect('/bancos?error=nombre_requerido')

  // Verificar que la cuenta existe
  const existe = await c.env.DB.prepare(`SELECT id FROM bancos WHERE id=?`).bind(id).first()
  if (!existe) return c.redirect('/bancos?error=no_encontrado')

  await c.env.DB.prepare(
    `UPDATE bancos SET nombre_entidad=?, nro_cuenta=?, moneda=?, saldo_inicial=?, descripcion=? WHERE id=?`
  ).bind(nombreEntidad, nroCuenta, moneda, isFinite(saldoInicial) ? saldoInicial : 0, descripcion, id).run()
  invalidateCache('bancos:activos')
  return c.redirect('/bancos?success=actualizada')
})

// ── POST /bancos/:id/toggle-activo — Cerrar o reactivar ──────
bancos.post('/bancos/:id/toggle-activo', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'Sin permiso' }, 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'ID inválido' }, 400)

  try {
    const body   = await c.req.json() as any
    const activo = body.activo === 1 || body.activo === true ? 1 : 0

    // Si se va a cerrar, verificar que no sea la única cuenta activa con movimientos recientes
    // (no bloqueamos, solo informamos — la UI ya mostró el aviso)
    const existe = await c.env.DB.prepare(`SELECT id, activo FROM bancos WHERE id=?`).bind(id).first() as any
    if (!existe) return c.json({ error: 'Cuenta no encontrada' }, 404)

    await c.env.DB.prepare(`UPDATE bancos SET activo=? WHERE id=?`).bind(activo, id).run()
    invalidateCache('bancos:activos')
    return c.json({ ok: true, activo })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ── GET /bancos/:id/movimientos ───────────────────────────────
bancos.get('/bancos/:id/movimientos', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const id = c.req.param('id')
  const movs = await c.env.DB.prepare(
    `SELECT * FROM movimientos_caja WHERE banco_id = ? AND anulado = 0 ORDER BY fecha DESC LIMIT 100`
  ).bind(id).all()
  return c.json({ movimientos: movs.results })
})

// ── POST /bancos/:id/conciliacion ─────────────────────────────
bancos.post('/bancos/:id/conciliacion', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/bancos')
  const id = c.req.param('id')
  const b  = await c.req.parseBody()
  const TIPOS_CONC = ['ingreso', 'egreso']
  const tipoCon    = TIPOS_CONC.includes(String(b.tipo)) ? String(b.tipo) : 'ingreso'
  const monto      = Number(b.monto)
  const descripcion = String(b.descripcion || '').trim().substring(0, 500)
  if (!isFinite(monto) || monto <= 0) return c.redirect('/bancos?error=monto_invalido')
  await c.env.DB.prepare(
    `INSERT INTO conciliacion_bancaria (banco_id, fecha, descripcion, monto, tipo) VALUES (?,datetime('now'),?,?,?)`
  ).bind(id, descripcion, monto, tipoCon).run()
  return c.redirect('/bancos?banco_id=' + id + '&ok=linea_agregada')
})

// ── POST /bancos/conciliacion/:id/toggle ─────────────────────
bancos.post('/bancos/conciliacion/:id/toggle', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'No autenticado' }, 401)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'ID inválido' }, 400)
  const body      = await c.req.json() as any
  const conciliado = body.conciliado === 1 || body.conciliado === true ? 1 : 0
  await c.env.DB.prepare(`UPDATE conciliacion_bancaria SET conciliado=? WHERE id=?`).bind(conciliado, id).run()
  return c.json({ ok: true })
})


// ══════════════════════════════════════════════════════════════
// CAJA CHICA — Apertura, cierre y vista diaria
// ══════════════════════════════════════════════════════════════

// ── GET /bancos/caja ─ Vista principal de caja chica ──────────
bancos.get('/bancos/caja', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')
  if (!isAdminOrAbove(user.rol)) return c.redirect('/bancos?error=sin_permiso')

  const hoy = new Date().toISOString().split('T')[0]
  const ok  = c.req.query('ok') || ''
  const err = c.req.query('error') || ''

  // Sesiones activas (abiertas)
  const sesionesAbiertas = await c.env.DB.prepare(`
    SELECT cs.*, u.nombre as abierta_por_nombre
    FROM caja_sesiones cs
    LEFT JOIN usuarios u ON u.id = cs.abierta_por
    WHERE cs.estado = 'abierta'
    ORDER BY cs.fecha DESC
  `).all()

  // Alerta: cajas abiertas de días anteriores
  const cajasVencidas = (sesionesAbiertas.results as any[]).filter((s: any) => s.fecha < hoy)

  // Historial de sesiones cerradas (últimas 30)
  const historial = await c.env.DB.prepare(`
    SELECT cs.*, u1.nombre as abierta_por_nombre, u2.nombre as cerrada_por_nombre
    FROM caja_sesiones cs
    LEFT JOIN usuarios u1 ON u1.id = cs.abierta_por
    LEFT JOIN usuarios u2 ON u2.id = cs.cerrada_por
    WHERE cs.estado = 'cerrada'
    ORDER BY cs.fecha DESC LIMIT 30
  `).all()

  const okMsg  = ok  === 'abierta'  ? 'Caja abierta correctamente.'
               : ok  === 'cerrada'  ? 'Caja cerrada correctamente.'
               : ''
  const errMsg = err === 'ya_abierta'     ? 'Ya existe una caja abierta para esa moneda hoy.'
               : err === 'caja_vencida'   ? 'Hay una caja abierta de un día anterior. Cerrala antes de continuar.'
               : err === 'no_encontrada'  ? 'Sesión de caja no encontrada.'
               : err === 'ya_cerrada'     ? 'Esa caja ya fue cerrada.'
               : err === 'monto_invalido' ? 'El monto ingresado no es válido.'
               : err

  const fmtMonto = (m: number, moneda: string) =>
    `$${Number(m).toLocaleString('es-UY', { minimumFractionDigits: 2 })} ${moneda}`

  const content = `
    ${cajasVencidas.length > 0 ? `
      <div class="alert alert-danger" style="margin-bottom:20px;display:flex;align-items:flex-start;gap:12px;">
        <i class="fas fa-exclamation-triangle" style="font-size:20px;margin-top:2px;"></i>
        <div>
          <strong>⚠ Caja sin cerrar de días anteriores</strong>
          <ul style="margin:6px 0 0 16px;font-size:13px;">
            ${cajasVencidas.map((s: any) => `
              <li>
                Caja <strong>${s.moneda}</strong> del <strong>${s.fecha}</strong>
                abierta por ${esc(s.abierta_por_nombre)} —
                <a href="/bancos/caja/${s.id}/cerrar" style="color:#dc2626;font-weight:700;">Cerrar ahora →</a>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    ` : ''}

    ${okMsg ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> ${okMsg}</div>` : ''}
    ${errMsg ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> ${errMsg}</div>` : ''}

    <!-- Cajas abiertas hoy -->
    <div class="grid-2" style="margin-bottom:24px;">
      ${['USD','UYU'].map((moneda: string) => {
        const sesion = (sesionesAbiertas.results as any[]).find((s: any) => s.moneda === moneda && s.fecha === hoy)
        const vencida = (sesionesAbiertas.results as any[]).find((s: any) => s.moneda === moneda && s.fecha < hoy)
        const cajaActual = sesion || vencida
        return `
          <div class="card" style="border:2px solid ${cajaActual ? '#059669' : '#e5e7eb'};">
            <div class="card-header" style="background:${cajaActual ? '#f0fdf4' : '#f9fafb'};">
              <span class="card-title">
                <i class="fas fa-cash-register" style="color:${cajaActual ? '#059669' : '#9ca3af'};"></i>
                Caja ${moneda}
              </span>
              ${cajaActual ? `
                <span style="font-size:11px;font-weight:700;color:#059669;background:#d1fae5;padding:3px 10px;border-radius:8px;">
                  ● ABIERTA ${cajaActual.fecha !== hoy ? `<span style="color:#dc2626;">(${cajaActual.fecha})</span>` : 'HOY'}
                </span>
              ` : `
                <span style="font-size:11px;color:#9ca3af;background:#f3f4f6;padding:3px 10px;border-radius:8px;">
                  ○ CERRADA
                </span>
              `}
            </div>
            <div style="padding:16px;">
              ${cajaActual ? `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                  <div style="text-align:center;padding:10px;background:#f9fafb;border-radius:8px;">
                    <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">INICIAL</div>
                    <div style="font-size:16px;font-weight:800;">${fmtMonto(cajaActual.monto_inicial, moneda)}</div>
                  </div>
                  <div style="text-align:center;padding:10px;background:#f0fdf4;border-radius:8px;">
                    <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">ESPERADO</div>
                    <div style="font-size:16px;font-weight:800;color:#059669;">
                      ${fmtMonto(cajaActual.monto_inicial + cajaActual.monto_ingresos - cajaActual.monto_egresos, moneda)}
                    </div>
                  </div>
                  <div style="text-align:center;padding:10px;background:#dbeafe;border-radius:8px;">
                    <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">INGRESOS</div>
                    <div style="font-size:14px;font-weight:700;color:#1d4ed8;">+${fmtMonto(cajaActual.monto_ingresos, moneda)}</div>
                  </div>
                  <div style="text-align:center;padding:10px;background:#fee2e2;border-radius:8px;">
                    <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">EGRESOS</div>
                    <div style="font-size:14px;font-weight:700;color:#dc2626;">-${fmtMonto(cajaActual.monto_egresos, moneda)}</div>
                  </div>
                </div>
                <div style="font-size:11px;color:#6b7280;margin-bottom:12px;">
                  Abierta por <strong>${esc(cajaActual.abierta_por_nombre)}</strong>
                </div>
                <a href="/bancos/caja/${cajaActual.id}/cerrar"
                   class="btn btn-danger" style="width:100%;text-align:center;">
                  <i class="fas fa-lock"></i> Cerrar Caja ${moneda}
                </a>
              ` : `
                <p style="color:#9ca3af;font-size:13px;margin-bottom:16px;">No hay caja abierta para hoy.</p>
                <button onclick="document.getElementById('modal-abrir-${moneda}').classList.add('active')"
                  class="btn btn-primary" style="width:100%;">
                  <i class="fas fa-lock-open"></i> Abrir Caja ${moneda}
                </button>
              `}
            </div>
          </div>
        `
      }).join('')}
    </div>

    <!-- Historial -->
    <div class="card">
      <div class="card-header">
        <span class="card-title"><i class="fas fa-history" style="color:#7B3FA0;"></i> Historial de Sesiones</span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Fecha</th><th>Moneda</th><th>Inicial</th><th>Ingresos</th>
              <th>Egresos</th><th>Esperado</th><th>Real</th><th>Diferencia</th>
              <th>Abrió</th><th>Cerró</th><th>Notas</th>
            </tr>
          </thead>
          <tbody>
            ${(historial.results as any[]).length === 0
              ? `<tr><td colspan="11" style="text-align:center;padding:20px;color:#9ca3af;">Sin historial aún.</td></tr>`
              : (historial.results as any[]).map((s: any) => {
                  const esperado = s.monto_inicial + s.monto_ingresos - s.monto_egresos
                  const diff = s.monto_real != null ? s.monto_real - esperado : null
                  return `
                    <tr>
                      <td style="font-size:12px;">${s.fecha}</td>
                      <td><span style="font-weight:700;color:#7B3FA0;">${esc(s.moneda)}</span></td>
                      <td style="font-size:12px;">${fmtMonto(s.monto_inicial, s.moneda)}</td>
                      <td style="font-size:12px;color:#1d4ed8;">+${fmtMonto(s.monto_ingresos, s.moneda)}</td>
                      <td style="font-size:12px;color:#dc2626;">-${fmtMonto(s.monto_egresos, s.moneda)}</td>
                      <td style="font-size:12px;font-weight:700;">${fmtMonto(esperado, s.moneda)}</td>
                      <td style="font-size:12px;color:#059669;">${s.monto_real != null ? fmtMonto(s.monto_real, s.moneda) : '—'}</td>
                      <td style="font-size:12px;font-weight:700;color:${diff == null ? '#9ca3af' : diff < -0.001 ? '#dc2626' : diff > 0.001 ? '#d97706' : '#059669'};">
                        ${diff == null ? '—' : (diff >= 0 ? '+' : '') + fmtMonto(diff, s.moneda)}
                      </td>
                      <td style="font-size:11px;color:#6b7280;">${esc(s.abierta_por_nombre || '')}</td>
                      <td style="font-size:11px;color:#6b7280;">${esc(s.cerrada_por_nombre || '')}</td>
                      <td style="font-size:11px;color:#6b7280;">${esc(s.notas_cierre || '—')}</td>
                    </tr>
                  `
                }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modales de apertura USD y UYU -->
    ${['USD','UYU'].map((moneda: string) => `
      <div class="modal-overlay" id="modal-abrir-${moneda}">
        <div class="modal" style="max-width:400px;">
          <div class="modal-header">
            <span class="modal-title">
              <i class="fas fa-lock-open" style="color:#059669;"></i> Abrir Caja ${moneda} — ${hoy}
            </span>
            <button type="button" class="modal-close"
              onclick="document.getElementById('modal-abrir-${moneda}').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/bancos/caja/abrir">
              <input type="hidden" name="moneda" value="${moneda}">
              <div class="form-group">
                <label class="form-label">MONTO INICIAL EN CAJA (${moneda}) *</label>
                <input type="number" name="monto_inicial" min="0" step="0.01" value="0"
                  required class="form-control" placeholder="0.00"
                  style="font-size:20px;font-weight:800;text-align:center;">
                <div style="font-size:11px;color:#6b7280;margin-top:4px;">
                  Ingresá el efectivo físico disponible al inicio del día.
                </div>
              </div>
              <div style="display:flex;gap:10px;margin-top:16px;">
                <button type="submit" class="btn btn-primary" style="flex:1;">
                  <i class="fas fa-lock-open"></i> Abrir Caja
                </button>
                <button type="button" class="btn btn-outline"
                  onclick="document.getElementById('modal-abrir-${moneda}').classList.remove('active')">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `).join('')}
  `

  return c.html(baseLayout('Caja Chica', content, user, 'bancos'))
})

// ── POST /bancos/caja/abrir ───────────────────────────────────
bancos.post('/bancos/caja/abrir', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/bancos/caja?error=sin_permiso')

  const body   = await c.req.parseBody()
  const moneda = String(body.moneda || '').trim()
  const monto  = Number(body.monto_inicial || 0)
  const hoy    = new Date().toISOString().split('T')[0]

  if (!['USD','UYU'].includes(moneda)) return c.redirect('/bancos/caja?error=moneda_invalida')
  if (!isFinite(monto) || monto < 0)  return c.redirect('/bancos/caja?error=monto_invalido')

  // Verificar que no haya una caja vencida sin cerrar para esta moneda
  const cajasAbiertas = await c.env.DB.prepare(`
    SELECT id, fecha FROM caja_sesiones WHERE moneda = ? AND estado = 'abierta' LIMIT 1
  `).bind(moneda).first() as any

  if (cajasAbiertas) {
    if (cajasAbiertas.fecha < hoy) return c.redirect('/bancos/caja?error=caja_vencida')
    return c.redirect('/bancos/caja?error=ya_abierta')
  }

  await c.env.DB.prepare(`
    INSERT INTO caja_sesiones (moneda, fecha, monto_inicial, estado, abierta_por)
    VALUES (?, ?, ?, 'abierta', ?)
  `).bind(moneda, hoy, monto, user.id).run()

  return c.redirect('/bancos/caja?ok=abierta')
})

// ── GET /bancos/caja/:id/cerrar ─ Formulario de cierre ────────
bancos.get('/bancos/caja/:id/cerrar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/bancos/caja')

  const id = Number(c.req.param('id'))
  const sesion = await c.env.DB.prepare(`
    SELECT cs.*, u.nombre as abierta_por_nombre
    FROM caja_sesiones cs LEFT JOIN usuarios u ON u.id = cs.abierta_por
    WHERE cs.id = ?
  `).bind(id).first() as any

  if (!sesion)                   return c.redirect('/bancos/caja?error=no_encontrada')
  if (sesion.estado === 'cerrada') return c.redirect('/bancos/caja?error=ya_cerrada')

  const esperado = sesion.monto_inicial + sesion.monto_ingresos - sesion.monto_egresos
  const fmtMonto = (m: number) =>
    `$${Number(m).toLocaleString('es-UY', { minimumFractionDigits: 2 })} ${sesion.moneda}`

  // Movimientos del día
  const movimientos = await c.env.DB.prepare(`
    SELECT mc.*, f.numero as file_numero,
           COALESCE(cl.nombre || ' ' || cl.apellido, cl.nombre_completo) as cliente_nombre,
           u.nombre as operador_nombre
    FROM movimientos_caja mc
    LEFT JOIN files f ON f.id = mc.file_id
    LEFT JOIN clientes cl ON cl.id = mc.cliente_id
    LEFT JOIN usuarios u ON u.id = mc.usuario_id
    WHERE mc.caja_sesion_id = ? AND mc.anulado = 0
    ORDER BY mc.fecha DESC
  `).bind(id).all()

  const content = `
    <div style="max-width:700px;margin:0 auto;">
      ${sesion.fecha < new Date().toISOString().split('T')[0] ? `
        <div class="alert alert-danger" style="margin-bottom:16px;">
          <i class="fas fa-exclamation-triangle"></i>
          <strong>Caja del ${sesion.fecha} sin cerrar</strong> — Es obligatorio cerrar la caja del día antes de abrir una nueva.
        </div>
      ` : ''}

      <div class="card" style="margin-bottom:20px;">
        <div class="card-header" style="background:#f0fdf4;">
          <span class="card-title">
            <i class="fas fa-lock" style="color:#dc2626;"></i>
            Cerrar Caja ${esc(sesion.moneda)} — ${sesion.fecha}
          </span>
        </div>
        <div style="padding:16px;">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
            <div style="text-align:center;padding:12px;background:#f9fafb;border-radius:8px;">
              <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">MONTO INICIAL</div>
              <div style="font-size:16px;font-weight:800;">${fmtMonto(sesion.monto_inicial)}</div>
            </div>
            <div style="text-align:center;padding:12px;background:#dbeafe;border-radius:8px;">
              <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">INGRESOS DEL DÍA</div>
              <div style="font-size:16px;font-weight:800;color:#1d4ed8;">+${fmtMonto(sesion.monto_ingresos)}</div>
            </div>
            <div style="text-align:center;padding:12px;background:#fee2e2;border-radius:8px;">
              <div style="font-size:11px;color:#6b7280;margin-bottom:4px;">EGRESOS DEL DÍA</div>
              <div style="font-size:16px;font-weight:800;color:#dc2626;">-${fmtMonto(sesion.monto_egresos)}</div>
            </div>
          </div>
          <div style="text-align:center;padding:16px;background:#f0fdf4;border-radius:10px;margin-bottom:20px;">
            <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">TOTAL ESPERADO EN CAJA</div>
            <div style="font-size:28px;font-weight:800;color:#059669;">${fmtMonto(esperado)}</div>
          </div>

          <form method="POST" action="/bancos/caja/${id}/cerrar">
            <div class="form-group">
              <label class="form-label">MONTO CONTADO FÍSICAMENTE (${esc(sesion.moneda)}) *</label>
              <input type="number" name="monto_real" min="0" step="0.01"
                value="${esperado.toFixed(2)}" required class="form-control"
                style="font-size:22px;font-weight:800;text-align:center;"
                oninput="calcDif(this.value, ${esperado})">
              <div id="dif-display" style="text-align:center;margin-top:8px;font-size:14px;font-weight:700;"></div>
            </div>
            <div class="form-group">
              <label class="form-label">NOTAS DE CIERRE (opcional)</label>
              <textarea name="notas_cierre" class="form-control" rows="2"
                placeholder="Observaciones, diferencias, etc."></textarea>
            </div>
            <div style="display:flex;gap:10px;margin-top:16px;">
              <button type="submit" class="btn btn-danger" style="flex:1;">
                <i class="fas fa-lock"></i> Confirmar Cierre
              </button>
              <a href="/bancos/caja" class="btn btn-outline">Cancelar</a>
            </div>
          </form>
        </div>
      </div>

      <!-- Movimientos del día -->
      ${movimientos.results.length > 0 ? `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Movimientos del día (${movimientos.results.length})</span>
          </div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>File</th><th>Monto</th><th>Operador</th></tr></thead>
              <tbody>
                ${(movimientos.results as any[]).map((m: any) => `
                  <tr>
                    <td style="font-size:11px;color:#6b7280;">${(m.fecha||'').substring(11,16)}</td>
                    <td><span class="badge ${m.tipo === 'ingreso' ? 'badge-seniado' : 'badge-en_proceso'}">${m.tipo}</span></td>
                    <td style="font-size:12px;">${esc(m.concepto)}</td>
                    <td style="font-size:12px;">${m.file_numero ? '#' + String(m.file_numero).replace(/^\d{4}/,'') : '—'}</td>
                    <td style="font-weight:700;color:${m.tipo==='ingreso'?'#059669':'#dc2626'};">
                      ${m.tipo==='ingreso'?'+':'-'}$${Number(m.monto).toLocaleString('es-UY',{minimumFractionDigits:2})} ${m.moneda}
                    </td>
                    <td style="font-size:11px;color:#6b7280;">${esc(m.operador_nombre||'')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    </div>

    <script>
      function calcDif(val, esperado) {
        const real = parseFloat(val) || 0
        const dif  = real - esperado
        const el   = document.getElementById('dif-display')
        if (!el) return
        if (Math.abs(dif) < 0.001) {
          el.innerHTML = '<span style="color:#059669;">✓ Sin diferencia</span>'
        } else if (dif > 0) {
          el.innerHTML = '<span style="color:#d97706;">Sobrante: +$' + dif.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</span>'
        } else {
          el.innerHTML = '<span style="color:#dc2626;">Faltante: $' + dif.toLocaleString('es-UY',{minimumFractionDigits:2}) + '</span>'
        }
      }
      calcDif(${esperado.toFixed(2)}, ${esperado})
    </script>
  `
  return c.html(baseLayout(`Cerrar Caja ${sesion.moneda}`, content, user, 'bancos'))
})

// ── POST /bancos/caja/:id/cerrar ──────────────────────────────
bancos.post('/bancos/caja/:id/cerrar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/bancos/caja')

  const id   = Number(c.req.param('id'))
  const body = await c.req.parseBody()
  const montoReal = Number(body.monto_real)
  const notas     = String(body.notas_cierre || '').trim()

  if (!isFinite(montoReal) || montoReal < 0) return c.redirect(`/bancos/caja/${id}/cerrar?error=monto_invalido`)

  const sesion = await c.env.DB.prepare(
    `SELECT * FROM caja_sesiones WHERE id = ?`
  ).bind(id).first() as any

  if (!sesion)                     return c.redirect('/bancos/caja?error=no_encontrada')
  if (sesion.estado === 'cerrada') return c.redirect('/bancos/caja?error=ya_cerrada')

  const esperado   = sesion.monto_inicial + sesion.monto_ingresos - sesion.monto_egresos
  const diferencia = montoReal - esperado

  await c.env.DB.prepare(`
    UPDATE caja_sesiones
    SET estado = 'cerrada', monto_real = ?, diferencia = ?,
        notas_cierre = ?, cerrada_por = ?, closed_at = datetime('now')
    WHERE id = ?
  `).bind(montoReal, diferencia, notas || null, user.id, id).run()

  return c.redirect('/bancos/caja?ok=cerrada')
})

export default bancos
