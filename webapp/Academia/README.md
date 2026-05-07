# Dr.Viaje — Centro de Capacitación para Vendedores

Plataforma estática de uso interno para la capacitación del equipo de ventas de Dr.Viaje.com.

## 🎯 Objetivo
Proveer a los vendedores una guía navegable con información comercial detallada de cada destino, organizada por región, con el branding unificado de Dr.Viaje.

---

## ✅ Funcionalidades implementadas

- **Página de inicio (index.html)** con:
  - Hero visual con logo a color, estadísticas y llamado a la acción
  - Filtro interactivo de destinos por región (Todos / Sudamérica / Brasil / Caribe)
  - Grid de 14 destinos con cards diferenciadas por región
  - Sección "Cómo usar la plataforma" (4 pasos)
  - Footer con logo blanco

- **Navbar global sticky** con:
  - Logo Dr.Viaje (color en index, adaptado en destinos)
  - Menú desktop con dropdowns por región
  - Submenú expandible para Brasil (5 destinos)
  - Menú hamburger para mobile con overlay completo
  - Detección automática del enlace activo

- **14 destinos disponibles** con guías HTML completas
- **Sección Info Útil** (`info-util.html`) con:
  - Guía de sargazo y temporada de huracanes (tablas de probabilidad, mapa por destino, objeciones, script de venta)
  - Guía orientativa de documentación para pasajeros desde Uruguay (adultos, menores, vacunas, checklist, enlaces oficiales)
- **Sección Hoteles Recomendados** (`hoteles/`) con:
  - Índice de destinos con hoteles disponibles
  - Guía Cancún / Riviera Maya: 16 hoteles en 3 zonas con perfiles, argumentos y upsells
  - Guía Punta Cana: 9 cadenas con comparativa, Sun Club y tabla de lectura rápida
- **Botón "Ver hoteles recomendados"** en las páginas de Cancún y Dominicana
- **Navbar actualizado** con entradas para Hoteles e Info Útil (desktop y mobile)

---

## 🗂️ Estructura de archivos

```
index.html                    ← Página principal
info-util.html                ← Info Útil (sargazo + documentación)
css/
  global.css                  ← Estilos del navbar global
js/
  nav.js                      ← Lógica de interacción del navbar
  navbar-inject.js            ← Inyector automático del navbar en destinos
images/
  logo-color.png              ← Logo Dr.Viaje a color
  logo-white.png              ← Logo Dr.Viaje en blanco (footer)
destinos/
  cancun.html                 ← Cancún / Riviera Maya 🇲🇽
  dominicana.html             ← República Dominicana 🇩🇴
  jamaica.html                ← Jamaica 🇯🇲
  aruba.html                  ← Aruba 🇦🇼
  curazao.html                ← Curaçao 🇨🇼
  bariloche.html              ← Bariloche 🇦🇷
  mendoza.html                ← Mendoza 🇦🇷
  ushuaia.html                ← Ushuaia + El Calafate 🇦🇷
  santiago.html               ← Santiago de Chile 🇨🇱
  brasil-rio.html             ← Río de Janeiro + Costa Verde 🇧🇷
  brasil-bahia.html           ← Bahía 🇧🇷
  brasil-ceara.html           ← Ceará 🇧🇷
  brasil-nordeste.html        ← Nordeste de Brasil 🇧🇷
  brasil-maranhao.html        ← Maranhão 🇧🇷
hoteles/
  index.html                  ← Índice de hoteles recomendados
  cancun-riviera.html         ← Hoteles Cancún / Riviera Maya / Costa Mujeres
  punta-cana.html             ← Hoteles Punta Cana
```

---

## 🧭 Navegación y rutas

| Ruta | Descripción |
|------|-------------|
| `index.html` | Página principal con todos los destinos |
| `info-util.html` | Info Útil: sargazo, huracanes y documentación |
| `hoteles/index.html` | Índice de hoteles recomendados |
| `hoteles/cancun-riviera.html` | Hoteles Cancún, Riviera Maya y Costa Mujeres |
| `hoteles/punta-cana.html` | Hoteles Punta Cana |
| `destinos/cancun.html` | Guía Cancún / Riviera Maya |
| `destinos/dominicana.html` | Guía República Dominicana |
| `destinos/jamaica.html` | Guía Jamaica |
| `destinos/aruba.html` | Guía Aruba |
| `destinos/curazao.html` | Guía Curaçao |
| `destinos/bariloche.html` | Guía Bariloche |
| `destinos/mendoza.html` | Guía Mendoza |
| `destinos/ushuaia.html` | Guía Ushuaia + El Calafate |
| `destinos/santiago.html` | Guía Santiago de Chile |
| `destinos/brasil-rio.html` | Guía Río de Janeiro + Costa Verde |
| `destinos/brasil-bahia.html` | Guía Bahía |
| `destinos/brasil-ceara.html` | Guía Ceará |
| `destinos/brasil-nordeste.html` | Guía Nordeste Brasil |
| `destinos/brasil-maranhao.html` | Guía Maranhão |

---

## 🎨 Identidad visual

| Color | Uso | Hex |
|-------|-----|-----|
| Púrpura | Color principal, navbar, botones | `#7B2D8E` |
| Naranja | Acento, "Dr." del logo | `#FF9800` |
| Magenta/Pink | Acento secundario, ".com" del logo | `#E91E63` |
| Verde | Cards Brasil | `#388E3C` |
| Azul | Cards Caribe | `#0288D1` |

---

## 🚀 Próximas mejoras sugeridas

- [ ] Agregar guías de hoteles para Jamaica, Aruba y Brasil
- [ ] Agregar buscador de destinos con autocompletado
- [ ] Implementar sistema de favoritos (localStorage)
- [ ] Agregar página de quizzes de capacitación por destino
- [ ] Ampliar sección Info Útil con documentación para Argentina y otros países
- [ ] Sección de comparativa entre destinos similares
- [ ] Agregar más destinos: Europa, Asia, USA
- [ ] Implementar modo oscuro
- [ ] Agregar videos informativos por destino
- [ ] Sección de "Novedades" o noticias de destinos

---

## 📅 Última actualización
Marzo 2026
