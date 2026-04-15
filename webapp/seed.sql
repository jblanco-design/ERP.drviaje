-- Datos de prueba para Dr. Viaje ERP
-- Contraseña para todos los usuarios de prueba: DrViaje2024!
-- Hash WebCrypto SHA256 de "DrViaje2024!" + "drviaje-erp-secret-2024-ultra-secure"

-- Usuario vendedor de prueba
INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol) VALUES 
  ('María González', 'maria@drviaje.com', '45e4b30a042c10d3abf4054e72a882fc00547cdca716e5cfd367af838d702f6d', 'vendedor'),
  ('Carlos Rodríguez', 'carlos@drviaje.com', '45e4b30a042c10d3abf4054e72a882fc00547cdca716e5cfd367af838d702f6d', 'vendedor');

-- Proveedores
INSERT OR IGNORE INTO proveedores (nombre, email, telefono, contacto) VALUES 
  ('Abtour', 'ventas@abtour.com.uy', '+598 2902 0000', 'Departamento Comercial'),
  ('Sevens Viajes', 'ops@sevens.com.uy', '+598 2916 0000', 'Operaciones'),
  ('Despegar Uruguay', 'b2b@despegar.com', '+598 2601 0000', 'B2B'),
  ('iVisa', 'info@ivisa.com', '+1 800 000 0000', 'Soporte');

-- Operadores / Prestadores
INSERT OR IGNORE INTO operadores (nombre, tipo) VALUES 
  ('LATAM Airlines', 'Aerolínea'),
  ('Copa Airlines', 'Aerolínea'),
  ('American Airlines', 'Aerolínea'),
  ('Grand Palladium', 'Hotel All Inclusive'),
  ('Barceló Hotels', 'Hotel'),
  ('RIU Hotels', 'Hotel All Inclusive'),
  ('Transfers Do Brasil', 'Traslados'),
  ('Turiscar', 'Traslados'),
  ('Assist Card', 'Seguro de Viaje'),
  ('Blue Cross', 'Seguro de Viaje');

-- Clientes de prueba
INSERT OR IGNORE INTO clientes (nombre_completo, email, telefono, tipo_documento, nro_documento, fecha_nacimiento, vencimiento_pasaporte, preferencias_comida, millas_aerolineas) VALUES 
  ('Juan García Martínez', 'juan.garcia@gmail.com', '+598 9912 3456', 'CI', '12345678', '1985-03-15', '2027-06-20', 'Ninguna', 'LATAM: LTM0001234'),
  ('Ana Rodríguez López', 'ana.rodriguez@hotmail.com', '+598 9923 4567', 'PAS', 'UY1234567', '1990-07-22', '2025-11-30', 'Vegetariana', ''),
  ('Pedro Fernández', 'pedro.fern@gmail.com', '+598 9934 5678', 'CI', '23456789', '1978-12-01', '2028-03-15', 'Ninguna', 'Copa: CM9876543'),
  ('Laura Méndez', 'lau.mendez@gmail.com', '+598 9945 6789', 'CI', '34567890', '1995-05-10', '2026-08-25', 'Sin gluten', '');

-- Cotización del día
INSERT OR IGNORE INTO cotizaciones (fecha, moneda_origen, moneda_destino, valor) VALUES 
  (date('now'), 'USD', 'UYU', 43.50),
  (date('now'), 'EUR', 'UYU', 47.20),
  (date('now'), 'EUR', 'USD', 1.085);

-- Banco de prueba
INSERT OR IGNORE INTO bancos (nombre_entidad, nro_cuenta, moneda, saldo_inicial) VALUES 
  ('Banco Itaú Uruguay', '0001-001234-56', 'USD', 15000.00),
  ('Banco Santander', '0002-005678-90', 'UYU', 250000.00);
