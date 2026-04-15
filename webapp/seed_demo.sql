-- ============================================================
-- Dr. Viaje ERP — Datos de Prueba / Demo
-- ============================================================

-- ── 1. VENDEDORES (además del gerente existente) ─────────────
INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol, activo) VALUES
  ('Jblanco',   'jblanco@drviaje.com',  'pbkdf2$100000$64656d6f73616c7430303031$a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', 'vendedor', 1),
  ('Felix Leon', 'felix@drviaje.com',   'pbkdf2$100000$64656d6f73616c7430303032$a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', 'vendedor', 1);

-- ── 2. PROVEEDORES ───────────────────────────────────────────
INSERT OR IGNORE INTO proveedores (nombre, tipo, contacto, email, telefono, notas, activo) VALUES
  ('Latam Airlines',          'aéreo',       'Valentina Soto',    'reservas@latam.com',          '+598 2900 1234', 'Proveedor aéreo principal. Política: pago 48hs antes del vuelo.', 1),
  ('Iberia',                  'aéreo',       'Carlos Méndez',     'ventas@iberia.uy',             '+598 2902 5678', 'Vuelos Europa. Descuento agencia 8%.', 1),
  ('Marriott Hoteles',        'hotelero',    'Andrea Pérez',      'reservas@marriott.com',        '+1 800 228 9290', 'Cadena premium. Cancelación gratis hasta 72hs.', 1),
  ('NH Hoteles',              'hotelero',    'Rodrigo Álvarez',   'grupos@nh-hotels.com',         '+598 2916 0101', 'Hoteles en Europa y América Latina. Pago 30 días.', 1),
  ('Transfer Platinum',       'traslado',    'Gustavo Núñez',     'ops@transferplatinum.com.uy',  '+598 099 123 456', 'Traslados premium Montevideo. 24/7. Tarifa fija aeropuerto $60 USD.', 1),
  ('Assist Card',             'seguro',      'Laura Torres',      'empresas@assistcard.com',      '+598 2902 8888', 'Seguro viajero. Límite cobertura $100k USD.', 1),
  ('Buena Vista Tours',       'tour',        'Marcela Giménez',   'reservas@buenavista.uy',       '+598 2480 9900', 'Tours receptivos Uruguay y región.', 1),
  ('Copa Airlines',           'aéreo',       'Diego Fernández',   'ventas@copaair.com',           '+507 217 2672', 'Conexiones Hub Panamá. Bueno para Centroamérica y USA.', 1);

-- ── 3. OPERADORES / PRESTADORES ─────────────────────────────
INSERT OR IGNORE INTO operadores (nombre, tipo, contacto, email, telefono, activo) VALUES
  ('Aeropuerto de Carrasco',  'aeropuerto',  'Info General',       'info@aeropuerto.com.uy',      '+598 2604 0392', 1),
  ('Hotel Sheraton Montevideo','hotel',       'Concierge',          'reservas@sheraton-mdu.com',   '+598 2710 2121', 1),
  ('Radisson Montevideo',     'hotel',       'Reception',          'reservas@radisson-mdu.com',   '+598 2628 6000', 1),
  ('Marriott Madrid',         'hotel',       'Groups Dept.',       'groups@marriott-madrid.com',  '+34 91 310 1090', 1),
  ('NH Collection Roma',      'hotel',       'Sales Office',       'sales@nh-roma.com',           '+39 06 8751 441', 1),
  ('City Tour Montevideo',    'tour',        'Guía: Pablo Ruiz',   'tours@citytour.uy',           '+598 098 765 432', 1),
  ('Tango Show Buenos Aires', 'show',        'Reservas BA',        'reservas@tangoshow.ar',       '+54 11 4300 5500', 1),
  ('Europcar Uruguay',        'rent-a-car',  'Mostrador',          'reservas@europcar.com.uy',    '+598 2604 0111', 1);

-- ── 4. CLIENTES ──────────────────────────────────────────────
INSERT OR IGNORE INTO clientes (nombre_completo, email, telefono, tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte, notas) VALUES
  ('María García López',     'maria.garcia@gmail.com',    '+598 099 211 333', 'PAS', 'URU123456', '1985-03-15', '2029-03-14', 'Prefiere ventanilla. Sin mariscos. Millas Latam Pass #LP887732.'),
  ('Roberto Sánchez Pérez',  'roberto.sanchez@gmail.com', '+598 099 445 667', 'CI',  '3.456.789-0','1978-07-22', NULL,         'Cliente frecuente. Viaja por negocios. Siempre suite.'),
  ('Ana Martínez de Silva',  'ana.martinez@outlook.com',  '+598 091 334 556', 'PAS', 'URU234567', '1990-11-08', '2027-11-07', 'Viaja con familia (2 menores). Dieta vegetariana.'),
  ('Carlos Fernández Ruiz',  'carlos.fernandez@gmail.com','+598 098 778 990', 'CI',  '4.567.890-1','1965-05-30', NULL,         'Jubilado. Prefiere vuelos directos. Seguro siempre.'),
  ('Sofía Rodríguez Méndez', 'sofia.rodriguez@yahoo.com', '+598 095 123 789', 'PAS', 'URU345678', '1995-09-12', '2028-09-11', 'Primera vez viajando al exterior. Entusiasta. Quiere todo incluido.');

-- ── 5. PASAJEROS (vinculados a los clientes) ─────────────────
INSERT OR IGNORE INTO pasajeros (nombre_completo, tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte, nacionalidad, email, telefono, cliente_id) VALUES
  ('María García López',     'PAS', 'URU123456', '1985-03-15', '2029-03-14', 'Uruguaya', 'maria.garcia@gmail.com',    '+598 099 211 333', 1),
  ('Roberto Sánchez Pérez',  'CI',  '3456789',   '1978-07-22', NULL,         'Uruguayo', 'roberto.sanchez@gmail.com', '+598 099 445 667', 2),
  ('Ana Martínez de Silva',  'PAS', 'URU234567', '1990-11-08', '2027-11-07', 'Uruguaya', 'ana.martinez@outlook.com',  '+598 091 334 556', 3),
  ('Tomás Martínez',         'CI',  '5678901',   '2015-04-20', NULL,         'Uruguayo', NULL,                        NULL,              3),
  ('Valentina Martínez',     'CI',  '6789012',   '2018-08-10', NULL,         'Uruguaya', NULL,                        NULL,              3),
  ('Carlos Fernández Ruiz',  'CI',  '4567890',   '1965-05-30', NULL,         'Uruguayo', 'carlos.fernandez@gmail.com','+598 098 778 990', 4),
  ('Sofía Rodríguez Méndez', 'PAS', 'URU345678', '1995-09-12', '2028-09-11', 'Uruguaya', 'sofia.rodriguez@yahoo.com', '+598 095 123 789', 5);

-- ── 6. BANCOS / CUENTAS ──────────────────────────────────────
INSERT OR IGNORE INTO bancos (nombre_entidad, nro_cuenta, moneda, saldo_inicial, activo) VALUES
  ('BROU Cuenta Corriente USD',  '001-0012345-6', 'USD', 15000.00, 1),
  ('Santander Cuenta USD',       '072-9876543-1', 'USD',  8000.00, 1),
  ('BROU Cuenta Corriente UYU',  '001-0012346-8', 'UYU', 320000.00, 1);

-- ── 7. FILES ─────────────────────────────────────────────────
-- Necesitamos los IDs reales de usuarios y clientes
-- Asumimos: gerente id=1, jblanco id=2, felix id=3
-- clientes 1-5 como fueron insertados

-- File 1: Viaje a Madrid (cerrado, utilidad positiva) — Jblanco
INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES
  ('F-2026-001', 1, 2, 'cerrado', '2026-03-01', '2026-04-10', 'MAD', 'USD', 4850.00, 3620.00, 'Viaje de placer 10 días. Madrid y alrededores. Cliente muy satisfecha.');

-- File 2: Viaje a Buenos Aires (seniado) — Felix Leon
INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES
  ('F-2026-002', 2, 3, 'seniado', '2026-03-05', '2026-04-25', 'EZE', 'USD', 1200.00, 900.00, 'Viaje negocios 4 días. Hotel Sheraton BA. Seña 50% recibida.');

-- File 3: Europa en familia (en proceso) — Jblanco
INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES
  ('F-2026-003', 3, 2, 'en_proceso', '2026-03-10', '2026-07-15', 'MAD', 'USD', 9200.00, 7100.00, '3 pasajeros (adulta + 2 menores). Madrid → Roma 14 días. En cotización.');

-- File 4: Punta del Este (cerrado) — Felix Leon
INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES
  ('F-2026-004', 4, 3, 'cerrado', '2026-03-12', '2026-03-20', 'PDP', 'USD', 680.00, 520.00, 'Fin de semana largo Punta del Este. Hotel + traslados.');

-- File 5: Cancún todo incluido (en proceso) — Gerente
INSERT OR IGNORE INTO files (numero, cliente_id, vendedor_id, estado, fecha_apertura, fecha_viaje, destino_principal, moneda, total_venta, total_costo, notas) VALUES
  ('F-2026-005', 5, 1, 'en_proceso', '2026-03-15', '2026-06-01', 'CUN', 'USD', 2800.00, 2100.00, 'Primera vez viajando. Todo incluido. Necesita asistencia completa.');

-- ── 8. SERVICIOS (por file) ───────────────────────────────────

-- FILE 1: Madrid (F-2026-001) — aéreo + hotel + seguro
INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES
  (1, 'aereo',   'MVD → MAD → MVD / Latam LA 701 / LA 702',           1, 1, 'MAD', 'LA-7012026A', '2026-04-10', '2026-04-20', 1850.00, 'USD', 2400.00, 1, 1, 'confirmado'),
  (1, 'hotel',   'Marriott Madrid Gran Vía - 10 noches (dbl sup)',      3, 4, 'MAD', NULL,           '2026-04-10', '2026-04-20', 1450.00, 'USD', 1950.00, 1, 1, 'confirmado'),
  (1, 'seguro',  'Assist Card Internacional - 10 días - Plan Gold',     6, NULL,'MAD', NULL,          '2026-04-10', '2026-04-20',  320.00, 'USD',  500.00, 0, 0, 'confirmado');

-- FILE 2: Buenos Aires (F-2026-002) — aéreo + hotel + traslado
INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES
  (2, 'aereo',   'MVD → EZE → MVD / Copa CM 305 / CM 306',            8, 1, 'EZE', 'CM-3052026B', '2026-04-25', '2026-04-29',  420.00, 'USD',  560.00, 1, 0, 'confirmado'),
  (2, 'hotel',   'Sheraton Buenos Aires - 4 noches (executive floor)',  3, NULL, 'EZE', NULL,         '2026-04-25', '2026-04-29',  380.00, 'USD',  520.00, 1, 0, 'confirmado'),
  (2, 'traslado','Traslado aeropuerto Ezeiza ↔ hotel (ida y vuelta)',   5, NULL, 'EZE', NULL,         '2026-04-25', '2026-04-29',  100.00, 'USD',  120.00, 0, 0, 'pendiente');

-- FILE 3: Europa familia (F-2026-003) — aéreo + 2 hoteles + seguro + tour
INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES
  (3, 'aereo',   'MVD → MAD → MVD / Iberia IB 6839 x3 pax',           2, 1, 'MAD', NULL,            '2026-07-15', '2026-07-29', 3600.00, 'USD', 4500.00, 1, 0, 'pendiente'),
  (3, 'hotel',   'NH Madrid Zurbano - 7 noches - habitación familiar',  4, NULL, 'MAD', NULL,          '2026-07-15', '2026-07-22', 1750.00, 'USD', 2100.00, 1, 0, 'pendiente'),
  (3, 'hotel',   'NH Collection Roma Fori Imperiali - 7 noches - fam', 4, 5, 'FCO', NULL,            '2026-07-22', '2026-07-29', 1400.00, 'USD', 1800.00, 1, 0, 'pendiente'),
  (3, 'seguro',  'Assist Card Familiar Europa - 14 días x3 pax',        6, NULL,'MAD', NULL,           '2026-07-15', '2026-07-29',  350.00, 'USD',  800.00, 0, 0, 'pendiente');

-- FILE 4: Punta del Este (F-2026-004) — traslado + hotel
INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES
  (4, 'traslado','Traslado Montevideo ↔ Punta del Este (ida y vuelta)', 5, NULL,'PDP', NULL,           '2026-03-20', '2026-03-22',  120.00, 'USD',  160.00, 0, 0, 'confirmado'),
  (4, 'hotel',   'Marriott Punta del Este - 2 noches (ocean view dbl)', 3, NULL,'PDP', NULL,           '2026-03-20', '2026-03-22',  400.00, 'USD',  520.00, 1, 1, 'confirmado');

-- FILE 5: Cancún (F-2026-005) — aéreo + hotel + tour + seguro
INSERT OR IGNORE INTO servicios (file_id, tipo_servicio, descripcion, proveedor_id, operador_id, destino_codigo, nro_ticket, fecha_inicio, fecha_fin, costo_original, moneda_origen, precio_venta, requiere_prepago, prepago_realizado, estado) VALUES
  (5, 'aereo',   'MVD → CUN → MVD / Copa + LATAM (conexión PTY)',      8, 1, 'CUN', NULL,            '2026-06-01', '2026-06-08',  980.00, 'USD', 1300.00, 1, 0, 'pendiente'),
  (5, 'hotel',   'Hotel Moon Palace Cancún - Todo Incluido - 7 noches', 3, NULL,'CUN', NULL,           '2026-06-01', '2026-06-08',  980.00, 'USD', 1200.00, 1, 0, 'pendiente'),
  (5, 'tour',    'Tour Chichén Itzá + Cenote + almuerzo',               7, NULL,'CUN', NULL,           '2026-06-04', '2026-06-04',   95.00, 'USD',  180.00, 0, 0, 'pendiente'),
  (5, 'seguro',  'Assist Card Américas - 7 días - Plan Standard',       6, NULL,'CUN', NULL,           '2026-06-01', '2026-06-08',   45.00, 'USD',  120.00, 0, 0, 'pendiente');

-- ── 9. PASAJEROS en FILES ────────────────────────────────────
INSERT OR IGNORE INTO file_pasajeros (file_id, pasajero_id, rol, grupo, orden) VALUES
  -- File 1: María García
  (1, 1, 'titular', 'García', 1),
  -- File 2: Roberto Sánchez
  (2, 2, 'titular', 'Sánchez', 1),
  -- File 3: Ana Martínez + 2 hijos
  (3, 3, 'titular',     'Martínez', 1),
  (3, 4, 'acompañante', 'Martínez', 2),
  (3, 5, 'acompañante', 'Martínez', 3),
  -- File 4: Carlos Fernández
  (4, 6, 'titular', 'Fernández', 1),
  -- File 5: Sofía Rodríguez
  (5, 7, 'titular', 'Rodríguez', 1);

-- ── 10. PASAJEROS en SERVICIOS ───────────────────────────────
-- File 1 servicios (ids 1,2,3) → pasajero 1
INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES (1,1),(2,1),(3,1);
-- File 2 servicios (ids 4,5,6) → pasajero 2
INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES (4,2),(5,2),(6,2);
-- File 3 servicios (ids 7,8,9,10) → pasajeros 3,4,5
INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES
  (7,3),(7,4),(7,5),(8,3),(8,4),(8,5),(9,3),(9,4),(9,5),(10,3),(10,4),(10,5);
-- File 4 servicios (ids 11,12) → pasajero 6
INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES (11,6),(12,6);
-- File 5 servicios (ids 13,14,15,16) → pasajero 7
INSERT OR IGNORE INTO servicio_pasajeros (servicio_id, pasajero_id) VALUES (13,7),(14,7),(15,7),(16,7);

-- ── 11. MOVIMIENTOS DE CAJA (cobros de clientes) ─────────────

-- File 1 (cerrado): cobrado en 2 cuotas
INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, concepto, referencia, anulado, usuario_id, fecha) VALUES
  ('ingreso','transferencia','USD', 2425.00, 42.50, 103062.50, 1, 1, 'Seña 50% File F-2026-001 - María García - Madrid',      'TRF-001-A', 0, 2, '2026-03-03'),
  ('ingreso','transferencia','USD', 2425.00, 42.50, 103062.50, 1, 1, 'Saldo 50% File F-2026-001 - María García - Madrid',     'TRF-001-B', 0, 2, '2026-03-25');

-- File 2 (seniado): cobrada la seña
INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, concepto, referencia, anulado, usuario_id, fecha) VALUES
  ('ingreso','efectivo',    'USD',  600.00, 42.80,  25680.00, 2, 2, 'Seña 50% File F-2026-002 - Roberto Sánchez - BA',      'EFE-002-A', 0, 3, '2026-03-07');

-- File 4 (cerrado): cobrado completo
INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, cliente_id, concepto, referencia, anulado, usuario_id, fecha) VALUES
  ('ingreso','tarjeta',     'USD',  680.00, 43.00,  29240.00, 4, 4, 'Pago total File F-2026-004 - Carlos Fernández - PdE', 'TC-004-A',  0, 3, '2026-03-14');

-- ── 12. PAGOS A PROVEEDORES (egresos) ────────────────────────
-- Pago hotel Madrid File 1
INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, proveedor_id, concepto, referencia, anulado, usuario_id, fecha) VALUES
  ('egreso','transferencia','USD', 1450.00, 42.50, 61625.00, 1, 3, 'Pago Marriott Madrid - 10 noches F-2026-001',           'TRF-PROV-001', 0, 1, '2026-03-20');
-- Pago aéreo Madrid File 1
INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, proveedor_id, concepto, referencia, anulado, usuario_id, fecha) VALUES
  ('egreso','transferencia','USD', 1850.00, 42.50, 78625.00, 1, 1, 'Pago Latam Airlines - vuelos MAD F-2026-001',           'TRF-PROV-002', 0, 1, '2026-03-15');
-- Pago hotel PdE File 4
INSERT OR IGNORE INTO movimientos_caja (tipo, metodo, moneda, monto, cotizacion, monto_uyu, file_id, proveedor_id, concepto, referencia, anulado, usuario_id, fecha) VALUES
  ('egreso','transferencia','USD',  400.00, 43.00, 17200.00, 4, 3, 'Pago Marriott Punta del Este F-2026-004',               'TRF-PROV-003', 0, 1, '2026-03-18');

-- ── 13. GASTOS ADMINISTRATIVOS ───────────────────────────────
INSERT OR IGNORE INTO gastos_admin (rubro, descripcion, monto, moneda, fecha, proveedor, usuario_id) VALUES
  ('rrhh',      'Sueldos Marzo 2026',                          85000.00, 'UYU', '2026-03-31', 'Nómina interna',       1),
  ('oficina',   'Alquiler oficina Colonia 820 - Marzo 2026',   28000.00, 'UYU', '2026-03-05', 'Propietario Garmendia',1),
  ('software',  'Suscripción Amadeus GDS - Marzo',               350.00, 'USD', '2026-03-01', 'Amadeus IT Group',     1),
  ('marketing', 'Publicidad Instagram + Facebook - Marzo',       180.00, 'USD', '2026-03-10', 'Meta Ads',             1),
  ('oficina',   'Internet + Teléfono Antel - Marzo',            3200.00, 'UYU', '2026-03-15', 'Antel',                1),
  ('impuestos', 'IVA servicios turísticos Q1 2026',             12500.00, 'UYU', '2026-03-20', 'DGI',                  1);

-- ── 14. COTIZACIONES USD/UYU ─────────────────────────────────
INSERT OR IGNORE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES
  ('2026-03-01', 'USD', 'UYU', 42.50),
  ('2026-03-05', 'USD', 'UYU', 42.65),
  ('2026-03-10', 'USD', 'UYU', 42.80),
  ('2026-03-15', 'USD', 'UYU', 43.00),
  ('2026-03-20', 'USD', 'UYU', 43.10),
  ('2026-03-25', 'USD', 'UYU', 43.25),
  ('2026-03-28', 'USD', 'UYU', 43.30),
  ('2026-03-30', 'USD', 'UYU', 43.35);
