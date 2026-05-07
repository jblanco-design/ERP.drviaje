/**
 * Dr.Viaje — Script de navegación global
 * Maneja dropdowns desktop y menú móvil
 */

(function () {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  // ── Dropdowns Desktop ─────────────────────────────────────
  function initDropdowns() {
    $$('.drv-nav-trigger').forEach(function (btn) {
      var dropdown = btn.nextElementSibling;
      if (!dropdown) return;

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = dropdown.classList.contains('open');
        // Cerrar todos
        closeAllDropdowns();
        if (!isOpen) {
          dropdown.classList.add('open');
          btn.classList.add('open');
        }
      });
    });

    // Click fuera = cerrar
    document.addEventListener('click', closeAllDropdowns);

    // Evitar cierre al hacer click dentro del dropdown
    $$('.drv-dropdown').forEach(function (dd) {
      dd.addEventListener('click', function (e) { e.stopPropagation(); });
    });
  }

  function closeAllDropdowns() {
    $$('.drv-dropdown').forEach(function (d) { d.classList.remove('open'); });
    $$('.drv-nav-trigger').forEach(function (b) { b.classList.remove('open'); });
  }

  // ── Sub-toggle Brasil (dentro del dropdown) ───────────────
  function initBrasilToggle() {
    $$('.brasil-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var sub = btn.nextElementSibling;
        if (!sub) return;
        var isOpen = sub.classList.contains('open');
        sub.classList.toggle('open', !isOpen);
        btn.classList.toggle('open', !isOpen);
      });
    });
  }

  // ── Menú móvil ────────────────────────────────────────────
  function initMobileMenu() {
    var hamburger = $('.drv-navbar__hamburger');
    var mobileMenu = $('.drv-mobile-menu');
    var closeBtn   = $('.drv-mobile-menu__close');

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

    // Toggle Brasil móvil
    var mBrasilBtn = $('.drv-mobile-brasil-toggle');
    var mBrasilSub = $('.drv-mobile-brasil-sub');
    if (mBrasilBtn && mBrasilSub) {
      mBrasilBtn.addEventListener('click', function () {
        var isOpen = mBrasilSub.classList.contains('open');
        mBrasilSub.classList.toggle('open', !isOpen);
        mBrasilBtn.classList.toggle('open', !isOpen);
      });
    }
  }

  // ── Marcar enlace activo ──────────────────────────────────
  function markActiveLink() {
    var current = window.location.pathname.split('/').pop();
    $$('.drv-navbar__menu a, .drv-dropdown a, .drv-mobile-link, .drv-mobile-brasil-sub a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      if (href && href === current) {
        a.classList.add('active');
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────
  function initAll() {
    initDropdowns();
    initBrasilToggle();
    initMobileMenu();
    markActiveLink();
  }

  // Exponer para llamado externo (navbar-inject.js)
  window.initDrvNav = initAll;

  document.addEventListener('DOMContentLoaded', initAll);

})();
