import { Hono } from 'hono'
import { getUser, hashPassword, canManageUsers, isAdminOrAbove, rolLabel, rolColor, rolTextColor } from '../lib/auth'
import { baseLayout } from '../lib/layout'
import { esc } from '../lib/escape'

type Bindings = { DB: D1Database }
const admin = new Hono<{ Bindings: Bindings }>()

// ===================== USUARIOS =====================
admin.get('/usuarios', async (c) => {
  const user = await getUser(c)
  // Usuarios: gerente ve todo y puede crear/editar; administración puede ver pero no crear
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/dashboard')

  const errorMsg = c.req.query('error') || ''
  const okMsg    = c.req.query('ok')    || ''

  try {
    const usuarios = await c.env.DB.prepare('SELECT id, nombre, email, COALESCE(rol_extendido, rol) as rol, activo, created_at FROM usuarios ORDER BY nombre').all()
    // Contar files por usuario para saber si se puede eliminar
    const filesPorUsuario = await c.env.DB.prepare('SELECT vendedor_id, COUNT(*) as n FROM files GROUP BY vendedor_id').all()
    const filesMap: Record<number, number> = {}
    for (const r of (filesPorUsuario.results as any[])) filesMap[r.vendedor_id] = r.n

    const alertas = `
      ${okMsg === 'password_cambiado' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> Contraseña actualizada correctamente.</div>` : ''}
      ${okMsg === 'usuario_eliminado' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> Usuario eliminado correctamente.</div>` : ''}
      ${okMsg === 'usuario_creado' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> Usuario creado correctamente.</div>` : ''}
      ${okMsg === 'usuario_editado' ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> Usuario actualizado correctamente.</div>` : ''}
      ${errorMsg === 'email_duplicado' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> Ya existe un usuario con ese email.</div>` : ''}
      ${errorMsg === 'datos_incompletos' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> Nombre y email son obligatorios.</div>` : ''}
      ${errorMsg === 'tiene_files' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> No se puede eliminar el usuario porque tiene files asociados.</div>` : ''}
      ${errorMsg === 'no_self_delete' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> No puedes eliminarte a ti mismo.</div>` : ''}
      ${errorMsg === 'no_self_downgrade' ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> No puedes cambiar tu propio rol a uno diferente de Gerente.</div>` : ''}
      ${errorMsg && !['email_duplicado','datos_incompletos','password_cambiado','tiene_files','no_self_delete','no_self_downgrade'].includes(errorMsg) ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> ${esc(decodeURIComponent(errorMsg))}</div>` : ''}
    `

    const rows = usuarios.results.map((u: any) => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:34px;height:34px;border-radius:50%;background:${rolColor(u.rol)};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:${rolTextColor(u.rol)};">
              ${u.nombre.charAt(0)}
            </div>
            <div>
              <div style="font-weight:700;">${esc(u.nombre)}</div>
              <div style="font-size:12px;color:#6b7280;">${esc(u.email)}</div>
            </div>
          </div>
        </td>
        <td><span class="badge" style="background:${rolColor(u.rol)};color:${rolTextColor(u.rol)};font-size:11px;padding:3px 10px;border-radius:20px;font-weight:700;">${rolLabel(u.rol)}</span></td>
        <td>
          <span style="font-size:12px;font-weight:600;color:${u.activo?'#059669':'#dc2626'};">
            ${u.activo?'✓ Activo':'✗ Inactivo'}
          </span>
        </td>
        <td style="font-size:12px;color:#9ca3af;">${u.created_at?.split('T')[0]||''}</td>
        <td>
          <button onclick="resetPassword(${u.id}, '${esc(u.nombre)}')" class="btn btn-outline btn-sm" title="Cambiar contraseña">
            <i class="fas fa-key"></i>
          </button>
          ${canManageUsers(user.rol) ? `
            <button onclick="abrirEditarUsuario(${u.id}, '${esc(u.nombre)}', '${esc(u.email)}', '${esc(u.rol)}')"
              class="btn btn-sm" style="background:#f3e8ff;color:#7B3FA0;border:1px solid #d8b4fe;" title="Editar nombre y rol">
              <i class="fas fa-edit"></i>
            </button>
          ` : ''}
          ${u.id != user.id ? `
            <button onclick="toggleUsuario(${u.id}, ${u.activo})" class="btn btn-sm ${u.activo?'btn-danger':'btn-success'}" title="${u.activo?'Desactivar':'Activar'}">
              <i class="fas fa-${u.activo?'ban':'check'}"></i>
            </button>
            ${canManageUsers(user.rol) && !(filesMap[u.id] > 0) ? `
              <form method="POST" action="/usuarios/${u.id}/eliminar" style="display:inline;" onsubmit="return confirm('¿Eliminar usuario ${esc(u.nombre)}? Esta acción no se puede deshacer.')">
                <button type="submit" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;" title="Eliminar usuario">
                  <i class="fas fa-trash"></i>
                </button>
              </form>
            ` : ''}
          ` : ''}
        </td>
      </tr>
    `).join('')

    const content = `
      ${alertas}
      <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
        <div></div>
        ${canManageUsers(user.rol) ? `
        <button onclick="document.getElementById('modal-usuario').classList.add('active')" class="btn btn-orange">
          <i class="fas fa-user-plus"></i> Nuevo Usuario
        </button>` : `<div style="font-size:13px;color:#6b7280;padding:8px;"><i class="fas fa-info-circle"></i> Solo el gerente puede crear nuevos usuarios.</div>`}
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fas fa-user-cog" style="color:#7B3FA0"></i> Usuarios del Sistema</span></div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Creado</th><th>Acciones</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <!-- Modal nuevo usuario -->
      <div class="modal-overlay" id="modal-usuario">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-user-plus" style="color:#F7941D"></i> Nuevo Usuario</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-usuario').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" action="/usuarios" id="form-nuevo-usuario" onsubmit="return validarFormUsuario('pass-nuevo','meter-nuevo','err-nuevo')">
              <div class="form-group">
                <label class="form-label">NOMBRE COMPLETO *</label>
                <input type="text" name="nombre" required class="form-control" placeholder="Ej: María González" maxlength="100">
              </div>
              <div class="form-group">
                <label class="form-label">EMAIL *</label>
                <input type="email" name="email" required class="form-control" placeholder="maria@drviaje.com" maxlength="200">
              </div>
              <div class="form-group">
                <label class="form-label">CONTRASEÑA *</label>
                <div style="position:relative;">
                  <input type="password" name="password" id="pass-nuevo" required class="form-control"
                    placeholder="Mínimo 10 caracteres" autocomplete="new-password"
                    oninput="actualizarMedidor(this,'meter-nuevo','req-nuevo')">
                  <button type="button" onclick="toggleVerPass('pass-nuevo',this)" tabindex="-1"
                    style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#9ca3af;">
                    <i class="fas fa-eye"></i>
                  </button>
                </div>
                <!-- Medidor de fortaleza -->
                <div style="margin-top:8px;">
                  <div style="height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;">
                    <div id="meter-nuevo" style="height:100%;width:0%;border-radius:3px;transition:all 0.3s;"></div>
                  </div>
                  <div id="req-nuevo" style="margin-top:8px;font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:3px;"></div>
                  <div id="err-nuevo" style="color:#dc2626;font-size:12px;margin-top:4px;display:none;"></div>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">ROL *</label>
                <select name="rol" required class="form-control">
                  <option value="vendedor">🧑‍💼 Vendedor — Ve y gestiona solo sus propios files</option>
                  <option value="supervisor">👁 Supervisor — Ve todos los files y puede cerrar a pérdidas</option>
                  <option value="administracion">🔧 Administración — Ve y modifica ventas + admin, puede reabrir files</option>
                  <option value="gerente">⭐ Gerente — Acceso completo, gestión de usuarios</option>
                  <option value="observador">👁️ Observador — Ve absolutamente todo, sin poder modificar nada</option>
                </select>
              </div>
              <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:16px;font-size:12px;">
                <strong>Vendedor:</strong> Sus propios files y clientes. Sin tesorería ni admin.<br>
                <strong>Supervisor:</strong> Ve todos los files, puede autorizar cierres a pérdida. Sin tesorería.<br>
                <strong>Administración:</strong> Ventas + admin + tesorería. Puede reabrir files cerrados. No crea usuarios.<br>
                <strong>Gerente:</strong> Acceso total + gestión de usuarios (único rol que puede crear usuarios).
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;"><i class="fas fa-save"></i> Crear Usuario</button>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal reset password -->
      <div class="modal-overlay" id="modal-reset">
        <div class="modal" style="max-width:420px;">
          <div class="modal-header">
            <span class="modal-title" id="reset-title"><i class="fas fa-key" style="color:#F7941D"></i> Cambiar Contraseña</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-reset').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" id="form-reset" onsubmit="return validarFormUsuario('pass-reset','meter-reset','err-reset')">
              <div class="form-group">
                <label class="form-label">NUEVA CONTRASEÑA *</label>
                <div style="position:relative;">
                  <input type="password" name="password" id="pass-reset" required class="form-control"
                    placeholder="Mínimo 10 caracteres" autocomplete="new-password"
                    oninput="actualizarMedidor(this,'meter-reset','req-reset')">
                  <button type="button" onclick="toggleVerPass('pass-reset',this)" tabindex="-1"
                    style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#9ca3af;">
                    <i class="fas fa-eye"></i>
                  </button>
                </div>
                <div style="margin-top:8px;">
                  <div style="height:6px;border-radius:3px;background:#e5e7eb;overflow:hidden;">
                    <div id="meter-reset" style="height:100%;width:0%;border-radius:3px;transition:all 0.3s;"></div>
                  </div>
                  <div id="req-reset" style="margin-top:8px;font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:3px;"></div>
                  <div id="err-reset" style="color:#dc2626;font-size:12px;margin-top:4px;display:none;"></div>
                </div>
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;"><i class="fas fa-key"></i> Cambiar Contraseña</button>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal editar usuario (nombre + rol) -->
      <div class="modal-overlay" id="modal-editar-usuario">
        <div class="modal" style="max-width:460px;">
          <div class="modal-header">
            <span class="modal-title"><i class="fas fa-user-edit" style="color:#7B3FA0"></i> Editar Usuario</span>
            <button type="button" class="modal-close" onclick="document.getElementById('modal-editar-usuario').classList.remove('active')">&times;</button>
          </div>
          <div class="modal-body">
            <form method="POST" id="form-editar-usuario">
              <input type="hidden" name="accion" value="editar">
              <div class="form-group">
                <label class="form-label">NOMBRE COMPLETO *</label>
                <input type="text" name="nombre" id="edit-nombre" required class="form-control" placeholder="Nombre del usuario">
              </div>
              <div class="form-group">
                <label class="form-label">EMAIL</label>
                <input type="text" id="edit-email-display" disabled class="form-control" style="background:#f3f4f6;color:#6b7280;" placeholder="No se puede modificar el email">
              </div>
              <div class="form-group">
                <label class="form-label">ROL *</label>
                <select name="rol" id="edit-rol" required class="form-control">
                  <option value="vendedor">🧑‍💼 Vendedor — Ve y gestiona solo sus propios files</option>
                  <option value="supervisor">👁 Supervisor — Ve todos los files y puede cerrar a pérdidas</option>
                  <option value="administracion">🔧 Administración — Ve y modifica ventas + admin</option>
                  <option value="gerente">⭐ Gerente — Acceso completo, gestión de usuarios</option>
                  <option value="observador">👁️ Observador — Ve absolutamente todo, sin poder modificar nada</option>
                </select>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px;">
                  <i class="fas fa-info-circle"></i> El cambio de rol tiene efecto inmediato al próximo login del usuario.
                </div>
              </div>
              <div style="display:flex;gap:10px;margin-top:20px;">
                <button type="submit" class="btn btn-primary" style="flex:1;"><i class="fas fa-save"></i> Guardar Cambios</button>
                <button type="button" class="btn btn-outline" onclick="document.getElementById('modal-editar-usuario').classList.remove('active')">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <script>
        // ── Reglas de contraseña ────────────────────────────────
        const REGLAS = [
          { id: 'len',     label: '10+ caracteres',       test: p => p.length >= 10 },
          { id: 'upper',   label: '1 mayúscula (A-Z)',    test: p => /[A-Z]/.test(p) },
          { id: 'lower',   label: '1 minúscula (a-z)',    test: p => /[a-z]/.test(p) },
          { id: 'num',     label: '1 número (0-9)',        test: p => /[0-9]/.test(p) },
          { id: 'special', label: '1 especial (!@#$...)', test: p => /[^A-Za-z0-9]/.test(p) },
        ]

        function evaluarPassword(p) {
          return REGLAS.map(r => ({ ...r, ok: r.test(p) }))
        }

        function actualizarMedidor(input, meterId, reqId) {
          const p       = input.value
          const checks  = evaluarPassword(p)
          const score   = checks.filter(r => r.ok).length
          const colores = ['#e5e7eb','#ef4444','#f59e0b','#eab308','#22c55e','#059669']
          const etiq    = ['','Muy débil','Débil','Regular','Buena','Excelente']
          const meter   = document.getElementById(meterId)
          const reqDiv  = document.getElementById(reqId)
          if (meter) {
            meter.style.width  = (score * 20) + '%'
            meter.style.background = colores[score]
            meter.title = etiq[score] || ''
          }
          if (reqDiv) {
            reqDiv.innerHTML = checks.map(r =>
              '<span style="display:flex;align-items:center;gap:4px;color:' + (r.ok ? '#059669' : '#9ca3af') + ';">'
              + '<i class="fas fa-' + (r.ok ? 'check-circle' : 'circle') + '" style="font-size:10px;"></i>'
              + r.label + '</span>'
            ).join('')
          }
        }

        function validarFormUsuario(passId, meterId, errId) {
          const p      = document.getElementById(passId)?.value || ''
          const checks = evaluarPassword(p)
          const errDiv = document.getElementById(errId)
          const fallidas = checks.filter(r => !r.ok)
          if (fallidas.length > 0) {
            if (errDiv) {
              errDiv.style.display = 'block'
              errDiv.textContent   = '⚠️ La contraseña no cumple: ' + fallidas.map(r => r.label).join(', ')
            }
            return false
          }
          if (errDiv) errDiv.style.display = 'none'
          return true
        }

        function toggleVerPass(inputId, btn) {
          const input = document.getElementById(inputId)
          if (!input) return
          const visible = input.type === 'text'
          input.type  = visible ? 'password' : 'text'
          btn.innerHTML = visible ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>'
        }

        function abrirEditarUsuario(id, nombre, email, rol) {
          document.getElementById('edit-nombre').value = nombre
          document.getElementById('edit-email-display').value = email
          document.getElementById('edit-rol').value = rol
          document.getElementById('form-editar-usuario').action = '/usuarios/' + id + '/editar'
          document.getElementById('modal-editar-usuario').classList.add('active')
        }

        function resetPassword(id, nombre) {
          document.getElementById('reset-title').innerHTML = '<i class="fas fa-key" style="color:#F7941D"></i> Cambiar contraseña: ' + nombre
          document.getElementById('form-reset').action = '/usuarios/' + id + '/password'
          // Limpiar estado anterior
          const p = document.getElementById('pass-reset')
          if (p) { p.value = ''; actualizarMedidor(p,'meter-reset','req-reset') }
          document.getElementById('modal-reset').classList.add('active')
        }

        async function toggleUsuario(id, activo) {
          const msg = activo ? '¿Desactivar este usuario?' : '¿Activar este usuario?'
          if(!confirm(msg)) return
          const r = await fetch('/usuarios/' + id + '/toggle', {method:'POST'})
          if(r.ok) location.reload()
        }
      </script>
    `
    return c.html(baseLayout('Usuarios', content, user, 'usuarios'))
  } catch (e: any) {
    return c.html(baseLayout('Usuarios', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'usuarios'))
  }
})

// ── Validador de fortaleza de contraseña (server-side) ─────────
// Mínimo 10 caracteres, 1 mayúscula, 1 minúscula, 1 número, 1 especial
function validarPassword(p: string): { ok: boolean; error: string } {
  if (!p || p.length < 10)          return { ok: false, error: 'La contraseña debe tener al menos 10 caracteres' }
  if (!/[A-Z]/.test(p))             return { ok: false, error: 'La contraseña debe contener al menos una mayúscula' }
  if (!/[a-z]/.test(p))             return { ok: false, error: 'La contraseña debe contener al menos una minúscula' }
  if (!/[0-9]/.test(p))             return { ok: false, error: 'La contraseña debe contener al menos un número' }
  if (!/[^A-Za-z0-9]/.test(p))      return { ok: false, error: 'La contraseña debe contener al menos un carácter especial (!@#$...)' }
  if (p.length > 200)               return { ok: false, error: 'La contraseña no puede superar los 200 caracteres' }
  return { ok: true, error: '' }
}

admin.post('/usuarios', async (c) => {
  const user = await getUser(c)
  // Solo el gerente puede crear usuarios
  if (!user || !canManageUsers(user.rol)) return c.redirect('/usuarios')
  const b = await c.req.parseBody()
  try {
    const password = String(b.password || '')
    const pCheck = validarPassword(password)
    if (!pCheck.ok) return c.redirect(`/usuarios?error=${encodeURIComponent(pCheck.error)}`)

    const nombre = String(b.nombre || '').trim().substring(0, 100)
    const email  = String(b.email  || '').trim().toLowerCase().substring(0, 200)
    const rolesValidos = ['vendedor', 'supervisor', 'administracion', 'gerente']
    const rol    = rolesValidos.includes(String(b.rol)) ? String(b.rol) : 'vendedor'
    if (!nombre || !email) return c.redirect('/usuarios?error=datos_incompletos')

    const hash = await hashPassword(password)
    // El constraint solo acepta 'gerente' y 'vendedor'.
    // Para roles extendidos (supervisor, administracion) guardamos 'vendedor' en rol
    // y el valor real en rol_extendido. El login usa COALESCE(rol_extendido, rol).
    const rolParaBD = (rol === 'gerente') ? 'gerente' : 'vendedor'
    await c.env.DB.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol, rol_extendido) VALUES (?,?,?,?,?)`)
      .bind(nombre, email, hash, rolParaBD, rol).run()
    return c.redirect('/usuarios?ok=usuario_creado')
  } catch (e: any) {
    const msg = String(e?.message || '')
    if (msg.includes('UNIQUE') || msg.includes('unique') || msg.includes('duplicate')) {
      return c.redirect('/usuarios?error=email_duplicado')
    }
    return c.redirect(`/usuarios?error=${encodeURIComponent('Error al crear usuario: ' + msg.substring(0, 120))}`)
  }
})

// ── Editar nombre y rol de usuario ───────────────────────────
admin.post('/usuarios/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user || !canManageUsers(user.rol)) return c.redirect('/usuarios?error=sin_permiso')
  const id = Number(c.req.param('id'))
  const body = await c.req.parseBody()
  const nombre = String(body.nombre || '').trim()
  const rolNuevo = String(body.rol || '').trim()

  const ROLES_PERMITIDOS = ['vendedor', 'supervisor', 'administracion', 'gerente', 'observador']
  if (!nombre) return c.redirect('/usuarios?error=nombre_requerido')
  if (!ROLES_PERMITIDOS.includes(rolNuevo)) return c.redirect('/usuarios?error=rol_invalido')

  // No puede cambiarse a sí mismo a un rol inferior sin perder acceso
  if (String(id) === String(user.id) && rolNuevo !== 'gerente') {
    return c.redirect('/usuarios?error=no_self_downgrade')
  }

  try {
    // rol_extendido guarda el valor real; rol mantiene compatibilidad con constraint
    const rolBase = ['vendedor','gerente'].includes(rolNuevo) ? rolNuevo : 'gerente'
    await c.env.DB.prepare(
      `UPDATE usuarios SET nombre = ?, rol = ?, rol_extendido = ? WHERE id = ?`
    ).bind(nombre, rolBase, rolNuevo, id).run()
    return c.redirect('/usuarios?ok=usuario_editado')
  } catch (e: any) {
    return c.redirect(`/usuarios?error=${encodeURIComponent('Error al editar: ' + e.message.substring(0,100))}`)
  }
})

admin.post('/usuarios/:id/password', async (c) => {
  const user = await getUser(c)
  // Solo gerente puede resetear contraseña de otros; cualquier usuario puede cambiar la suya
  const targetId = c.req.param('id')
  if (!user || (!canManageUsers(user.rol) && String(user.id) !== targetId)) return c.redirect('/usuarios')
  const id = c.req.param('id')
  const b  = await c.req.parseBody()
  const password = String(b.password || '')
  const pCheck = validarPassword(password)
  if (!pCheck.ok) return c.redirect(`/usuarios?error=${encodeURIComponent(pCheck.error)}`)
  const hash = await hashPassword(password)
  await c.env.DB.prepare('UPDATE usuarios SET password_hash=? WHERE id=?').bind(hash, id).run()
  return c.redirect('/usuarios?ok=password_cambiado')
})

admin.post('/usuarios/:id/toggle', async (c) => {
  const user = await getUser(c)
  if (!user || !canManageUsers(user.rol)) return c.json({ error: 'No autorizado' }, 403)
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE usuarios SET activo = CASE WHEN activo=1 THEN 0 ELSE 1 END WHERE id=?').bind(id).run()
  return c.json({ ok: true })
})

admin.post('/usuarios/:id/eliminar', async (c) => {
  const user = await getUser(c)
  // Solo gerente puede eliminar usuarios
  if (!user || !canManageUsers(user.rol)) return c.redirect('/usuarios')
  const id = c.req.param('id')
  // No permitir auto-eliminación
  if (String(id) === String(user.id)) return c.redirect('/usuarios?error=no_self_delete')
  // Verificar que no tenga files asociados
  const hasFiles = await c.env.DB.prepare('SELECT COUNT(*) as n FROM files WHERE vendedor_id=?').bind(id).first() as any
  if (hasFiles && hasFiles.n > 0) return c.redirect('/usuarios?error=tiene_files')
  await c.env.DB.prepare('DELETE FROM usuarios WHERE id=?').bind(id).run()
  return c.redirect('/usuarios?ok=usuario_eliminado')
})

// ===================== PROVEEDORES =====================
admin.get('/proveedores', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/dashboard')

  const errorMsg = c.req.query('error') || ''
  const okMsg    = c.req.query('ok')    || ''

  try {
    const proveedores = await c.env.DB.prepare('SELECT * FROM proveedores ORDER BY nombre').all()
    const operadores  = await c.env.DB.prepare('SELECT * FROM operadores ORDER BY nombre').all()
    const rowsProv = proveedores.results.map((p: any) => `
      <tr id="prov-row-${p.id}">
        <td style="font-weight:600;font-size:13px;">${esc(p.nombre)}</td>
        <td style="font-size:12px;color:#6b7280;">${esc(p.razon_social)||'—'}</td>
        <td style="font-size:12px;">${p.nro_rut ? `<span style="background:#ede9fe;color:#5b21b6;padding:1px 7px;border-radius:8px;font-weight:600;font-size:11px;">${esc(p.nro_rut)}</span>` : '—'}</td>
        <td style="font-size:12px;">${esc(p.telefono)||'—'}</td>
        <td><span style="font-size:12px;font-weight:600;color:${p.activo?'#059669':'#dc2626'};">${p.activo?'✓ Activo':'✗ Inactivo'}</span></td>
        <td>
          <div style="display:flex;gap:4px;">
            <a href="/proveedores/${p.id}/editar" class="btn btn-sm btn-outline" title="Editar"><i class="fas fa-edit"></i></a>
            <form method="POST" action="/proveedores/${p.id}/toggle" style="display:inline;margin:0;">
              <button type="submit" class="btn btn-sm ${p.activo?'btn-danger':'btn-success'}" title="${p.activo?'Desactivar':'Activar'}"><i class="fas fa-${p.activo?'ban':'check'}"></i></button>
            </form>
            <form method="POST" action="/proveedores/${p.id}/eliminar" style="display:inline;margin:0;" onsubmit="return confirm('¿Eliminar definitivamente el proveedor ${esc(p.nombre||'')}? Solo es posible si no tiene registros asociados.')">
              <button type="submit" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;" title="Eliminar"><i class="fas fa-trash"></i></button>
            </form>
          </div>
        </td>
      </tr>`).join('')

    const rowsOper = operadores.results.map((o: any) => `
      <tr id="oper-row-${o.id}">
        <td><strong>${esc(o.nombre)}</strong></td>
        <td style="font-size:12px;">${esc(o.tipo)||'—'}</td>
        <td style="font-size:12px;">${esc(o.email)||'—'}</td>
        <td style="font-size:12px;">${esc(o.telefono)||'—'}</td>
        <td><span style="font-size:12px;font-weight:600;color:${o.activo?'#059669':'#dc2626'};">${o.activo?'✓ Activo':'✗ Inactivo'}</span></td>
        <td>
          <div style="display:flex;gap:4px;">
            <a href="/operadores/${o.id}/editar" class="btn btn-sm btn-outline" title="Editar"><i class="fas fa-edit"></i></a>
            <form method="POST" action="/operadores/${o.id}/toggle" style="display:inline;margin:0;">
              <button type="submit" class="btn btn-sm ${o.activo?'btn-danger':'btn-success'}" title="${o.activo?'Desactivar':'Activar'}"><i class="fas fa-${o.activo?'ban':'check'}"></i></button>
            </form>
            <form method="POST" action="/operadores/${o.id}/eliminar" style="display:inline;margin:0;" onsubmit="return confirm('¿Eliminar definitivamente el operador ${esc(o.nombre||'')}? Solo es posible si no tiene registros asociados.')">
              <button type="submit" class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;" title="Eliminar"><i class="fas fa-trash"></i></button>
            </form>
          </div>
        </td>
      </tr>`).join('')

    const content = `
      ${errorMsg ? `<div class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> ${esc(decodeURIComponent(errorMsg))}</div>` : ''}
      ${okMsg    ? `<div class="alert alert-success" style="margin-bottom:16px;"><i class="fas fa-check-circle"></i> ${esc(decodeURIComponent(okMsg))}</div>` : ''}
      <!-- Proveedores -->
      <div style="margin-bottom:28px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:15px;font-weight:700;color:#5a2d75;margin:0;"><i class="fas fa-building" style="color:#F7941D"></i> Proveedores</h3>
          <button type="button" onclick="document.getElementById('modal-prov').style.display='flex'" class="btn btn-orange btn-sm"><i class="fas fa-plus"></i> Nuevo</button>
        </div>
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Nombre</th><th>Razón Social</th><th>RUT</th><th>Tel.</th><th>Estado</th><th></th></tr></thead>
              <tbody>${rowsProv||'<tr><td colspan="6" style="text-align:center;padding:20px;color:#9ca3af;">Sin proveedores</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Operadores -->
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:15px;font-weight:700;color:#5a2d75;margin:0;"><i class="fas fa-plane" style="color:#7B3FA0"></i> Operadores / Prestadores</h3>
          <button type="button" onclick="document.getElementById('modal-oper').style.display='flex'" class="btn btn-primary btn-sm"><i class="fas fa-plus"></i> Nuevo</button>
        </div>
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Nombre</th><th>Tipo</th><th>Email</th><th>Tel.</th><th>Estado</th><th></th></tr></thead>
              <tbody>${rowsOper||'<tr><td colspan="6" style="text-align:center;padding:20px;color:#9ca3af;">Sin operadores</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Modal Proveedor -->
      <div id="modal-prov" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:white;border-radius:16px;width:90%;max-width:520px;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #ede5f5;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:17px;font-weight:700;color:#5a2d75;" id="modal-prov-titulo">Nuevo Proveedor</span>
            <a href="/proveedores" style="background:none;border:none;cursor:pointer;font-size:24px;color:#6b7280;line-height:1;padding:0 4px;text-decoration:none;">&times;</a>
          </div>
          <div style="padding:24px;">
            <form method="POST" action="/proveedores" id="form-prov">
              <input type="hidden" name="_prov_id" id="prov-edit-id" value="">
              <div class="form-group">
                <label class="form-label">NOMBRE COMERCIAL *</label>
                <input type="text" name="nombre" id="prov-nombre" required class="form-control" placeholder="Ej: Abtour, Sevens">
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">RAZÓN SOCIAL</label>
                  <input type="text" name="razon_social" id="prov-razon-social" class="form-control" placeholder="Ej: Abtour S.A.">
                </div>
                <div class="form-group">
                  <label class="form-label">NRO. RUT</label>
                  <input type="text" name="nro_rut" id="prov-nro-rut" class="form-control" placeholder="Ej: 21234567-8">
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">EMAIL</label>
                  <input type="email" name="email" id="prov-email" class="form-control">
                </div>
                <div class="form-group">
                  <label class="form-label">TELÉFONO</label>
                  <input type="text" name="telefono" id="prov-telefono" class="form-control">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">CONTACTO COMERCIAL</label>
                <input type="text" name="contacto" id="prov-contacto" class="form-control">
              </div>
              <div class="form-group">
                <label class="form-label">NOTAS</label>
                <textarea name="notas" id="prov-notas" rows="2" class="form-control"></textarea>
              </div>
              <div style="display:flex;gap:10px;margin-top:8px;">
                <a href="/proveedores" class="btn btn-outline" style="flex:1;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;">Cancelar</a>
                <button type="submit" id="prov-btn-submit" class="btn btn-primary" style="flex:2;">Crear Proveedor</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Modal Operador -->
      <div id="modal-oper" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:white;border-radius:16px;width:90%;max-width:480px;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="padding:20px 24px 16px;border-bottom:1px solid #ede5f5;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:17px;font-weight:700;color:#5a2d75;" id="modal-oper-titulo">Nuevo Operador / Prestador</span>
<a href="/proveedores" style="background:none;border:none;cursor:pointer;font-size:24px;color:#6b7280;line-height:1;padding:0 4px;text-decoration:none;">&times;</a>
          </div>
          <div style="padding:24px;">
            <form method="POST" action="/operadores" id="form-oper">
              <input type="hidden" name="_oper_id" id="oper-edit-id" value="">
              <div class="form-group">
                <label class="form-label">NOMBRE *</label>
                <input type="text" name="nombre" id="oper-nombre" required class="form-control" placeholder="Ej: LATAM, Grand Palladium">
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">TIPO</label>
                  <select name="tipo" id="oper-tipo" class="form-control">
                    <option value="">— Seleccionar tipo —</option>
                    <option value="Aerolínea">Aerolínea</option>
                    <option value="Hotel">Hotel</option>
                    <option value="Online">Online</option>
                    <option value="Otro">Otro</option>
                    <option value="Rentadora de Autos">Rentadora de Autos</option>
                    <option value="Seguro">Seguro</option>
                    <option value="Tour Operador">Tour Operador</option>
                    <option value="Traslado">Traslado</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">TELÉFONO</label>
                  <input type="text" name="telefono" id="oper-telefono" class="form-control">
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">EMAIL</label>
                <input type="email" name="email" id="oper-email" class="form-control">
              </div>
              <div style="display:flex;gap:10px;margin-top:8px;">
                <a href="/proveedores" class="btn btn-outline" style="flex:1;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;">Cancelar</a>
                <button type="submit" id="oper-btn-submit" class="btn btn-primary" style="flex:2;">Crear Operador</button>
              </div>
            </form>
          </div>
        </div>
      </div>


    `
    return c.html(baseLayout('Proveedores y Operadores', content, user, 'proveedores'))
  } catch (e: any) {
    return c.html(baseLayout('Proveedores', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'proveedores'))
  }
})

admin.post('/proveedores', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const b = await c.req.parseBody()
  await c.env.DB.prepare(
    'INSERT INTO proveedores (nombre, razon_social, nro_rut, email, telefono, contacto, notas) VALUES (?,?,?,?,?,?,?)'
  ).bind(b.nombre, b.razon_social||null, b.nro_rut||null, b.email||null, b.telefono||null, b.contacto||null, b.notas||null).run()
  return c.redirect('/proveedores')
})

admin.post('/proveedores/:id/toggle', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE proveedores SET activo = CASE WHEN activo=1 THEN 0 ELSE 1 END WHERE id=?').bind(id).run()
  return c.redirect('/proveedores')
})

admin.post('/operadores', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const b = await c.req.parseBody()
  await c.env.DB.prepare('INSERT INTO operadores (nombre, tipo, email, telefono) VALUES (?,?,?,?)').bind(b.nombre, b.tipo||null, b.email||null, b.telefono||null).run()
  return c.redirect('/proveedores')
})

admin.post('/operadores/:id/toggle', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE operadores SET activo = CASE WHEN activo=1 THEN 0 ELSE 1 END WHERE id=?').bind(id).run()
  return c.redirect('/proveedores')
})

// Página editar proveedor
admin.get('/proveedores/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  const p = await c.env.DB.prepare('SELECT * FROM proveedores WHERE id=?').bind(id).first() as any
  if (!p) return c.redirect('/proveedores')
  const content = `
    <div style="max-width:560px;margin:0 auto;">
      <div style="margin-bottom:16px;">
        <a href="/proveedores" style="color:#7B3FA0;font-size:14px;"><i class="fas fa-arrow-left"></i> Volver a Proveedores</a>
      </div>
      <div class="card">
        <div class="card-body" style="padding:28px;">
          <h2 style="font-size:18px;font-weight:700;color:#5a2d75;margin:0 0 24px;">Editar Proveedor</h2>
          <form method="POST" action="/proveedores/${id}/editar">
            <div class="form-group">
              <label class="form-label">NOMBRE COMERCIAL *</label>
              <input type="text" name="nombre" required class="form-control" value="${esc(p.nombre||'')}">
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">RAZÓN SOCIAL</label>
                <input type="text" name="razon_social" class="form-control" value="${esc(p.razon_social||'')}">
              </div>
              <div class="form-group">
                <label class="form-label">NRO. RUT</label>
                <input type="text" name="nro_rut" class="form-control" value="${esc(p.nro_rut||'')}">
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">EMAIL</label>
                <input type="email" name="email" class="form-control" value="${esc(p.email||'')}">
              </div>
              <div class="form-group">
                <label class="form-label">TELÉFONO</label>
                <input type="text" name="telefono" class="form-control" value="${esc(p.telefono||'')}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">CONTACTO COMERCIAL</label>
              <input type="text" name="contacto" class="form-control" value="${esc(p.contacto||'')}">
            </div>
            <div class="form-group">
              <label class="form-label">NOTAS</label>
              <textarea name="notas" rows="3" class="form-control">${esc(p.notas||'')}</textarea>
            </div>
            <div style="display:flex;gap:10px;margin-top:8px;">
              <a href="/proveedores" class="btn btn-outline" style="flex:1;text-align:center;">Cancelar</a>
              <button type="submit" class="btn btn-primary" style="flex:2;">Guardar cambios</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `
  return c.html(baseLayout('Editar Proveedor', content, user, 'proveedores'))
})

// POST editar proveedor
admin.post('/proveedores/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  const b  = await c.req.parseBody()
  await c.env.DB.prepare(
    'UPDATE proveedores SET nombre=?, razon_social=?, nro_rut=?, email=?, telefono=?, contacto=?, notas=? WHERE id=?'
  ).bind(b.nombre, b.razon_social||null, b.nro_rut||null, b.email||null, b.telefono||null, b.contacto||null, b.notas||null, id).run()
  return c.redirect('/proveedores')
})

// Eliminar proveedor (solo si no tiene registros)
admin.post('/proveedores/:id/eliminar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM servicios WHERE proveedor_id=?'
  ).bind(id).first() as any
  if (Number(count?.n) > 0) {
    return c.redirect(`/proveedores?error=El+proveedor+tiene+${count.n}+servicio(s)+asociado(s).+Desactivalo+en+lugar+de+eliminarlo.`)
  }
  const ccCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM proveedor_cuenta_corriente WHERE proveedor_id=?'
  ).bind(id).first() as any
  if (Number(ccCount?.n) > 0) {
    return c.redirect(`/proveedores?error=El+proveedor+tiene+${ccCount.n}+movimiento(s)+en+cuenta+corriente.+Desactivalo+en+lugar+de+eliminarlo.`)
  }
  await c.env.DB.prepare('DELETE FROM proveedores WHERE id=?').bind(id).run()
  return c.redirect('/proveedores?ok=Proveedor+eliminado')
})

// Página editar operador
admin.get('/operadores/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  const o = await c.env.DB.prepare('SELECT * FROM operadores WHERE id=?').bind(id).first() as any
  if (!o) return c.redirect('/proveedores')
  const content = `
    <div style="max-width:480px;margin:0 auto;">
      <div style="margin-bottom:16px;">
        <a href="/proveedores" style="color:#7B3FA0;font-size:14px;"><i class="fas fa-arrow-left"></i> Volver a Proveedores</a>
      </div>
      <div class="card">
        <div class="card-body" style="padding:28px;">
          <h2 style="font-size:18px;font-weight:700;color:#5a2d75;margin:0 0 24px;">Editar Operador / Prestador</h2>
          <form method="POST" action="/operadores/${id}/editar">
            <div class="form-group">
              <label class="form-label">NOMBRE *</label>
              <input type="text" name="nombre" required class="form-control" value="${esc(o.nombre||'')}">
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="form-label">TIPO</label>
                <select name="tipo" class="form-control">
                    <option value="">— Seleccionar tipo —</option>
                    <option value="Aerolínea" ${o.tipo==='Aerolínea'?'selected':''}>Aerolínea</option>
                    <option value="Hotel" ${o.tipo==='Hotel'?'selected':''}>Hotel</option>
                    <option value="Online" ${o.tipo==='Online'?'selected':''}>Online</option>
                    <option value="Otro" ${o.tipo==='Otro'?'selected':''}>Otro</option>
                    <option value="Rentadora de Autos" ${o.tipo==='Rentadora de Autos'?'selected':''}>Rentadora de Autos</option>
                    <option value="Seguro" ${o.tipo==='Seguro'?'selected':''}>Seguro</option>
                    <option value="Tour Operador" ${o.tipo==='Tour Operador'?'selected':''}>Tour Operador</option>
                    <option value="Traslado" ${o.tipo==='Traslado'?'selected':''}>Traslado</option>
                  </select>
              </div>
              <div class="form-group">
                <label class="form-label">TELÉFONO</label>
                <input type="text" name="telefono" class="form-control" value="${esc(o.telefono||'')}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">EMAIL</label>
              <input type="email" name="email" class="form-control" value="${esc(o.email||'')}">
            </div>
            <div style="display:flex;gap:10px;margin-top:8px;">
              <a href="/proveedores" class="btn btn-outline" style="flex:1;text-align:center;">Cancelar</a>
              <button type="submit" class="btn btn-primary" style="flex:2;">Guardar cambios</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `
  return c.html(baseLayout('Editar Operador', content, user, 'proveedores'))
})

// POST editar operador
admin.post('/operadores/:id/editar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  const b  = await c.req.parseBody()
  await c.env.DB.prepare(
    'UPDATE operadores SET nombre=?, tipo=?, email=?, telefono=? WHERE id=?'
  ).bind(b.nombre, b.tipo||null, b.email||null, b.telefono||null, id).run()
  return c.redirect('/proveedores')
})

// Eliminar operador (solo si no tiene registros)
admin.post('/operadores/:id/eliminar', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/proveedores')
  const id = c.req.param('id')
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) as n FROM servicios WHERE operador_id=?'
  ).bind(id).first() as any
  if (Number(count?.n) > 0) {
    return c.redirect(`/proveedores?error=El+operador+tiene+${count.n}+servicio(s)+asociado(s).+Desactivalo+en+lugar+de+eliminarlo.`)
  }
  await c.env.DB.prepare('DELETE FROM operadores WHERE id=?').bind(id).run()
  return c.redirect('/proveedores?ok=Operador+eliminado')
})

// ===================== COTIZACIONES =====================
admin.get('/cotizaciones', async (c) => {
  const user = await getUser(c)
  if (!user) return c.redirect('/login')

  try {
    const cotizaciones = await c.env.DB.prepare('SELECT * FROM cotizaciones ORDER BY fecha DESC LIMIT 60').all()
    const hoy = new Date().toISOString().split('T')[0]

    // Traer los 3 pares de hoy
    const cotHoyRows = await c.env.DB.prepare(
      `SELECT moneda_origen, moneda_destino, valor FROM cotizaciones WHERE fecha = ?`
    ).bind(hoy).all()
    const cotHoy: Record<string,number> = {}
    for (const r of cotHoyRows.results as any[]) cotHoy[`${r.moneda_origen}_${r.moneda_destino}`] = r.valor

    const hayTodos = cotHoy['USD_UYU'] && cotHoy['EUR_USD'] && cotHoy['EUR_UYU']

    const rows = cotizaciones.results.map((r: any) => `
      <tr>
        <td style="font-weight:700;">${r.fecha}</td>
        <td>
          <span style="font-weight:700;color:#7B3FA0;">${r.moneda_origen}</span>
          <i class="fas fa-arrow-right" style="font-size:10px;color:#9ca3af;margin:0 4px;"></i>
          <span style="font-weight:700;color:#059669;">${r.moneda_destino}</span>
        </td>
        <td><strong style="color:#1a1a2e;font-size:15px;">${Number(r.valor).toFixed(4)}</strong></td>
        <td style="font-size:12px;color:#9ca3af;">${r.created_at?.split('T')[0]||''}</td>
      </tr>
    `).join('')

    const content = `
      ${!hayTodos ? `
        <div class="alert alert-warning" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div><i class="fas fa-exclamation-triangle"></i> <strong>Faltan cotizaciones para hoy (${hoy}).</strong> Podés obtenerlas automáticamente.</div>
          ${isAdminOrAbove(user.rol) ? `
            <button onclick="obtenerAuto()" id="btn-auto" class="btn btn-sm" style="background:#F7941D;color:white;white-space:nowrap;">
              <i class="fas fa-sync-alt"></i> Obtener automáticamente
            </button>
          ` : ''}
        </div>
      ` : ''}

      <!-- Cards de cotización de hoy -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
        ${[
          { par:'USD_UYU', label:'USD → UYU', desc:'Pesos por dólar', icon:'fa-dollar-sign', color:'#059669' },
          { par:'EUR_USD', label:'EUR → USD', desc:'Dólares por euro', icon:'fa-euro-sign', color:'#7B3FA0' },
          { par:'EUR_UYU', label:'EUR → UYU', desc:'Pesos por euro',  icon:'fa-euro-sign', color:'#0369a1' },
        ].map(({ par, label, desc, icon, color }) => `
          <div class="card" style="text-align:center;">
            <div class="card-body" style="padding:16px;">
              <div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:1px;margin-bottom:4px;">${label}</div>
              <div id="cot-${par}" style="font-size:${cotHoy[par]?'32':'22'}px;font-weight:800;color:${cotHoy[par]?color:'#d1d5db'};">
                ${cotHoy[par] ? Number(cotHoy[par]).toFixed(4) : '—'}
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${desc}</div>
              <div style="font-size:10px;color:#9ca3af;">${hoy}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="grid-2" style="margin-bottom:24px;align-items:flex-start;">
        ${isAdminOrAbove(user.rol) ? `
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-sync-alt" style="color:#F7941D"></i> Actualización Automática</span>
          </div>
          <div class="card-body">
            <p style="font-size:13px;color:#6b7280;margin-bottom:14px;">
              Obtiene los tipos de cambio actualizados desde <strong>ExchangeRate-API</strong> (fuente internacional, actualización diaria gratuita) y guarda los 3 pares automáticamente.
            </p>
            <div id="auto-resultado" style="display:none;margin-bottom:12px;"></div>
            <button onclick="obtenerAuto()" id="btn-auto-main" class="btn btn-primary" style="width:100%;background:linear-gradient(135deg,#F7941D,#e67e22);">
              <i class="fas fa-cloud-download-alt"></i> Obtener cotizaciones de hoy
            </button>
            <div style="font-size:11px;color:#9ca3af;margin-top:8px;text-align:center;">
              <i class="fas fa-info-circle"></i> También podés ingresar un valor manual en el formulario de la derecha.
            </div>
          </div>
        </div>
        ` : '<div></div>'}

        ${isAdminOrAbove(user.rol) ? `
        <div class="card">
          <div class="card-header"><span class="card-title">Registrar Manualmente</span></div>
          <div class="card-body">
            <form method="POST" action="/cotizaciones">
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">FECHA</label>
                  <input type="date" name="fecha" value="${hoy}" required class="form-control">
                </div>
                <div class="form-group">
                  <label class="form-label">PAR DE MONEDAS</label>
                  <select name="par" class="form-control">
                    <option value="USD_UYU">USD → UYU</option>
                    <option value="EUR_USD">EUR → USD</option>
                    <option value="EUR_UYU">EUR → UYU</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">VALOR *</label>
                <input type="number" name="valor" required min="0" step="0.0001" class="form-control" placeholder="Ej: 43.5000">
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;"><i class="fas fa-save"></i> Guardar</button>
            </form>
          </div>
        </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Historial de Cotizaciones</span></div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Fecha</th><th>Par</th><th>Valor</th><th>Guardado</th></tr></thead>
            <tbody>
              ${rows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#9ca3af;">Sin cotizaciones</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <script>
        async function obtenerAuto() {
          const btns = [document.getElementById('btn-auto'), document.getElementById('btn-auto-main')]
          btns.forEach(b => { if(b) { b.disabled = true; b.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Consultando...' } })
          const resEl = document.getElementById('auto-resultado')

          try {
            const r = await fetch('/api/cotizaciones/auto', { method: 'POST' })
            const data = await r.json()
            if (!data.ok) throw new Error(data.error || 'Error desconocido')

            const { cotizaciones } = data
            // Actualizar cards en pantalla
            for (const [par, val] of Object.entries(cotizaciones)) {
              const el = document.getElementById('cot-' + par)
              if (el) { el.textContent = Number(val).toFixed(4); el.style.fontSize = '32px' }
            }
            if (resEl) {
              resEl.style.display = 'block'
              resEl.innerHTML = \`<div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:8px;padding:10px 14px;font-size:13px;color:#065f46;">
                <i class="fas fa-check-circle"></i> <strong>Cotizaciones actualizadas correctamente</strong><br>
                <span style="font-size:12px;">
                  USD→UYU: <strong>\${Number(cotizaciones.USD_UYU).toFixed(4)}</strong> &nbsp;|&nbsp;
                  EUR→USD: <strong>\${Number(cotizaciones.EUR_USD).toFixed(4)}</strong> &nbsp;|&nbsp;
                  EUR→UYU: <strong>\${Number(cotizaciones.EUR_UYU).toFixed(4)}</strong>
                </span>
              </div>\`
            }
            btns.forEach(b => { if(b) { b.disabled = false; b.innerHTML = '<i class="fas fa-check"></i> ¡Actualizadas!' } })
            setTimeout(() => btns.forEach(b => { if(b) { b.disabled = false; b.innerHTML = '<i class="fas fa-cloud-download-alt"></i> Obtener cotizaciones de hoy' }}), 3000)
          } catch(e) {
            if (resEl) {
              resEl.style.display = 'block'
              resEl.innerHTML = \`<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:13px;color:#dc2626;">
                <i class="fas fa-exclamation-circle"></i> Error al obtener cotizaciones: \${e.message}
              </div>\`
            }
            btns.forEach(b => { if(b) { b.disabled = false; b.innerHTML = '<i class="fas fa-sync-alt"></i> Reintentar' } })
          }
        }
      </script>
    `
    return c.html(baseLayout('Cotizaciones', content, user, 'cotizaciones'))
  } catch (e: any) {
    return c.html(baseLayout('Cotizaciones', `<div class="alert alert-danger">Error interno del servidor</div>`, user, 'cotizaciones'))
  }
})

admin.post('/cotizaciones', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.redirect('/cotizaciones')
  const b = await c.req.parseBody()
  const par = (b.par as string || 'USD_UYU').split('_')
  try {
    await c.env.DB.prepare(`INSERT OR REPLACE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES (?,?,?,?)`).bind(b.fecha, par[0], par[1], Number(b.valor)).run()
    return c.redirect('/cotizaciones')
  } catch (e: any) {
    return c.redirect('/cotizaciones')
  }
})

// ── Endpoint para ejecutar migración 0010 en producción ──────
// ===================== MIGRACIÓN 0011 =====================
admin.post('/run-migration-0011', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.json({ error: 'No autorizado' }, 403)
  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS liquidaciones (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        vendedor_id     INTEGER NOT NULL REFERENCES usuarios(id),
        periodo         TEXT    NOT NULL,
        fecha_liquidacion TEXT  NOT NULL,
        estado          TEXT    NOT NULL DEFAULT 'borrador'
                                CHECK(estado IN ('borrador','aprobada','pagada')),
        total_utilidad  REAL    NOT NULL DEFAULT 0,
        notas           TEXT,
        aprobado_por    INTEGER REFERENCES usuarios(id),
        aprobado_at     DATETIME,
        created_by      INTEGER NOT NULL REFERENCES usuarios(id),
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS liquidacion_files (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        liquidacion_id      INTEGER NOT NULL REFERENCES liquidaciones(id) ON DELETE CASCADE,
        file_id             INTEGER NOT NULL REFERENCES files(id),
        utilidad_anterior   REAL    NOT NULL DEFAULT 0,
        utilidad_base       REAL    NOT NULL,
        utilidad_delta      REAL    NOT NULL,
        file_numero         TEXT    NOT NULL,
        file_total_venta    REAL    NOT NULL DEFAULT 0,
        file_total_costo    REAL    NOT NULL DEFAULT 0,
        es_compartido       INTEGER NOT NULL DEFAULT 0,
        es_ajuste           INTEGER NOT NULL DEFAULT 0,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_liq_vendedor   ON liquidaciones(vendedor_id)`).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_liq_periodo    ON liquidaciones(periodo)`).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_liq_files_liq  ON liquidacion_files(liquidacion_id)`).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_liq_files_file ON liquidacion_files(file_id)`).run()
    return c.json({ ok: true, message: 'Migración 0011 aplicada correctamente (tablas de liquidaciones)' })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message })
  }
})

// ===================== MIGRACIÓN 0012 =====================
admin.post('/run-migration-0012', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.json({ error: 'No autorizado' }, 403)
  try {
    // Tabla cliente_tarjetas
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cliente_tarjetas (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id            INTEGER REFERENCES clientes(id),
        movimiento_id         INTEGER REFERENCES movimientos_caja(id),
        file_id               INTEGER REFERENCES files(id),
        ultimos_4             TEXT NOT NULL,
        banco_emisor          TEXT,
        monto                 REAL NOT NULL,
        moneda                TEXT NOT NULL DEFAULT 'USD',
        fecha_cargo           TEXT NOT NULL DEFAULT (date('now')),
        estado                TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','autorizada','rechazada')),
        fecha_autorizacion    TEXT,
        autorizado_por_usuario INTEGER REFERENCES usuarios(id),
        notas                 TEXT,
        concepto              TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_cli_tc_cliente ON cliente_tarjetas(cliente_id)`).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_cli_tc_file    ON cliente_tarjetas(file_id)`).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_cli_tc_estado  ON cliente_tarjetas(estado)`).run()
    // Columnas adicionales en proveedor_tarjetas (ignorar si ya existen)
    try { await c.env.DB.prepare(`ALTER TABLE proveedor_tarjetas ADD COLUMN file_id    INTEGER REFERENCES files(id)`).run() } catch {}
    try { await c.env.DB.prepare(`ALTER TABLE proveedor_tarjetas ADD COLUMN concepto   TEXT`).run() } catch {}
    try { await c.env.DB.prepare(`ALTER TABLE proveedor_tarjetas ADD COLUMN servicios_ids TEXT`).run() } catch {}
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_prov_tc_file   ON proveedor_tarjetas(file_id)`).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_prov_tc_estado ON proveedor_tarjetas(estado)`).run()
    return c.json({ ok: true, message: 'Migración 0012 aplicada correctamente' })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message })
  }
})

// ===================== MIGRACIÓN 0010 =====================
admin.post('/run-migration-0010', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.json({ error: 'No autorizado' }, 403)
  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS file_compartido (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id          INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        vendedor_id      INTEGER NOT NULL REFERENCES usuarios(id),
        porcentaje       REAL    NOT NULL DEFAULT 50.0,
        compartido_por   INTEGER NOT NULL REFERENCES usuarios(id),
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(file_id)
      )
    `).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_file_compartido_file     ON file_compartido(file_id)`).run()
    await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_file_compartido_vendedor ON file_compartido(vendedor_id)`).run()
    return c.json({ ok: true, message: 'Migración 0010 aplicada correctamente' })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message })
  }
})

// ===================== MIGRACIÓN 0017: TIPO CLIENTE EMPRESA =====================
admin.post('/run-migration-0017', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.json({ error: 'No autorizado' }, 403)
  const db = c.env.DB
  const results: string[] = []
  const stmts = [
    `ALTER TABLE clientes ADD COLUMN tipo_cliente TEXT NOT NULL DEFAULT 'persona_fisica'`,
    `ALTER TABLE clientes ADD COLUMN razon_social TEXT`,
    `ALTER TABLE clientes ADD COLUMN persona_contacto TEXT`,
  ]
  for (const sql of stmts) {
    try {
      await db.prepare(sql).run()
      results.push(`✅ OK: ${sql.substring(0, 60)}`)
    } catch (e: any) {
      if (e.message?.includes('duplicate column')) {
        results.push(`⏭ Ya existía: ${sql.substring(0, 60)}`)
      } else {
        results.push(`❌ Error: ${e.message}`)
      }
    }
  }
  return c.json({ ok: true, results })
})

// ===================== MIGRACIÓN: FIX CONSTRAINT ROL =====================
admin.get('/run-migration-0016', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.redirect('/login')
  return c.html(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>Migración 0016 — Dr. Viaje</title>
  <script src="https://cdn.tailwindcss.com"></script></head>
  <body class="bg-gray-100 flex items-center justify-center min-h-screen">
  <div class="bg-white rounded-xl shadow-lg p-8 max-w-lg w-full text-center">
    <h1 class="text-2xl font-bold text-gray-800 mb-4">🔧 Migración 0016</h1>
    <p class="text-gray-600 mb-4">Agrega la columna <code class="bg-gray-100 px-1 rounded">rol_extendido</code> a la tabla usuarios para soportar los roles <strong>supervisor</strong> y <strong>administracion</strong> sin modificar el constraint existente.</p>
    <p class="text-amber-600 text-sm mb-6">Un solo paso, no destructivo, preserva todos los datos.</p>
    <button onclick="ejecutar()" id="btn"
      class="bg-purple-700 hover:bg-purple-800 text-white font-bold py-3 px-8 rounded-lg">
      ▶ Ejecutar Migración
    </button>
    <div id="res" class="mt-4 text-sm hidden"></div>
    <br><a href="/usuarios" class="mt-4 inline-block text-gray-500 hover:text-gray-700 text-sm">← Volver a Usuarios</a>
  </div>
  <script>
    async function ejecutar() {
      const btn = document.getElementById('btn')
      btn.disabled = true; btn.textContent = '⏳ Ejecutando...'
      const res = document.getElementById('res')
      try {
        const r = await fetch('/run-migration-0016', { method: 'POST' })
        const data = await r.json()
        res.classList.remove('hidden')
        if (data.ok) {
          res.className = 'mt-4 text-sm text-green-700 bg-green-50 p-3 rounded'
          res.textContent = '✅ ' + data.mensaje
          btn.textContent = '✓ Completado'
          btn.className = 'bg-green-600 text-white font-bold py-3 px-8 rounded-lg cursor-not-allowed'
          setTimeout(() => window.location='/usuarios', 2000)
        } else {
          res.className = 'mt-4 text-sm text-red-700 bg-red-50 p-3 rounded'
          res.textContent = '❌ ' + data.error
          btn.disabled = false; btn.textContent = '↺ Reintentar'
        }
      } catch(e) {
        res.classList.remove('hidden')
        res.className = 'mt-4 text-sm text-red-700 bg-red-50 p-3 rounded'
        res.textContent = '❌ Error de red: ' + e.message
        btn.disabled = false; btn.textContent = '↺ Reintentar'
      }
    }
  </script></body></html>`)
})

admin.post('/run-migration-0016', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.json({ error: 'No autorizado' }, 403)
  const db = c.env.DB
  try {
    // Agregar columna rol_extendido que acepta cualquier valor (sin CHECK constraint)
    // El campo 'rol' original queda con su constraint pero siempre guardará 'vendedor'
    // para los roles nuevos; rol_extendido guarda el valor real.
    await db.prepare(`ALTER TABLE usuarios ADD COLUMN rol_extendido TEXT`).run()
    // Poblar con los valores actuales de rol
    await db.prepare(`UPDATE usuarios SET rol_extendido = rol`).run()
    return c.json({ ok: true, mensaje: 'Migración aplicada. Ahora se pueden crear usuarios con roles: gerente, administracion, supervisor, vendedor.' })
  } catch (e: any) {
    // Si la columna ya existe, igual consideramos OK
    if (e.message?.includes('duplicate column')) {
      await db.prepare(`UPDATE usuarios SET rol_extendido = rol WHERE rol_extendido IS NULL`).run()
      return c.json({ ok: true, mensaje: 'Columna ya existía. Datos sincronizados correctamente.' })
    }
    return c.json({ ok: false, error: e.message })
  }
})

// ===================== SEED DEMO DATA =====================
admin.get('/seed-demo', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.redirect('/login')

  return c.html(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>Seed Demo — Dr. Viaje</title>
  <script src="https://cdn.tailwindcss.com"></script></head>
  <body class="bg-gray-100 flex items-center justify-center min-h-screen">
  <div class="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
    <h1 class="text-2xl font-bold text-gray-800 mb-4">🌱 Cargar Datos de Prueba</h1>
    <p class="text-gray-600 mb-2">Se insertarán:</p>
    <ul class="text-left text-sm text-gray-600 mb-6 space-y-1">
      <li>✅ 2 vendedores (Jblanco, Felix Leon)</li>
      <li>✅ 8 proveedores (Latam, Iberia, Marriott, etc.)</li>
      <li>✅ 8 operadores/prestadores</li>
      <li>✅ 5 clientes + 7 pasajeros</li>
      <li>✅ 3 bancos/cuentas</li>
      <li>✅ 5 files (MAD, EZE, MAD-FCO, PDP, CUN)</li>
      <li>✅ 16 servicios asociados</li>
      <li>✅ Movimientos de caja + gastos admin + cotizaciones</li>
    </ul>
    <p class="text-amber-600 text-sm mb-6">⚠️ Usa INSERT OR IGNORE — no sobreescribe datos existentes.</p>
    <form method="POST" action="/seed-demo">
      <button type="submit" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg">
        ▶ Ejecutar Seed
      </button>
    </form>
    <a href="/dashboard" class="mt-4 inline-block text-gray-500 hover:text-gray-700 text-sm">← Volver al dashboard</a>
  </div></body></html>`)
})

admin.post('/seed-demo', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.redirect('/login')

  const db = c.env.DB
  const results: { stmt: string; ok: boolean; err?: string }[] = []

  const statements = [
    // 1. Vendedores
    `INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol, activo) VALUES ('Jblanco','jblanco@drviaje.com','pbkdf2$100000$64656d6f73616c7430303031$a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2','vendedor',1)`,
    `INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol, activo) VALUES ('Felix Leon','felix@drviaje.com','pbkdf2$100000$64656d6f73616c7430303032$a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2','vendedor',1)`,
    // 2. Proveedores
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('Latam Airlines','aéreo','Valentina Soto','reservas@latam.com','+598 2900 1234','Proveedor aéreo principal. Política: pago 48hs antes del vuelo.',1)`,
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('Iberia','aéreo','Carlos Méndez','ventas@iberia.uy','+598 2902 5678','Vuelos Europa. Descuento agencia 8%.',1)`,
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('Marriott Hoteles','hotelero','Andrea Pérez','reservas@marriott.com','+1 800 228 9290','Cadena premium. Cancelación gratis hasta 72hs.',1)`,
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('NH Hoteles','hotelero','Rodrigo Álvarez','grupos@nh-hotels.com','+598 2916 0101','Hoteles en Europa y América Latina. Pago 30 días.',1)`,
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('Transfer Platinum','traslado','Gustavo Núñez','ops@transferplatinum.com.uy','+598 099 123 456','Traslados premium Montevideo. 24/7.',1)`,
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('Assist Card','seguro','Laura Torres','empresas@assistcard.com','+598 2902 8888','Seguro viajero. Límite cobertura $100k USD.',1)`,
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('Buena Vista Tours','tour','Marcela Giménez','reservas@buenavista.uy','+598 2480 9900','Tours receptivos Uruguay y región.',1)`,
    `INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES ('Copa Airlines','aéreo','Diego Fernández','ventas@copaair.com','+507 217 2672','Conexiones Hub Panamá.',1)`,
    // 3. Operadores
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('Aeropuerto de Carrasco','aeropuerto','Info General','info@aeropuerto.com.uy','+598 2604 0392',1)`,
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('Hotel Sheraton Montevideo','hotel','Concierge','reservas@sheraton-mdu.com','+598 2710 2121',1)`,
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('Radisson Montevideo','hotel','Reception','reservas@radisson-mdu.com','+598 2628 6000',1)`,
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('Marriott Madrid','hotel','Groups Dept.','groups@marriott-madrid.com','+34 91 310 1090',1)`,
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('NH Collection Roma','hotel','Sales Office','sales@nh-roma.com','+39 06 8751 441',1)`,
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('City Tour Montevideo','tour','Guía: Pablo Ruiz','tours@citytour.uy','+598 098 765 432',1)`,
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('Tango Show Buenos Aires','show','Reservas BA','reservas@tangoshow.ar','+54 11 4300 5500',1)`,
    `INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES ('Europcar Uruguay','rent-a-car','Mostrador','reservas@europcar.com.uy','+598 2604 0111',1)`,
    // 4. Clientes
    `INSERT OR IGNORE INTO clientes (nombre_completo, email, telefono, tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte, notas) VALUES ('María García López','maria.garcia@gmail.com','+598 099 211 333','PAS','URU123456','1985-03-15','2029-03-14','Prefiere ventanilla. Sin mariscos. Millas Latam Pass.')`,
    `INSERT OR IGNORE INTO clientes (nombre_completo, email, telefono, tipo_documento, nro_documento, fecha_nacimiento, notas) VALUES ('Roberto Sánchez Pérez','roberto.sanchez@gmail.com','+598 099 445 667','CI','3.456.789-0','1978-07-22','Cliente frecuente. Viaja por negocios. Siempre suite.')`,
    `INSERT OR IGNORE INTO clientes (nombre_completo, email, telefono, tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte, notas) VALUES ('Ana Martínez de Silva','ana.martinez@outlook.com','+598 091 334 556','PAS','URU234567','1990-11-08','2027-11-07','Viaja con familia (2 menores). Dieta vegetariana.')`,
    `INSERT OR IGNORE INTO clientes (nombre_completo, email, telefono, tipo_documento, nro_documento, fecha_nacimiento, notas) VALUES ('Carlos Fernández Ruiz','carlos.fernandez@gmail.com','+598 098 778 990','CI','4.567.890-1','1965-05-30','Jubilado. Prefiere vuelos directos. Seguro siempre.')`,
    `INSERT OR IGNORE INTO clientes (nombre_completo, email, telefono, tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte, notas) VALUES ('Sofía Rodríguez Méndez','sofia.rodriguez@yahoo.com','+598 095 123 789','PAS','URU345678','1995-09-12','2028-09-11','Primera vez viajando al exterior. Quiere todo incluido.')`,
    // 5. Bancos
    `INSERT OR IGNORE INTO bancos (nombre_entidad, nro_cuenta, moneda, saldo_inicial, activo) VALUES ('BROU Cuenta Corriente USD','001-0012345-6','USD',15000.00,1)`,
    `INSERT OR IGNORE INTO bancos (nombre_entidad, nro_cuenta, moneda, saldo_inicial, activo) VALUES ('Santander Cuenta USD','072-9876543-1','USD',8000.00,1)`,
    `INSERT OR IGNORE INTO bancos (nombre_entidad, nro_cuenta, moneda, saldo_inicial, activo) VALUES ('BROU Cuenta Corriente UYU','001-0012346-8','UYU',320000.00,1)`,
    // 6. Cotizaciones
    `INSERT OR IGNORE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES ('2026-03-01','USD','UYU',42.50)`,
    `INSERT OR IGNORE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES ('2026-03-10','USD','UYU',42.80)`,
    `INSERT OR IGNORE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES ('2026-03-20','USD','UYU',43.10)`,
    `INSERT OR IGNORE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES ('2026-03-30','USD','UYU',43.35)`,
    // 7. Gastos admin
    `INSERT OR IGNORE INTO gastos_admin (rubro, descripcion, monto, moneda, fecha, proveedor, usuario_id) VALUES ('rrhh','Sueldos Marzo 2026',85000.00,'UYU','2026-03-31','Nómina interna',1)`,
    `INSERT OR IGNORE INTO gastos_admin (rubro, descripcion, monto, moneda, fecha, proveedor, usuario_id) VALUES ('oficina','Alquiler oficina Colonia 820 - Marzo',28000.00,'UYU','2026-03-05','Propietario Garmendia',1)`,
    `INSERT OR IGNORE INTO gastos_admin (rubro, descripcion, monto, moneda, fecha, proveedor, usuario_id) VALUES ('software','Suscripción Amadeus GDS - Marzo',350.00,'USD','2026-03-01','Amadeus IT Group',1)`,
    `INSERT OR IGNORE INTO gastos_admin (rubro, descripcion, monto, moneda, fecha, proveedor, usuario_id) VALUES ('marketing','Publicidad Instagram + Facebook',180.00,'USD','2026-03-10','Meta Ads',1)`,
  ]

  // Ejecutar sentencias base
  for (const sql of statements) {
    try {
      await db.prepare(sql).run()
      results.push({ stmt: sql.substring(0, 60) + '…', ok: true })
    } catch (e: any) {
      results.push({ stmt: sql.substring(0, 60) + '…', ok: false, err: e.message })
    }
  }

  // Obtener IDs dinámicos para files y servicios
  const vendedores = await db.prepare(`SELECT id, email FROM usuarios WHERE email IN ('jblanco@drviaje.com','felix@drviaje.com') ORDER BY id`).all()
  const vMap: Record<string, number> = {}
  for (const v of (vendedores.results as any[])) vMap[v.email] = v.id

  const clientes = await db.prepare(`SELECT id, email FROM clientes WHERE email IN ('maria.garcia@gmail.com','roberto.sanchez@gmail.com','ana.martinez@outlook.com','carlos.fernandez@gmail.com','sofia.rodriguez@yahoo.com') ORDER BY id`).all()
  const cMap: Record<string, number> = {}
  for (const cl of (clientes.results as any[])) cMap[cl.email] = cl.id

  const provs = await db.prepare(`SELECT id, nombre FROM proveedores WHERE nombre IN ('Latam Airlines','Iberia','Marriott Hoteles','NH Hoteles','Transfer Platinum','Assist Card','Buena Vista Tours','Copa Airlines') ORDER BY id`).all()
  const pMap: Record<string, number> = {}
  for (const p of (provs.results as any[])) pMap[p.nombre] = p.id

  const ops = await db.prepare(`SELECT id, nombre FROM operadores WHERE nombre IN ('Aeropuerto de Carrasco','Marriott Madrid','NH Collection Roma') ORDER BY id`).all()
  const oMap: Record<string, number> = {}
  for (const o of (ops.results as any[])) oMap[o.nombre] = o.id

  const jbId = vMap['jblanco@drviaje.com'] || 2
  const fxId = vMap['felix@drviaje.com'] || 3
  const c1 = cMap['maria.garcia@gmail.com'] || 1
  const c2 = cMap['roberto.sanchez@gmail.com'] || 2
  const c3 = cMap['ana.martinez@outlook.com'] || 3
  const c4 = cMap['carlos.fernandez@gmail.com'] || 4
  const c5 = cMap['sofia.rodriguez@yahoo.com'] || 5
  const pLatam = pMap['Latam Airlines'] || 1
  const pIberia = pMap['Iberia'] || 2
  const pMarriott = pMap['Marriott Hoteles'] || 3
  const pNH = pMap['NH Hoteles'] || 4
  const pTransfer = pMap['Transfer Platinum'] || 5
  const pAssist = pMap['Assist Card'] || 6
  const pBuena = pMap['Buena Vista Tours'] || 7
  const pCopa = pMap['Copa Airlines'] || 8
  const oCarrasco = oMap['Aeropuerto de Carrasco'] || 1
  const oMadrid = oMap['Marriott Madrid'] || 4
  const oRoma = oMap['NH Collection Roma'] || 5

  // Insertar files
  const fileStmts = [
    `INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES ('F-2026-001',${c1},${jbId},'cerrado','2026-03-01','2026-04-10','MAD','USD',4850.00,3620.00,'Viaje de placer 10 días. Madrid. Cliente muy satisfecha.')`,
    `INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES ('F-2026-002',${c2},${fxId},'seniado','2026-03-05','2026-04-25','EZE','USD',1200.00,900.00,'Viaje negocios 4 días. Hotel Sheraton BA. Seña 50% recibida.')`,
    `INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES ('F-2026-003',${c3},${jbId},'en_proceso','2026-03-10','2026-07-15','MAD','USD',9200.00,7100.00,'3 pasajeros. Madrid a Roma 14 días. En cotización.')`,
    `INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES ('F-2026-004',${c4},${fxId},'cerrado','2026-03-12','2026-03-20','PDP','USD',680.00,520.00,'Fin de semana largo Punta del Este.')`,
    `INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES ('F-2026-005',${c5},1,'en_proceso','2026-03-15','2026-06-01','CUN','USD',2800.00,2100.00,'Primera vez viajando. Todo incluido.')`,
  ]
  for (const sql of fileStmts) {
    try { await db.prepare(sql).run(); results.push({ stmt: sql.substring(0, 60) + '…', ok: true }) }
    catch (e: any) { results.push({ stmt: sql.substring(0, 60) + '…', ok: false, err: e.message }) }
  }

  // Obtener IDs de files recién insertados
  const filesRes = await db.prepare(`SELECT id, numero FROM files WHERE numero IN ('F-2026-001','F-2026-002','F-2026-003','F-2026-004','F-2026-005') ORDER BY numero`).all()
  const fMap: Record<string, number> = {}
  for (const f of (filesRes.results as any[])) fMap[f.numero] = f.id

  const f1 = fMap['F-2026-001'] || 1
  const f2 = fMap['F-2026-002'] || 2
  const f3 = fMap['F-2026-003'] || 3
  const f4 = fMap['F-2026-004'] || 4
  const f5 = fMap['F-2026-005'] || 5

  // Insertar servicios
  const svcStmts = [
    // File 1: Madrid
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f1},'aereo','MVD → MAD → MVD / Latam LA 701',${pLatam},${oCarrasco},'MAD','LA-7012026A','2026-04-10','2026-04-20',1850.00,'USD',2400.00,1,1,'confirmado')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f1},'hotel','Marriott Madrid Gran Vía - 10 noches',${pMarriott},${oMadrid},'MAD','2026-04-10','2026-04-20',1450.00,'USD',1950.00,1,1,'confirmado')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f1},'seguro','Assist Card Internacional - 10 días',${pAssist},'MAD','2026-04-10','2026-04-20',320.00,'USD',500.00,0,0,'confirmado')`,
    // File 2: Buenos Aires
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f2},'aereo','MVD → EZE → MVD / Copa CM 305',${pCopa},${oCarrasco},'EZE','CM-3052026B','2026-04-25','2026-04-29',420.00,'USD',560.00,1,0,'confirmado')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f2},'hotel','Sheraton Buenos Aires - 4 noches',${pMarriott},'EZE','2026-04-25','2026-04-29',380.00,'USD',520.00,1,0,'confirmado')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f2},'traslado','Traslado Ezeiza hotel ida y vuelta',${pTransfer},'EZE','2026-04-25','2026-04-29',100.00,'USD',120.00,0,0,'pendiente')`,
    // File 3: Europa familia
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f3},'aereo','MVD → MAD → MVD / Iberia x3 pax',${pIberia},${oCarrasco},'MAD','2026-07-15','2026-07-29',3600.00,'USD',4500.00,1,0,'pendiente')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f3},'hotel','NH Madrid Zurbano - 7 noches familiar',${pNH},'MAD','2026-07-15','2026-07-22',1750.00,'USD',2100.00,1,0,'pendiente')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f3},'hotel','NH Collection Roma - 7 noches familiar',${pNH},${oRoma},'FCO','2026-07-22','2026-07-29',1400.00,'USD',1800.00,1,0,'pendiente')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f3},'seguro','Assist Card Familiar Europa x3 pax',${pAssist},'MAD','2026-07-15','2026-07-29',350.00,'USD',800.00,0,0,'pendiente')`,
    // File 4: Punta del Este
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f4},'traslado','Montevideo ↔ Punta del Este',${pTransfer},'PDP','2026-03-20','2026-03-22',120.00,'USD',160.00,0,0,'confirmado')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f4},'hotel','Marriott Punta del Este - 2 noches',${pMarriott},'PDP','2026-03-20','2026-03-22',400.00,'USD',520.00,1,1,'confirmado')`,
    // File 5: Cancún
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f5},'aereo','MVD → CUN → MVD / Copa+LATAM via PTY',${pCopa},${oCarrasco},'CUN','2026-06-01','2026-06-08',980.00,'USD',1300.00,1,0,'pendiente')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f5},'hotel','Moon Palace Cancún - Todo Incluido 7n',${pMarriott},'CUN','2026-06-01','2026-06-08',980.00,'USD',1200.00,1,0,'pendiente')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f5},'tour','Tour Chichén Itzá + Cenote + almuerzo',${pBuena},'CUN','2026-06-04','2026-06-04',95.00,'USD',180.00,0,0,'pendiente')`,
    `INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, destino_codigo, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES (${f5},'seguro','Assist Card Américas - 7 días Standard',${pAssist},'CUN','2026-06-01','2026-06-08',45.00,'USD',120.00,0,0,'pendiente')`,
  ]
  for (const sql of svcStmts) {
    try { await db.prepare(sql).run(); results.push({ stmt: sql.substring(0, 60) + '…', ok: true }) }
    catch (e: any) { results.push({ stmt: sql.substring(0, 60) + '…', ok: false, err: e.message }) }
  }

  // Movimientos de caja
  const movStmts = [
    `INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, concepto, referencia, anulado, usuario_id, fecha) VALUES ('ingreso','transferencia','USD',2425.00,42.50,103062.50,${f1},${c1},'Seña 50% F-2026-001 María García Madrid','TRF-001-A',0,${jbId},'2026-03-03')`,
    `INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, concepto, referencia, anulado, usuario_id, fecha) VALUES ('ingreso','transferencia','USD',2425.00,42.50,103062.50,${f1},${c1},'Saldo 50% F-2026-001 María García Madrid','TRF-001-B',0,${jbId},'2026-03-25')`,
    `INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, concepto, referencia, anulado, usuario_id, fecha) VALUES ('ingreso','efectivo','USD',600.00,42.80,25680.00,${f2},${c2},'Seña 50% F-2026-002 Roberto Sánchez BA','EFE-002-A',0,${fxId},'2026-03-07')`,
    `INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, concepto, referencia, anulado, usuario_id, fecha) VALUES ('ingreso','tarjeta','USD',680.00,43.00,29240.00,${f4},${c4},'Pago total F-2026-004 Carlos Fernández PdE','TC-004-A',0,${fxId},'2026-03-14')`,
  ]
  for (const sql of movStmts) {
    try { await db.prepare(sql).run(); results.push({ stmt: sql.substring(0, 60) + '…', ok: true }) }
    catch (e: any) { results.push({ stmt: sql.substring(0, 60) + '…', ok: false, err: e.message }) }
  }

  const okCount = results.filter(r => r.ok).length
  const failCount = results.filter(r => !r.ok).length

  const rows = results.map(r => `
    <tr class="${r.ok ? 'bg-green-50' : 'bg-red-50'}">
      <td class="px-3 py-1 text-xs font-mono">${r.stmt}</td>
      <td class="px-3 py-1 text-xs text-center">${r.ok ? '✅' : '❌'}</td>
      <td class="px-3 py-1 text-xs text-red-600">${r.err || ''}</td>
    </tr>`).join('')

  return c.html(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>Seed Demo — Resultado</title>
  <script src="https://cdn.tailwindcss.com"></script></head>
  <body class="bg-gray-100 p-6">
  <div class="max-w-5xl mx-auto bg-white rounded-xl shadow p-6">
    <h1 class="text-2xl font-bold mb-4">🌱 Seed Demo — Resultado</h1>
    <div class="flex gap-4 mb-6">
      <span class="bg-green-100 text-green-800 px-4 py-2 rounded-lg font-bold">✅ ${okCount} OK</span>
      <span class="${failCount > 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'} px-4 py-2 rounded-lg font-bold">❌ ${failCount} fallos</span>
    </div>
    <p class="text-gray-600 mb-4 text-sm">Los errores UNIQUE son normales si los datos ya existían (INSERT OR IGNORE).</p>
    <div class="overflow-auto max-h-96 border rounded">
    <table class="w-full text-left border-collapse">
      <thead class="bg-gray-50 sticky top-0">
        <tr><th class="px-3 py-2 text-xs">Sentencia</th><th class="px-3 py-2 text-xs">Estado</th><th class="px-3 py-2 text-xs">Error</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <div class="mt-6 flex gap-4">
      <a href="/dashboard" class="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">→ Ir al Dashboard</a>
      <a href="/files" class="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700">→ Ver Files</a>
    </div>
  </div></body></html>`)
})

// ===================== BITRIX24 (Webhook) =====================
admin.post('/api/bitrix/webhook', async (c) => {
  try {
    const body = await c.req.json() as any
    const dealId = body?.data?.FIELDS?.ID || body?.data?.ID
    if (!dealId) return c.json({ error: 'No deal ID' }, 400)

    // Por ahora registrar la recepción para configuración futura
    return c.json({ 
      ok: true, 
      message: 'Webhook recibido. Configure la URL de Bitrix24 y token para integración completa.',
      deal_id: dealId 
    })
  } catch (e: any) {
    console.error('[WEBHOOK]', e.message)
    return c.json({ error: 'Error interno del servidor' }, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// GET /api/cotizacion-hoy  — Devuelve los 3 pares del día desde DB
// Público (solo lectura, sin datos sensibles)
// ══════════════════════════════════════════════════════════════
admin.get('/api/cotizacion-hoy', async (c) => {
  try {
    const hoy = new Date().toISOString().split('T')[0]
    const rows = await c.env.DB.prepare(
      `SELECT moneda_origen, moneda_destino, valor FROM cotizaciones WHERE fecha = ?`
    ).bind(hoy).all()

    const result: Record<string, number> = {}
    for (const r of rows.results as any[]) {
      result[`${r.moneda_origen}_${r.moneda_destino}`] = r.valor
    }
    // Calcular EUR→UYU si faltan datos directos
    if (!result['EUR_UYU'] && result['EUR_USD'] && result['USD_UYU']) {
      result['EUR_UYU'] = result['EUR_USD'] * result['USD_UYU']
    }
    return c.json({ fecha: hoy, cotizaciones: result, ok: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ══════════════════════════════════════════════════════════════
// POST /api/cotizaciones/auto  — Obtiene cotizaciones de ExchangeRate-API
// y las guarda en la DB. Solo admin/gerente.
// ══════════════════════════════════════════════════════════════
admin.post('/api/cotizaciones/auto', async (c) => {
  const user = await getUser(c)
  if (!user || !isAdminOrAbove(user.rol)) return c.json({ error: 'No autorizado' }, 403)

  try {
    const hoy = new Date().toISOString().split('T')[0]

    // Consultar ExchangeRate-API (gratis, sin API key)
    const resp = await fetch('https://open.exchangerate-api.com/v6/latest/USD')
    if (!resp.ok) throw new Error(`API respondió ${resp.status}`)
    const data: any = await resp.json()
    const rates = data.rates as Record<string, number>

    const usdUyu = rates['UYU']
    const usdEur = rates['EUR']
    if (!usdUyu || !usdEur) throw new Error('Tasas no disponibles en la respuesta')

    const eurUsd = 1 / usdEur  // EUR→USD
    const eurUyu = eurUsd * usdUyu  // EUR→UYU (calculado)

    // Guardar los 3 pares con INSERT OR REPLACE
    const stmt = c.env.DB.prepare(
      `INSERT OR REPLACE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES (?,?,?,?)`
    )
    await c.env.DB.batch([
      stmt.bind(hoy, 'USD', 'UYU', Math.round(usdUyu * 10000) / 10000),
      stmt.bind(hoy, 'EUR', 'USD', Math.round(eurUsd * 10000) / 10000),
      stmt.bind(hoy, 'EUR', 'UYU', Math.round(eurUyu * 10000) / 10000),
    ])

    return c.json({
      ok: true,
      fecha: hoy,
      cotizaciones: {
        USD_UYU: Math.round(usdUyu * 10000) / 10000,
        EUR_USD: Math.round(eurUsd * 10000) / 10000,
        EUR_UYU: Math.round(eurUyu * 10000) / 10000,
      }
    })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ===================== MIGRACIÓN 0015 =====================
admin.post('/run-migration-0015', async (c) => {
  const user = await getUser(c)
  if (!user || user.rol !== 'gerente') return c.json({ error: 'No autorizado' }, 403)
  try {
    // ALTER TABLE ignora el error si la columna ya existe (SQLite no soporta IF NOT EXISTS en ALTER)
    const results: string[] = []
    for (const sql of [
      'ALTER TABLE proveedores ADD COLUMN razon_social TEXT',
      'ALTER TABLE proveedores ADD COLUMN nro_rut TEXT',
    ]) {
      try {
        await c.env.DB.prepare(sql).run()
        results.push(`OK: ${sql}`)
      } catch (e: any) {
        // Si ya existe la columna SQLite lanza "duplicate column name"
        results.push(`SKIP (ya existe): ${sql}`)
      }
    }
    return c.json({ ok: true, results })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message })
  }
})

export default admin
