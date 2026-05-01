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

export default bancos
