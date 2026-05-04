// Layout base para Dr. Viaje ERP

export const COLORS = {
  purple: '#7B3FA0',
  orange: '#F7941D',
  pink: '#EC008C',
  purpleLight: '#f3e8ff',
  purpleDark: '#5a2d75',
}

export function baseLayout(title: string, content: string, user: { nombre: string; rol: string } | null, activePage: string = ''): string {
  const rol = user?.rol || ''
  const esObservador = rol === 'observador'

  // Items visibles para todos los roles autenticados
  const baseNavItems = [
    { href: '/dashboard', icon: 'fa-home', label: 'Dashboard', page: 'dashboard' },
    { href: '/files', icon: 'fa-folder-open', label: 'Files', page: 'files' },
    { href: '/clientes', icon: 'fa-users', label: 'Clientes', page: 'clientes' },
    { href: '/pasajeros', icon: 'fa-user-friends', label: 'Pasajeros', page: 'pasajeros' },
  ]

  // Tesorería y pagos: gerente, administración y observador (este último solo lectura)
  const tesNaveItems = (rol === 'gerente' || rol === 'administracion' || rol === 'observador') ? [
    { href: '/tesoreria', icon: 'fa-dollar-sign', label: 'Tesorería', page: 'tesoreria' },
    { href: '/tesoreria/proveedores', icon: 'fa-handshake', label: 'Pagos Proveedores', page: 'pagos-proveedores' },
    { href: '/tesoreria/tarjetas', icon: 'fa-credit-card', label: 'Tarjetas en Cartera', page: 'tarjetas-cartera' },
    { href: '/tesoreria/tarjetas/reporte', icon: 'fa-file-excel', label: 'Reporte TCs', page: 'reporte-tc' },
    { href: '/tesoreria/transferencias', icon: 'fa-exchange-alt', label: 'Transferencias', page: 'transferencias' },
    { href: '/bancos', icon: 'fa-university', label: 'Bancos', page: 'bancos' },
    { href: '/gastos', icon: 'fa-receipt', label: 'Gastos', page: 'gastos' },
    ...(rol === 'gerente' ? [{ href: '/tesoreria/desimputar', icon: 'fa-undo', label: 'Desimputar Pagos', page: 'desimputar' }] : []),
  ] : []

  // Reportes: gerente, administración, supervisor, vendedor y observador
  const reportesNavItems = (rol === 'gerente' || rol === 'administracion' || rol === 'supervisor' || rol === 'vendedor' || rol === 'observador') ? [
    { href: '/reportes', icon: 'fa-chart-bar', label: 'Reportes', page: 'reportes' },
    ...(rol !== 'vendedor' ? [
      { href: '/reportes/cuentas-corrientes', icon: 'fa-file-invoice-dollar', label: 'Ctas. Corrientes', page: 'cuentas-corrientes' },
      { href: '/cotizaciones', icon: 'fa-exchange-alt', label: 'Cotizaciones', page: 'cotizaciones' },
    ] : []),
  ] : []

  // Liquidaciones: todos excepto observador (no tiene liquidaciones propias)
  const liquidacionesNavItems = !esObservador ? [
    { href: rol === 'vendedor' ? '/liquidaciones/pendientes' : '/liquidaciones', icon: 'fa-file-invoice-dollar', label: 'Liquidaciones', page: 'liquidaciones' },
  ] : []

  // Admin: solo gerente ve usuarios; gerente y administración ven proveedores
  const adminNavItems: {href:string;icon:string;label:string;page:string}[] = []
  if (rol === 'gerente' || rol === 'administracion' || rol === 'observador') {
    adminNavItems.push({ href: '/proveedores', icon: 'fa-building', label: 'Proveedores', page: 'proveedores' })
    adminNavItems.push({ href: '/bancos/caja', icon: 'fa-cash-register', label: 'Caja Diaria', page: 'caja' })
  }
  if (rol === 'gerente') {
    adminNavItems.push({ href: '/usuarios', icon: 'fa-user-cog', label: 'Usuarios', page: 'usuarios' })
  }

  const allNavItems = [...baseNavItems, ...tesNaveItems, ...reportesNavItems, ...liquidacionesNavItems]

  const navHtml = allNavItems.map(item => `
    <a href="${item.href}" class="nav-item ${activePage === item.page ? 'active' : ''}">
      <i class="fas ${item.icon}"></i>
      <span>${item.label}</span>
    </a>
  `).join('')

  const adminHtml = adminNavItems.length > 0 ? `
    <div class="nav-section-title">ADMINISTRACIÓN</div>
    ${adminNavItems.map(item => `
      <a href="${item.href}" class="nav-item ${activePage === item.page ? 'active' : ''}">
        <i class="fas ${item.icon}"></i>
        <span>${item.label}</span>
      </a>
    `).join('')}
  ` : ''

  // Badge de rol
  const rolBadgeColors: Record<string, string> = {
    gerente:        'linear-gradient(135deg,#7B3FA0,#EC008C)',
    administracion: 'linear-gradient(135deg,#1d4ed8,#0ea5e9)',
    supervisor:     'linear-gradient(135deg,#b45309,#f59e0b)',
    vendedor:       '#fff7ed',
    observador:     'linear-gradient(135deg,#374151,#6b7280)',
  }
  const rolBadgeText: Record<string, string> = {
    gerente: 'white', administracion: 'white', supervisor: 'white', vendedor: '#c2410c'
  }
  const rolLabels: Record<string, string> = {
    gerente: 'Gerente', administracion: 'Administración', supervisor: 'Supervisor', vendedor: 'Vendedor'
  }
  const badgeBg    = rolBadgeColors[rol] || '#f3f4f6'
  const badgeFg    = rolBadgeText[rol] || '#374151'
  const badgeLabel = rolLabels[rol] || rol

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Dr. Viaje ERP</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
  <style>
    :root {
      --purple: #7B3FA0;
      --purple-dark: #5a2d75;
      --purple-light: #f3e8ff;
      --orange: #F7941D;
      --pink: #EC008C;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f0fa; color: #1a1a2e; }
    
    /* Sidebar */
    .sidebar {
      position: fixed; top: 0; left: 0; width: 230px; height: 100vh;
      background: linear-gradient(180deg, var(--purple-dark) 0%, var(--purple) 100%);
      overflow-y: auto; z-index: 100; display: flex; flex-direction: column;
      box-shadow: 4px 0 20px rgba(0,0,0,0.15);
    }
    .sidebar-logo {
      padding: 20px 16px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);
      display: flex; align-items: center; gap: 10px;
    }
    .sidebar-logo .ecg-icon { font-size: 22px; color: var(--orange); }
    .sidebar-logo .logo-text { display: flex; flex-direction: column; }
    .sidebar-logo .logo-dr { color: var(--orange); font-weight: 800; font-size: 18px; line-height: 1; }
    .sidebar-logo .logo-viaje { color: white; font-weight: 700; font-size: 16px; line-height: 1; }
    .sidebar-logo .logo-com { color: var(--pink); font-weight: 800; font-size: 12px; }
    .sidebar-logo .erp-badge {
      background: rgba(255,255,255,0.15); color: white; font-size: 9px;
      padding: 2px 6px; border-radius: 10px; letter-spacing: 1px; margin-top: 2px;
    }
    nav { padding: 12px 0; flex: 1; }
    .nav-section-title {
      color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 700;
      padding: 12px 16px 4px; letter-spacing: 1.5px;
    }
    .nav-item {
      display: flex; align-items: center; gap: 10px; padding: 10px 16px;
      color: rgba(255,255,255,0.75); text-decoration: none; font-size: 13.5px;
      transition: all 0.2s; border-left: 3px solid transparent;
    }
    .nav-item:hover { background: rgba(255,255,255,0.1); color: white; }
    .nav-item.active { background: rgba(255,255,255,0.15); color: white; border-left-color: var(--orange); }
    .nav-item i { width: 18px; text-align: center; }
    .sidebar-footer {
      padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.1);
      display: flex; align-items: center; gap: 10px;
    }
    .user-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--orange); display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: 13px; flex-shrink: 0;
    }
    .user-info { flex: 1; min-width: 0; }
    .user-name { color: white; font-size: 12px; font-weight: 600; truncate: ellipsis; white-space: nowrap; overflow: hidden; }
    .user-role { color: rgba(255,255,255,0.5); font-size: 10px; text-transform: uppercase; }
    
    /* Main content */
    body { overflow-x: hidden; }
    .main-content { margin-left: 230px; min-height: 100vh; display: flex; flex-direction: column; }
    .topbar {
      background: white; padding: 14px 24px; display: flex; align-items: center;
      justify-content: space-between; border-bottom: 1px solid #e8dff5;
      position: sticky; top: 0; z-index: 50; box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      width: 100%;
    }
    .topbar-title { font-size: 18px; font-weight: 700; color: var(--purple-dark); }
    .topbar-actions { display: flex; gap: 10px; align-items: center; }
    .page-content { overflow-x: auto; }
    
    /* Cards */
    .card {
      background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(123,63,160,0.08);
      border: 1px solid #ede5f5; overflow: hidden;
    }
    .card-header {
      padding: 16px 20px; border-bottom: 1px solid #ede5f5;
      display: flex; align-items: center; justify-content: space-between;
    }
    .card-title { font-size: 15px; font-weight: 700; color: var(--purple-dark); }
    .card-body { padding: 20px; }
    
    /* Stats */
    .stat-card {
      background: white; border-radius: 12px; padding: 20px;
      border: 1px solid #ede5f5; box-shadow: 0 2px 12px rgba(123,63,160,0.06);
    }
    .stat-icon {
      width: 44px; height: 44px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    
    /* Buttons */
    .btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px;
      border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
      text-decoration: none; border: none; transition: all 0.2s; white-space: nowrap;
    }
    .btn-primary { background: var(--purple); color: white; }
    .btn-primary:hover { background: var(--purple-dark); }
    .btn-orange { background: var(--orange); color: white; }
    .btn-orange:hover { background: #e07a0a; }
    .btn-pink { background: var(--pink); color: white; }
    .btn-pink:hover { background: #c0006b; }
    .btn-outline { background: white; color: var(--purple); border: 1.5px solid var(--purple); }
    .btn-outline:hover { background: var(--purple-light); }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }
    .btn-sm { padding: 5px 10px; font-size: 12px; }
    .btn-success { background: #d1fae5; color: #059669; }
    
    /* Tables */
    .table-wrapper { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    th { background: #f8f3ff; color: var(--purple-dark); font-weight: 700; padding: 11px 14px; text-align: left; border-bottom: 2px solid #ede5f5; }
    td { padding: 11px 14px; border-bottom: 1px solid #f0ebf7; color: #374151; }
    tr:hover td { background: #faf7ff; }
    
    /* Forms */
    .form-group { margin-bottom: 16px; }
    .form-label { display: block; font-size: 12px; font-weight: 600; color: var(--purple-dark); margin-bottom: 5px; }
    .form-control {
      width: 100%; padding: 9px 12px; border: 1.5px solid #ddd6f0; border-radius: 8px;
      font-size: 13.5px; color: #1a1a2e; transition: border-color 0.2s;
      background: white; outline: none;
    }
    .form-control:focus { border-color: var(--purple); box-shadow: 0 0 0 3px rgba(123,63,160,0.1); }
    select.form-control { cursor: pointer; }
    
    /* Badges */
    .badge {
      display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px;
      border-radius: 20px; font-size: 11px; font-weight: 700;
    }
    /* Estados legacy (compatibilidad) */
    .badge-cotizacion { background: #e0f2fe; color: #0369a1; }
    .badge-confirmado { background: #d1fae5; color: #065f46; }
    .badge-operado { background: #f3e8ff; color: #6b21a8; }
    /* Estados nuevos de file */
    .badge-en_proceso { background: #e0f2fe; color: #0369a1; }
    .badge-seniado { background: #fef3c7; color: #92400e; }
    .badge-cerrado { background: #d1fae5; color: #065f46; }
    /* Estados de pago al proveedor */
    .badge-pago-pendiente { background: #fef9c3; color: #854d0e; border: 1px solid #fde68a; }
    .badge-pago-pagado { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
    /* Estado anulado y genéricos */
    .badge-anulado { background: #fee2e2; color: #991b1b; }
    .badge-pendiente { background: #fef9c3; color: #854d0e; }
    .badge-gerente { background: linear-gradient(135deg, var(--purple), var(--pink)); color: white; }
    .badge-vendedor { background: #fff7ed; color: #c2410c; }
    
    /* Alerts */
    .alert { padding: 12px 16px; border-radius: 8px; font-size: 13.5px; margin-bottom: 16px; }
    .alert-danger { background: #fee2e2; color: #991b1b; border-left: 4px solid #ef4444; }
    .alert-success { background: #d1fae5; color: #065f46; border-left: 4px solid #10b981; }
    .alert-warning { background: #fef3c7; color: #92400e; border-left: 4px solid #f59e0b; }
    .alert-info { background: #e0f2fe; color: #075985; border-left: 4px solid #0ea5e9; }
    
    /* Modal */
    .modal-overlay {
      display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 1000; align-items: center; justify-content: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: white; border-radius: 16px; width: 90%; max-width: 600px;
      max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .modal-header {
      padding: 20px 24px 16px; border-bottom: 1px solid #ede5f5;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; background: white; z-index: 1;
    }
    .modal-title { font-size: 17px; font-weight: 700; color: var(--purple-dark); }
    .modal-close { background: none; border: none; cursor: pointer; color: #6b7280; font-size: 20px; }
    .modal-body { padding: 24px; }
    
    /* Grid helpers */
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    
    /* Page content */
    .page-content { padding: 24px; }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f1f1f1; }
    ::-webkit-scrollbar-thumb { background: #c4b5d6; border-radius: 3px; }
    
    /* Alert prepago */
    .prepago-alert { background: #fef3c7; border-left: 4px solid #f59e0b; }
    .prepago-vencido { background: #fee2e2; border-left: 4px solid #ef4444; }
    
    /* Print */
    @media print {
      .sidebar, .topbar, .no-print { display: none !important; }
      .main-content { margin-left: 0; }
    }
    
    @media (max-width: 768px) {
      .sidebar { width: 200px; }
      .main-content { margin-left: 200px; }
      .grid-4 { grid-template-columns: 1fr 1fr; }
      .grid-3 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="sidebar">
    <div class="sidebar-logo">
      <div class="ecg-icon"><i class="fas fa-heartbeat"></i></div>
      <div class="logo-text">
        <div>
          <span class="logo-dr">Dr.</span><span class="logo-viaje">Viaje</span><span class="logo-com">.com</span>
        </div>
        <span class="erp-badge">ERP SYSTEM</span>
      </div>
    </div>
    <nav>
      ${navHtml}
      ${adminHtml}
    </nav>
    <div class="sidebar-footer">
      <div class="user-avatar">${user ? user.nombre.charAt(0).toUpperCase() : '?'}</div>
      <div class="user-info">
        <div class="user-name">${user?.nombre || 'Usuario'}</div>
        <div class="user-role" style="font-size:9px;color:rgba(255,255,255,0.5);">${badgeLabel}</div>
      </div>
      <a href="/logout" title="Cerrar sesión" style="color: rgba(255,255,255,0.5); font-size: 14px;">
        <i class="fas fa-sign-out-alt"></i>
      </a>
    </div>
  </div>
  
  <div class="main-content">
    <div class="topbar">
      <span class="topbar-title"><i class="fas fa-heartbeat" style="color:var(--orange)"></i> ${title}</span>
      <div class="topbar-actions">
        <!-- Badge alertas TC negadas -->
        <span id="tc-alerta-badge" style="display:none;cursor:pointer;" onclick="toggleAlertasTC()" title="Tarjetas rechazadas pendientes">
          <span style="background:#dc2626;color:white;font-size:10px;font-weight:800;padding:3px 8px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;animation:pulse 2s infinite;">
            <i class="fas fa-credit-card"></i>
            <span id="tc-alerta-count">0</span> TC rechazada(s)
          </span>
        </span>
        <span style="font-size:12px; color:#6b7280;">
          <i class="fas fa-user-circle" style="color:var(--purple)"></i> ${user?.nombre || ''}
          <span style="margin-left:6px;background:${badgeBg};color:${badgeFg};font-size:11px;padding:2px 8px;border-radius:10px;font-weight:700;">${badgeLabel}</span>
        </span>
      </div>
    </div>

    <!-- Panel desplegable de alertas TC -->
    <div id="panel-alertas-tc" style="display:none;position:fixed;top:54px;right:16px;z-index:900;background:white;border:1px solid #fca5a5;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.15);width:360px;max-height:400px;overflow-y:auto;">
      <div style="background:#dc2626;color:white;padding:10px 14px;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:700;font-size:13px;"><i class="fas fa-exclamation-triangle"></i> Tarjetas Rechazadas</span>
        <button onclick="toggleAlertasTC()" style="background:none;border:none;color:white;cursor:pointer;font-size:14px;">✕</button>
      </div>
      <div id="panel-alertas-tc-body" style="padding:12px 14px;font-size:12px;color:#374151;">
        <div style="text-align:center;color:#9ca3af;">Cargando...</div>
      </div>
    </div>

    <div class="page-content">
      ${content}
    </div>
  </div>

  <style>
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.7} }
  </style>
  <script>
    // Cargar alertas TC al abrir cualquier página
    (async function() {
      try {
        const r = await fetch('/api/alertas-tc')
        const data = await r.json()
        const total = data.total || 0
        if (total > 0) {
          document.getElementById('tc-alerta-count').textContent = total
          document.getElementById('tc-alerta-badge').style.display = 'inline'
        }
      } catch(e) {}
    })()

    function toggleAlertasTC() {
      const panel = document.getElementById('panel-alertas-tc')
      if (panel.style.display === 'none') {
        cargarPanelAlertas()
        panel.style.display = 'block'
      } else {
        panel.style.display = 'none'
      }
    }

    async function cargarPanelAlertas() {
      const body = document.getElementById('panel-alertas-tc-body')
      try {
        const r = await fetch('/api/alertas-tc')
        const data = await r.json()
        if (!data.alertas || data.alertas.length === 0) {
          body.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:16px;">Sin alertas pendientes.</div>'
          return
        }
        let html = ''
        data.alertas.forEach(a => {
          html += '<div style="border:1px solid #fee2e2;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fff5f5;">'
          html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'
          html += '<div>'
          html += '<div style="font-weight:700;color:#dc2626;margin-bottom:2px;"><i class="fas fa-times-circle"></i> TC Rechazada</div>'
          html += '<div style="color:#374151;">Proveedor: <strong>' + (a.proveedor_nombre||'—') + '</strong></div>'
          html += '<div style="color:#6b7280;">File: <strong>#' + (a.file_numero||'?') + '</strong> · ' + a.moneda + ' $' + Number(a.monto||0).toFixed(2) + '</div>'
          html += '</div></div>'
          html += '<a href="/files/' + a.file_id + '" onclick="marcarVistaAlerta(' + a.id + ')" style="display:block;margin-top:8px;padding:5px 12px;background:#dc2626;color:white;border-radius:6px;text-decoration:none;font-size:11px;font-weight:700;text-align:center;">'
          html += '<i class="fas fa-external-link-alt"></i> Ir al File</a>'
          html += '</div>'
        })
        body.innerHTML = html
      } catch(e) {
        body.innerHTML = '<div style="color:#dc2626;">Error al cargar alertas.</div>'
      }
    }

    async function marcarVistaAlerta(id) {
      await fetch('/api/alertas-tc/' + id + '/vista', { method: 'POST' }).catch(() => {})
    }
  </script>
</body>
</html>`
}
