/**
 * cache.ts — Caché en memoria para datos estáticos del ERP
 *
 * Cloudflare Workers mantiene instancias vivas entre requests del mismo
 * datacenter. Esta caché evita consultar D1 en cada request para datos
 * que cambian muy poco (proveedores, operadores, bancos, cotizaciones).
 *
 * TTL por defecto: 5 minutos. Al agregar/editar un proveedor/banco/etc
 * se debe llamar invalidateCache(key) para forzar recarga.
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const store = new Map<string, CacheEntry<any>>()

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutos

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.data as T
}

export function cacheSet<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export function invalidateCache(key: string): void {
  store.delete(key)
}

export function invalidateCachePrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}

/**
 * getOrFetch — helper: devuelve del caché o ejecuta fn() y cachea el resultado.
 * Uso:
 *   const proveedores = await getOrFetch('proveedores', () =>
 *     db.prepare('SELECT id, nombre FROM proveedores WHERE activo=1').all()
 *   )
 */
export async function getOrFetch<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const cached = cacheGet<T>(key)
  if (cached !== null) return cached
  const data = await fn()
  cacheSet(key, data, ttlMs)
  return data
}
