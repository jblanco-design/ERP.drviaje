# Información Técnica — Dr. Viaje ERP
**Fecha de generación:** 30 de marzo de 2026  
**Versión del sistema:** actual en producción

---

## 🏗️ Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Framework backend | [Hono](https://hono.dev/) | v4.12.9 |
| Runtime | Cloudflare Pages / Workers (Edge Computing) | — |
| Base de datos | Cloudflare D1 (SQLite distribuido) | — |
| Build tool | Vite + @hono/vite-build | v6.3.5 |
| CLI deploy | Wrangler | v4.4.0 |
| Lenguaje | TypeScript | — |
| Gestión de dependencias | npm | — |

---

## 📁 Estructura del Proyecto

```
webapp/
├── src/
│   ├── index.tsx              (78 líneas)    → Entry point, monta todos los routers
│   ├── lib/
│   │   ├── auth.ts            (370 líneas)   → Autenticación, JWT, roles, helpers de permisos
│   │   ├── escape.ts          (42  líneas)   → Sanitización HTML (XSS prevention)
│   │   ├── layout.ts          (340 líneas)   → HTML base layout, sidebar, navegación por rol
│   │   └── ratelimit.ts       (92  líneas)   → Rate limiting para login (D1)
│   └── routes/
│       ├── auth.ts            (207  líneas)  → Login / logout
│       ├── dashboard.ts       (229  líneas)  → Pantalla principal
│       ├── files.ts           (2414 líneas)  → Módulo principal de files de viaje
│       ├── clientes.ts        (850  líneas)  → Gestión de clientes
│       ├── pasajeros.ts       (527  líneas)  → Gestión de pasajeros
│       ├── tesoreria.ts       (2851 líneas)  → Movimientos de caja y pagos a proveedores
│       ├── bancos.ts          (269  líneas)  → Cuentas bancarias y conciliación
│       ├── gastos.ts          (233  líneas)  → Gastos administrativos
│       ├── reportes.ts        (1001 líneas)  → Reportes de ventas y rendimiento
│       └── admin.ts           (832  líneas)  → Usuarios, proveedores, operadores, cotizaciones
├── migrations/
│   ├── 0001_initial.sql                     → Schema base completo
│   ├── 0002_nuevos_estados.sql              → Índice en servicios
│   ├── 0003_login_attempts.sql              → Tabla intentos de login
│   ├── 0004_pasajeros.sql                   → Tablas de pasajeros
│   ├── 0005_dni_documento.sql               → Tipo y número de documento
│   ├── 0006_nombre_apellido.sql             → Nombre/apellido separado en clientes
│   ├── 0007_proveedor_cuenta_corriente.sql  → Cuenta corriente por proveedor
│   ├── 0008_session_blacklist.sql           → Blacklist de sesiones JWT
│   └── 0009_roles_supervisor_admin.sql      → Documentación de nuevos roles
├── wrangler.jsonc                           → Config Cloudflare (D1 binding, name, etc.)
├── vite.config.ts                           → Build config
├── tsconfig.json                            → TypeScript config
├── package.json                             → Dependencias y scripts
└── ecosystem.config.cjs                     → PM2 config (entorno sandbox desarrollo)
```

---

## 🗄️ Modelo de Datos (Tablas D1 / SQLite)

| Tabla | Descripción |
|-------|-------------|
| `usuarios` | Usuarios del sistema (nombre, email, password_hash, rol, activo) |
| `proveedores` | Proveedores de servicios (aerolíneas, hoteles, aseguradoras, etc.) |
| `operadores` | Operadores locales (aeropuertos, hoteles destino, agencias receptivas) |
| `clientes` | Clientes viajeros (nombre, apellido, email, teléfono, tipo/nro documento) |
| `pasajeros` | Pasajeros vinculados a clientes (pueden ser distintos del cliente titular) |
| `files` | Files de viaje (número, cliente, vendedor, estado, destino, moneda, totales) |
| `servicios` | Servicios dentro de un file (aéreo, hotel, traslado, tour, seguro, otro) |
| `file_pasajeros` | Relación N:M — files ↔ pasajeros |
| `servicio_pasajeros` | Relación N:M — servicios ↔ pasajeros |
| `movimientos_caja` | Ingresos y egresos (tipo, método de pago, moneda, monto, banco) |
| `bancos` | Cuentas bancarias (entidad, moneda, saldo inicial) |
| `conciliacion_bancaria` | Conciliación de movimientos con cuentas bancarias |
| `gastos_admin` | Gastos operativos (rrhh, oficina, software, marketing, impuestos, otros) |
| `cotizaciones` | Tipos de cambio USD/UYU por fecha |
| `login_attempts` | Control de intentos fallidos de login por IP (rate limiting) |
| `session_blacklist` | Tokens JWT revocados (logout inmediato y real) |
| `proveedor_cuenta_corriente` | Cuenta corriente de deuda/crédito por proveedor |
| `proveedor_tarjetas` | Tarjetas de crédito vinculadas a proveedores |

### Estados del campo `files.estado`
```
en_proceso → seniado → cerrado
                    ↓
                  anulado  (solo gerente / administración)
```

### Tipos de servicio (`servicios.tipo_servicio`)
```
aereo | hotel | traslado | tour | seguro | otro
```

---

## 🔐 Sistema de Autenticación (`src/lib/auth.ts`)

### Algoritmos y configuración

| Componente | Implementación |
|-----------|---------------|
| Hashing de contraseñas | PBKDF2-SHA256 · 100.000 iteraciones · salt aleatorio 16 bytes |
| Firma de sesión | JWT HMAC-SHA256 (Web Crypto API nativa — sin librerías externas) |
| Duración de sesión | 1 hora, renovación automática (sliding session) |
| Umbral de renovación | Renueva si quedan menos de 15 minutos |
| Revocación de tokens | Blacklist en tabla D1 con hash SHA-256 del token |
| Secret JWT | Variable de entorno `JWT_SECRET` (Cloudflare secret, no en código) |
| Cookie | `auth_token` · HTTP-Only · Secure · SameSite=Strict |

### Payload del JWT
```json
{
  "id":     1,
  "nombre": "Gerente",
  "email":  "gerente@drviaje.com",
  "rol":    "gerente",
  "iat":    1711800000,
  "exp":    1711803600
}
```

### Rate limiting en login
- Tabla `login_attempts` registra intentos por IP
- Bloqueo temporal ante múltiples fallos consecutivos
- Implementado en `src/lib/ratelimit.ts`

---

## 👥 Sistema de Roles y Permisos

### Los 4 roles del sistema

```
gerente         → Acceso total. Único autorizado para crear/editar/desactivar usuarios.
administracion  → Ve y modifica ventas + administración. Puede reabrir files cerrados.
supervisor      → Ve todos los files. Puede cerrar a pérdidas. SIN acceso a tesorería.
vendedor        → Ve solo sus propios files. Sin tesorería ni administración.
```

> **Nota técnica**: El campo `rol` en la tabla `usuarios` es un `TEXT`. La migración
> `0001_initial.sql` tiene `CHECK(rol IN ('gerente', 'vendedor'))` — este constraint
> **no fue actualizado** ya que SQLite no soporta `ALTER TABLE ADD CONSTRAINT`.
> Los roles `supervisor` y `administracion` se insertan y funcionan correctamente,
> pero se recomienda una migración futura que recree la tabla con el constraint correcto.

### Funciones helper exportadas desde `src/lib/auth.ts`

```typescript
// Tipo unión de roles válidos
export type UserRole = 'gerente' | 'administracion' | 'supervisor' | 'vendedor'

// Funciones de verificación de rol
isGerente(rol)           // true solo para 'gerente'
isAdminOrAbove(rol)      // true para 'gerente' | 'administracion'
isSupervisorOrAbove(rol) // true para 'gerente' | 'administracion' | 'supervisor'

// Funciones de permiso específicas
canManageUsers(rol)      // solo 'gerente' → crear/editar/desactivar usuarios
canAccessTesoreria(rol)  // 'gerente' | 'administracion'
canAccessGastos(rol)     // 'gerente' | 'administracion'
canSeeReportes(rol)      // 'gerente' | 'administracion' | 'supervisor'
canSeeAllFiles(rol)      // 'gerente' | 'administracion' | 'supervisor'
canReopenFile(rol)       // 'gerente' | 'administracion'
canCloseAtLoss(rol)      // 'gerente' | 'administracion' | 'supervisor'
canAnularFile(rol)       // 'gerente' | 'administracion'

// Helpers visuales (badge en UI)
rolLabel(rol)            // → "Gerente" | "Administración" | "Supervisor" | "Vendedor"
rolColor(rol)            // → string CSS (gradiente o color sólido)
rolTextColor(rol)        // → color del texto del badge
```

### Matriz de permisos completa

| Acción | vendedor | supervisor | administracion | gerente |
|--------|:--------:|:----------:|:--------------:|:-------:|
| Ver sus propios files | ✅ | ✅ | ✅ | ✅ |
| Ver **todos** los files | ❌ | ✅ | ✅ | ✅ |
| Cerrar file (utilidad positiva) | ✅ | ✅ | ✅ | ✅ |
| Cerrar file **a pérdidas** | ❌ | ✅ | ✅ | ✅ |
| Reabrir file cerrado | ❌ | ❌ | ✅ | ✅ |
| Anular file | ❌ | ❌ | ✅ | ✅ |
| Tesorería / Movimientos de caja | ❌ | ❌ | ✅ | ✅ |
| Pagos a proveedores | ❌ | ❌ | ✅ | ✅ |
| Bancos / Conciliación bancaria | ❌ | ❌ | ✅ | ✅ |
| Gastos administrativos | ❌ | ❌ | ✅ | ✅ |
| Reportes de ventas | ❌ | ✅ | ✅ | ✅ |
| Proveedores / Operadores | ❌ | ❌ | ✅ | ✅ |
| Cotizaciones USD/UYU | ❌ | ❌ | ✅ | ✅ |
| Crear/editar/desactivar usuarios | ❌ | ❌ | ❌ | ✅ |

### Colores de badge por rol (UI)

| Rol | Color |
|-----|-------|
| gerente | Degradado púrpura → rosa `#7B3FA0 → #EC008C` |
| administracion | Degradado azul oscuro → celeste `#1d4ed8 → #0ea5e9` |
| supervisor | Degradado marrón → ámbar `#b45309 → #f59e0b` |
| vendedor | Fondo crema `#fff7ed`, texto naranja oscuro |

---

## 🌐 Rutas y Módulos del Sistema

| Módulo | Rutas principales | Acceso mínimo |
|--------|------------------|---------------|
| auth | `GET/POST /login`, `POST /logout` | Público |
| dashboard | `GET /dashboard` | Cualquier rol |
| files | `GET /files`, `GET /files/:id`, `POST /files`, etc. | Cualquier rol |
| clientes | `GET /clientes`, `GET/POST /clientes/:id` | Cualquier rol |
| pasajeros | `GET /pasajeros`, etc. | Cualquier rol |
| tesoreria | `GET /tesoreria`, `POST /tesoreria/movimiento`, etc. | administracion+ |
| bancos | `GET /bancos`, `POST /bancos` | administracion+ |
| gastos | `GET /gastos`, `POST /gastos` | administracion+ |
| reportes | `GET /reportes` | supervisor+ |
| admin | `GET /usuarios`, `GET /proveedores`, `GET /cotizaciones` | administracion+ |
| admin (usuarios) | `POST /usuarios`, `POST /usuarios/:id/password`, `POST /usuarios/:id/toggle` | gerente only |

---

## 🔄 Flujo de Estados de un File

```
NUEVO → en_proceso
           │
           ▼
        seniado  ←──────────────────────────────┐
           │                                     │
           ▼                                     │ (reabrir: admin/gerente)
        cerrado ─────────────────────────────────┘
           │
           ▼ (anular: admin/gerente)
        anulado
```

**Regla de cierre con pérdida:**
- `total_venta < total_costo` → utilidad negativa
- Un `vendedor` NO puede cerrar → recibe mensaje de error
- Un `supervisor` SÍ puede cerrar + se agrega nota automática: *"Cierre autorizado con pérdida por [nombre] (supervisor) el [fecha]"*
- `administracion` y `gerente` siempre pueden cerrar

---

## ⚙️ Configuración Cloudflare

### wrangler.jsonc
```jsonc
{
  "name": "drviaje-erp",
  "compatibility_date": "2026-03-29",
  "pages_build_output_dir": "./dist",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "drviaje-erp-production",
      "database_id": "326132b9-ff85-4d3f-a849-d9854815f1b3"
    }
  ]
}
```

### Variables de entorno requeridas (Cloudflare Secrets)
| Variable | Uso |
|----------|-----|
| `JWT_SECRET` | Firma HMAC-SHA256 para tokens JWT de sesión |

---

## 🌍 URLs de Producción

| Recurso | URL |
|---------|-----|
| Aplicación principal | `https://drviaje-erp.pages.dev` |
| Cloudflare Dashboard | `https://dash.cloudflare.com` |
| Account ID | `1097a3d5842b0b4359b303c8cfb32575` |
| D1 Database ID | `326132b9-ff85-4d3f-a849-d9854815f1b3` |

---

## 🔑 Credenciales de Acceso Demo

| Usuario | Email | Contraseña | Rol |
|---------|-------|-----------|-----|
| Gerente | `gerente@drviaje.com` | `DrViaje2026` | gerente |
| Jblanco | `jblanco@drviaje.com` | *reset vía panel admin* | vendedor |
| Felix León | `felix@drviaje.com` | *reset vía panel admin* | vendedor |

---

## ⚠️ Puntos de Atención para el Programador

### 1. Constraint de rol desactualizado en schema
La migración `0001_initial.sql` tiene:
```sql
rol TEXT NOT NULL CHECK(rol IN ('gerente', 'vendedor'))
```
SQLite **no soporta** `ALTER TABLE ADD CONSTRAINT`, por lo que el constraint no fue
actualizado. Los roles `supervisor` y `administracion` funcionan correctamente en
la aplicación pero no están validados a nivel de BD.  
**Recomendación:** Crear migración que recree la tabla `usuarios` con el constraint correcto:
```sql
rol TEXT NOT NULL CHECK(rol IN ('gerente', 'administracion', 'supervisor', 'vendedor'))
```

### 2. Token Cloudflare sin permiso de importación D1
El token API de Cloudflare configurado no tiene el permiso `D1:Write` para importar
SQL vía API REST (`--remote`). El seed de datos de prueba se ejecuta a través del
endpoint `/seed-demo` (solo accesible con rol `gerente`) que corre el SQL directamente
desde el Worker.  
**Recomendación:** Actualizar el token en el Cloudflare Dashboard con permisos `D1:Edit`.

### 3. Sin ORM — SQL crudo con prepared statements
Todas las queries usan la API nativa de D1:
```typescript
const result = await env.DB.prepare(
  'SELECT * FROM files WHERE id = ?'
).bind(id).first()
```
No hay ORM ni query builder. Las consultas complejas (JOINs, agregaciones) están
escritas directamente en los archivos de rutas.

### 4. Sin estado en servidor (stateless Workers)
Todo el estado de sesión vive en la cookie JWT + blacklist en D1. No hay memoria
compartida entre instancias de Workers. Cada request valida el token completo.

### 5. Frontend embebido en TypeScript (no hay SPA separada)
No hay un framework frontend (React, Vue, etc.). Todo el HTML se genera en el servidor
con template literals de TypeScript. El CSS usa clases inline + Tailwind CDN.
La interactividad básica (modales, validaciones) se hace con JavaScript inline.

### 6. Archivos grandes
`tesoreria.ts` (2851 líneas) y `files.ts` (2414 líneas) son los módulos más complejos.
Contienen tanto la lógica de negocio como el HTML renderizado, lo que puede dificultar
el mantenimiento. Se recomienda refactorizar separando las vistas de los handlers.

---

## 📦 Dependencias (package.json)

### Producción
```json
{
  "hono": "^4.12.9"
}
```

### Desarrollo
```json
{
  "bcryptjs":                "^3.0.3",
  "jose":                   "^6.2.2",
  "uuid":                   "^13.0.0",
  "@hono/vite-build":        "^1.2.0",
  "@hono/vite-dev-server":   "^0.18.2",
  "@cloudflare/workers-types": "latest",
  "vite":                   "^6.3.5",
  "wrangler":               "^4.4.0",
  "typescript":             "latest"
}
```

> **Nota:** `bcryptjs` y `jose` aparecen como devDependencies pero no se usan en producción.
> La autenticación usa Web Crypto API nativa (compatible con Cloudflare Workers).

---

*Documento generado el 30/03/2026 — Dr. Viaje ERP*
