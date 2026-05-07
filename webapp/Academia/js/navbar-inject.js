/**
 * Dr.Viaje — Inyector automático de navbar + lógica de navegación
 * Se incluye en todas las páginas de destinos, hoteles y amadeus.
 * Inserta el navbar al inicio del <body> y activa dropdowns/menú móvil.
 */
(function () {
  'use strict';

  // ── Detectar ruta base ────────────────────────────────────
  var pathname = window.location.pathname;
  var isDestino     = pathname.indexOf('/destinos/')     !== -1;
  var isHoteles     = pathname.indexOf('/hoteles/')      !== -1;
  var isAmadeus     = pathname.indexOf('/amadeus/')      !== -1;
  var isHerramienta = pathname.indexOf('/herramientas/') !== -1;
  var base = (isDestino || isHoteles || isAmadeus || isHerramienta) ? '../' : '';

  // ── Inyectar CSS global ──────────────────────────────────
  function injectCSS(href) {
    if (document.querySelector('link[data-drv-nav]')) return;
    var link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = href;
    link.setAttribute('data-drv-nav', '1');
    document.head.appendChild(link);
  }

  // ── HTML del navbar ──────────────────────────────────────
  function buildNavbar() {
    var b = base;
    var chevron  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>';
    var homeIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';

    return `
<nav class="drv-navbar" role="navigation" aria-label="Navegación principal">
  <div class="drv-navbar__inner">
    <div class="drv-navbar__logo">
      <a href="${b}index.html" aria-label="Dr.Viaje — Inicio">
        <img src="${b}images/logo-color.png" alt="Dr.Viaje" />
      </a>
    </div>
    <ul class="drv-navbar__menu" role="menubar">

      <!-- Inicio -->
      <li role="none">
        <a href="${b}index.html" class="drv-navbar__home" role="menuitem">
          ${homeIcon} Inicio
        </a>
      </li>

      <!-- ── DESTINOS ── -->
      <li role="none">
        <button class="drv-nav-trigger" aria-haspopup="true" aria-expanded="false" role="menuitem">
          🌍 Destinos ${chevron}
        </button>
        <div class="drv-dropdown drv-dropdown--wide" role="menu">
          <span class="drv-dropdown__title">🌎 Sudamérica</span>
          <a href="${b}destinos/bariloche.html" role="menuitem"><span class="flag">🇦🇷</span> Bariloche</a>
          <a href="${b}destinos/mendoza.html" role="menuitem"><span class="flag">🇦🇷</span> Mendoza</a>
          <a href="${b}destinos/ushuaia.html" role="menuitem"><span class="flag">🇦🇷</span> Ushuaia + El Calafate</a>
          <a href="${b}destinos/santiago.html" role="menuitem"><span class="flag">🇨🇱</span> Santiago de Chile</a>
          <hr>
          <button class="brasil-toggle" aria-haspopup="true">
            <span class="flag">🇧🇷</span> Brasil ${chevron}
          </button>
          <div class="brasil-submenu">
            <a href="${b}destinos/brasil-rio.html">🏖️ Río + Costa Verde</a>
            <a href="${b}destinos/brasil-bahia.html">🥁 Bahía</a>
            <a href="${b}destinos/brasil-ceara.html">🌊 Ceará</a>
            <a href="${b}destinos/brasil-nordeste.html">🌴 Nordeste</a>
            <a href="${b}destinos/brasil-maranhao.html">🏜️ Maranhão</a>
          </div>
          <hr>
          <span class="drv-dropdown__title">🏝️ Caribe</span>
          <a href="${b}destinos/cancun.html" role="menuitem"><span class="flag">🇲🇽</span> Cancún / Riviera Maya</a>
          <a href="${b}destinos/dominicana.html" role="menuitem"><span class="flag">🇩🇴</span> República Dominicana</a>
          <a href="${b}destinos/jamaica.html" role="menuitem"><span class="flag">🇯🇲</span> Jamaica</a>
          <a href="${b}destinos/aruba.html" role="menuitem"><span class="flag">🇦🇼</span> Aruba</a>
          <a href="${b}destinos/curazao.html" role="menuitem"><span class="flag">🇨🇼</span> Curaçao</a>
          <a href="${b}destinos/saint-martin.html" role="menuitem"><span class="flag">🇫🇷</span> Saint Martin</a>
          <a href="${b}destinos/san-andres.html" role="menuitem"><span class="flag">🇨🇴</span> San Andrés</a>
          <a href="${b}destinos/cartagena.html" role="menuitem"><span class="flag">🇨🇴</span> Cartagena de Indias</a>
          <a href="${b}destinos/santa-marta.html" role="menuitem"><span class="flag">🇨🇴</span> Santa Marta · Tayrona</a>
        </div>
      </li>

      <!-- ── USA ── -->
      <li role="none">
        <button class="drv-nav-trigger" aria-haspopup="true" aria-expanded="false" role="menuitem">
          🇺🇸 Estados Unidos ${chevron}
        </button>
        <div class="drv-dropdown" role="menu">
          <span class="drv-dropdown__title">🗽 Costa Este</span>
          <a href="${b}destinos/nueva-york.html" role="menuitem">🗽 Nueva York</a>
          <a href="${b}destinos/miami-orlando.html" role="menuitem">🌴 Miami + Orlando</a>
          <a href="${b}destinos/parques-orlando.html" role="menuitem">🎢 Parques de Orlando</a>
          <hr>
          <span class="drv-dropdown__title">🌅 Costa Oeste</span>
          <a href="${b}destinos/los-angeles.html" role="menuitem">🎬 Los Ángeles</a>
          <a href="${b}destinos/las-vegas.html" role="menuitem">🎰 Las Vegas</a>
          <a href="${b}destinos/san-francisco.html" role="menuitem">🌉 San Francisco</a>
        </div>
      </li>

      <!-- ── AMADEUS ── -->
      <li role="none">
        <button class="drv-nav-trigger" aria-haspopup="true" aria-expanded="false" role="menuitem">
          ✈️ Amadeus ${chevron}
        </button>
        <div class="drv-dropdown" role="menu">
          <span class="drv-dropdown__title">Amadeus GDS</span>
          <a href="${b}amadeus/guia-rapida.html" role="menuitem">📋 Guía Rápida de Reservas</a>
          <a href="${b}amadeus/fxd.html" role="menuitem">🔍 FXD · Master Pricer</a>
          <a href="${b}amadeus/aerolineas.html" role="menuitem">✈️ Cotización por Aerolínea</a>
          <a href="${b}amadeus/reservas-basico.pdf" target="_blank" role="menuitem">📄 Manual Básico PDF</a>
        </div>
      </li>

      <!-- ── HERRAMIENTAS ── -->
      <li role="none">
        <button class="drv-nav-trigger" aria-haspopup="true" aria-expanded="false" role="menuitem">
          🧰 Herramientas ${chevron}
        </button>
        <div class="drv-dropdown" role="menu">
          <span class="drv-dropdown__title">🏨 Hoteles Recomendados</span>
          <a href="${b}hoteles/index.html" role="menuitem">🏨 Ver todos</a>
          <a href="${b}hoteles/cancun-riviera.html" role="menuitem"><span class="flag">🇲🇽</span> Cancún &amp; Riviera Maya</a>
          <a href="${b}hoteles/punta-cana.html" role="menuitem"><span class="flag">🇩🇴</span> Punta Cana</a>
          <hr>
          <span class="drv-dropdown__title">🚌 Traslados</span>
          <a href="${b}herramientas/traslados.html" role="menuitem">🚌 Buscador de Traslados 2026</a>
          <hr>
          <span class="drv-dropdown__title">ℹ️ Info Útil</span>
          <a href="${b}info-util.html" role="menuitem">🌊 Sargazo &amp; Huracanes</a>
          <a href="${b}info-util.html?tab=docs" role="menuitem">📄 Documentación</a>
        </div>
      </li>

    </ul>
    <button class="drv-navbar__hamburger" aria-label="Abrir menú">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
  </div>
</nav>

<!-- Menú móvil -->
<div class="drv-mobile-menu" role="dialog" aria-modal="true">
  <div class="drv-mobile-menu__header">
    <img src="${b}images/logo-color.png" alt="Dr.Viaje" />
    <button class="drv-mobile-menu__close">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="drv-mobile-menu__body">
    <a href="${b}index.html" class="drv-mobile-link">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      Inicio
    </a>

    <span class="drv-mobile-section-title">🌍 Destinos — Sudamérica</span>
    <a href="${b}destinos/bariloche.html" class="drv-mobile-link"><span class="flag">🇦🇷</span> Bariloche</a>
    <a href="${b}destinos/mendoza.html" class="drv-mobile-link"><span class="flag">🇦🇷</span> Mendoza</a>
    <a href="${b}destinos/ushuaia.html" class="drv-mobile-link"><span class="flag">🇦🇷</span> Ushuaia + El Calafate</a>
    <a href="${b}destinos/santiago.html" class="drv-mobile-link"><span class="flag">🇨🇱</span> Santiago de Chile</a>
    <button class="drv-mobile-brasil-toggle">🇧🇷 Brasil
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="drv-mobile-brasil-sub">
      <a href="${b}destinos/brasil-rio.html">🏖️ Río de Janeiro</a>
      <a href="${b}destinos/brasil-bahia.html">🥁 Bahía</a>
      <a href="${b}destinos/brasil-ceara.html">🌊 Ceará</a>
      <a href="${b}destinos/brasil-nordeste.html">🌴 Nordeste</a>
      <a href="${b}destinos/brasil-maranhao.html">🏜️ Maranhão</a>
    </div>

    <span class="drv-mobile-section-title">🏝️ Destinos — Caribe</span>
    <a href="${b}destinos/cancun.html" class="drv-mobile-link"><span class="flag">🇲🇽</span> Cancún / Riviera Maya</a>
    <a href="${b}destinos/dominicana.html" class="drv-mobile-link"><span class="flag">🇩🇴</span> República Dominicana</a>
    <a href="${b}destinos/jamaica.html" class="drv-mobile-link"><span class="flag">🇯🇲</span> Jamaica</a>
    <a href="${b}destinos/aruba.html" class="drv-mobile-link"><span class="flag">🇦🇼</span> Aruba</a>
    <a href="${b}destinos/curazao.html" class="drv-mobile-link"><span class="flag">🇨🇼</span> Curaçao</a>
    <a href="${b}destinos/saint-martin.html" class="drv-mobile-link"><span class="flag">🇫🇷</span> Saint Martin</a>
    <a href="${b}destinos/san-andres.html" class="drv-mobile-link"><span class="flag">🇨🇴</span> San Andrés</a>
    <a href="${b}destinos/cartagena.html" class="drv-mobile-link"><span class="flag">🇨🇴</span> Cartagena de Indias</a>
    <a href="${b}destinos/santa-marta.html" class="drv-mobile-link"><span class="flag">🇨🇴</span> Santa Marta · Tayrona</a>

    <span class="drv-mobile-section-title">🇺🇸 EE.UU. — Costa Este</span>
    <a href="${b}destinos/nueva-york.html" class="drv-mobile-link">🗽 Nueva York</a>
    <a href="${b}destinos/miami-orlando.html" class="drv-mobile-link">🌴 Miami + Orlando</a>
    <a href="${b}destinos/parques-orlando.html" class="drv-mobile-link">🎢 Parques de Orlando</a>
    <span class="drv-mobile-section-title">🇺🇸 EE.UU. — Costa Oeste</span>
    <a href="${b}destinos/los-angeles.html" class="drv-mobile-link">🎬 Los Ángeles</a>
    <a href="${b}destinos/las-vegas.html" class="drv-mobile-link">🎰 Las Vegas</a>
    <a href="${b}destinos/san-francisco.html" class="drv-mobile-link">🌉 San Francisco</a>

    <span class="drv-mobile-section-title">✈️ Amadeus</span>
    <a href="${b}amadeus/guia-rapida.html" class="drv-mobile-link">📋 Guía Rápida de Reservas</a>
    <a href="${b}amadeus/fxd.html" class="drv-mobile-link">🔍 FXD · Master Pricer</a>
    <a href="${b}amadeus/aerolineas.html" class="drv-mobile-link">✈️ Cotización por Aerolínea</a>
    <a href="${b}amadeus/reservas-basico.pdf" target="_blank" class="drv-mobile-link">📄 Manual Básico PDF</a>

    <span class="drv-mobile-section-title">🧰 Herramientas</span>
    <a href="${b}hoteles/index.html" class="drv-mobile-link">🏨 Hoteles Recomendados</a>
    <a href="${b}hoteles/cancun-riviera.html" class="drv-mobile-link"><span class="flag">🇲🇽</span> Cancún &amp; Riviera Maya</a>
    <a href="${b}hoteles/punta-cana.html" class="drv-mobile-link"><span class="flag">🇩🇴</span> Punta Cana</a>
    <a href="${b}herramientas/traslados.html" class="drv-mobile-link">🚌 Buscador de Traslados 2026</a>
    <a href="${b}info-util.html" class="drv-mobile-link">🌊 Sargazo &amp; Huracanes</a>
    <a href="${b}info-util.html?tab=docs" class="drv-mobile-link">📄 Documentación</a>
  </div>
</div>`;
  }

  // ── Helpers DOM ───────────────────────────────────────────
  function qs(sel, ctx)  { return (ctx || document).querySelector(sel); }
  function qsa(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  // ── Dropdowns Desktop ─────────────────────────────────────
  function closeAllDropdowns() {
    qsa('.drv-dropdown').forEach(function (d) { d.classList.remove('open'); });
    qsa('.drv-nav-trigger').forEach(function (b) { b.classList.remove('open'); });
  }

  function initDropdowns() {
    qsa('.drv-nav-trigger').forEach(function (btn) {
      var dropdown = btn.nextElementSibling;
      if (!dropdown) return;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = dropdown.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) {
          dropdown.classList.add('open');
          btn.classList.add('open');
        }
      });
    });
    document.addEventListener('click', closeAllDropdowns);
    qsa('.drv-dropdown').forEach(function (dd) {
      dd.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  }

  // ── Sub-toggle Brasil ─────────────────────────────────────
  function initBrasilToggle() {
    qsa('.brasil-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var sub = btn.nextElementSibling;
        if (!sub) return;
        sub.classList.toggle('open');
        btn.classList.toggle('open');
      });
    });
  }

  // ── Menú Móvil ────────────────────────────────────────────
  function initMobileMenu() {
    var hamburger  = qs('.drv-navbar__hamburger');
    var mobileMenu = qs('.drv-mobile-menu');
    var closeBtn   = qs('.drv-mobile-menu__close');
    if (!hamburger || !mobileMenu) return;

    hamburger.addEventListener('click', function () {
      mobileMenu.classList.add('open');
      document.body.style.overflow = 'hidden';
    });

    function closeMobile() {
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (closeBtn) closeBtn.addEventListener('click', closeMobile);

    // Toggle Brasil en móvil
    var mBrasilBtn = qs('.drv-mobile-brasil-toggle');
    var mBrasilSub = qs('.drv-mobile-brasil-sub');
    if (mBrasilBtn && mBrasilSub) {
      mBrasilBtn.addEventListener('click', function () {
        mBrasilSub.classList.toggle('open');
        mBrasilBtn.classList.toggle('open');
      });
    }
  }

  // ── Marcar enlace activo ──────────────────────────────────
  function markActiveLink() {
    var current = window.location.pathname.split('/').pop();
    qsa('.drv-navbar__menu a, .drv-dropdown a, .drv-mobile-link, .drv-mobile-brasil-sub a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      if (href && href === current) a.classList.add('active');
    });
  }

  // ── Ocultar branding nativo ───────────────────────────────
  function hideNativeBranding() {
    qsa('.badge, .logo, .back-link, .eyebrow').forEach(function (el) {
      var txt = el.textContent.trim();
      if (txt.match(/Dr[\.\s]?Viaje/i) || txt.match(/← Volver/i) || txt.match(/Volver al/i)) {
        el.style.display = 'none';
      }
    });
  }

  // ── Insertar navbar y activar lógica ─────────────────────
  function init() {
    injectCSS(base + 'css/global.css');

    // Insertar navbar al inicio del body
    var wrapper = document.createElement('div');
    wrapper.innerHTML = buildNavbar();
    while (wrapper.firstChild) {
      document.body.insertBefore(wrapper.firstChild, document.body.firstChild);
    }

    // Activar toda la lógica inmediatamente (los elementos ya están en el DOM)
    initDropdowns();
    initBrasilToggle();
    initMobileMenu();
    markActiveLink();
    hideNativeBranding();

    // Exponer por si nav.js también existe en la página
    window.initDrvNav = function () {
      initDropdowns();
      initBrasilToggle();
      initMobileMenu();
      markActiveLink();
    };
  }

  // Ejecutar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
