-- Esquema inicial. PostgreSQL es la fuente de verdad; Kafka es el transporte.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE alert_severity AS ENUM ('INFO', 'WATCH', 'WARNING', 'CRITICAL');

-- Catálogo geográfico (claves INEGI) ----------------------------------------
CREATE TABLE estados (
  cve_ent  CHAR(2) PRIMARY KEY,
  nombre   TEXT NOT NULL,
  hashtag  TEXT NOT NULL UNIQUE
);

CREATE TABLE municipios (
  cve_mun  CHAR(5) PRIMARY KEY,           -- cve_ent + cve_mun de 3 dígitos
  cve_ent  CHAR(2) NOT NULL REFERENCES estados(cve_ent),
  nombre   TEXT NOT NULL,
  hashtag  TEXT NOT NULL,
  lat      DOUBLE PRECISION,              -- centroides: se cargan en Fase 3 desde INEGI
  lon      DOUBLE PRECISION
);
CREATE INDEX idx_mun_ent ON municipios(cve_ent);

-- Usuarios y dispositivos ----------------------------------------------------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  cve_mun        CHAR(5) REFERENCES municipios(cve_mun),
  is_simulated   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_zones (                  -- zonas suscritas: casa, trabajo, familia...
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cve_mun  CHAR(5) NOT NULL REFERENCES municipios(cve_mun),
  label    TEXT NOT NULL DEFAULT 'Casa',
  PRIMARY KEY (user_id, cve_mun)
);

CREATE TABLE devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'sim')),
  push_kind     TEXT CHECK (push_kind IN ('fcm', 'webpush', 'expo')),
  push_token    TEXT,
  last_seq_ack  BIGINT NOT NULL DEFAULT 0,  -- última alerta confirmada: base de la re-sincronización
  last_seen     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_user ON devices(user_id);

-- Alertas --------------------------------------------------------------------
CREATE TABLE alerts (
  seq           BIGSERIAL PRIMARY KEY,      -- orden global; el cliente detecta huecos con esto
  id            UUID NOT NULL UNIQUE,       -- deduplicación (at-least-once)
  external_id   TEXT,                       -- id en la API de origen (USGS, NHC...)
  type          TEXT NOT NULL,
  severity      alert_severity NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  source        TEXT NOT NULL,
  lat           DOUBLE PRECISION,
  lon           DOUBLE PRECISION,
  radius_km     DOUBLE PRECISION,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  payload       JSONB NOT NULL,             -- el JSON original completo
  created_at    TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  stored_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_alerts_external ON alerts(source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE alert_targets (                -- a qué municipios aplica cada alerta
  alert_seq  BIGINT NOT NULL REFERENCES alerts(seq) ON DELETE CASCADE,
  cve_mun    CHAR(5) NOT NULL,
  PRIMARY KEY (alert_seq, cve_mun)
);
CREATE INDEX idx_targets_mun_seq ON alert_targets(cve_mun, alert_seq);

CREATE TABLE alert_acks (
  alert_id     UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  received_at  TIMESTAMPTZ,
  acked_at     TIMESTAMPTZ,                -- "Enterado" en alertas críticas
  PRIMARY KEY (alert_id, device_id)
);

-- Chat global y check-ins ----------------------------------------------------
CREATE TABLE chat_messages (
  seq         BIGSERIAL PRIMARY KEY,
  id          UUID NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('message', 'checkin_ok', 'checkin_help')),
  text        TEXT NOT NULL DEFAULT '',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  alert_id    UUID REFERENCES alerts(id) ON DELETE SET NULL,
  cve_mun     CHAR(5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_tags ON chat_messages USING GIN (tags);
CREATE INDEX idx_chat_alert ON chat_messages(alert_id);

-- Datos semilla: 32 entidades federativas (claves INEGI) ---------------------
INSERT INTO estados (cve_ent, nombre, hashtag) VALUES
('01','Aguascalientes','#Aguascalientes'), ('02','Baja California','#BajaCalifornia'),
('03','Baja California Sur','#BajaCaliforniaSur'), ('04','Campeche','#Campeche'),
('05','Coahuila de Zaragoza','#Coahuila'), ('06','Colima','#Colima'),
('07','Chiapas','#Chiapas'), ('08','Chihuahua','#Chihuahua'),
('09','Ciudad de México','#CDMX'), ('10','Durango','#Durango'),
('11','Guanajuato','#Guanajuato'), ('12','Guerrero','#Guerrero'),
('13','Hidalgo','#Hidalgo'), ('14','Jalisco','#Jalisco'),
('15','México','#EdoMex'), ('16','Michoacán de Ocampo','#Michoacán'),
('17','Morelos','#Morelos'), ('18','Nayarit','#Nayarit'),
('19','Nuevo León','#NuevoLeón'), ('20','Oaxaca','#Oaxaca'),
('21','Puebla','#Puebla'), ('22','Querétaro','#Querétaro'),
('23','Quintana Roo','#QuintanaRoo'), ('24','San Luis Potosí','#SanLuisPotosí'),
('25','Sinaloa','#Sinaloa'), ('26','Sonora','#Sonora'),
('27','Tabasco','#Tabasco'), ('28','Tamaulipas','#Tamaulipas'),
('29','Tlaxcala','#Tlaxcala'), ('30','Veracruz de Ignacio de la Llave','#Veracruz'),
('31','Yucatán','#Yucatán'), ('32','Zacatecas','#Zacatecas');

-- Municipios de Colima para las primeras pruebas (el catálogo completo se carga en Fase 3)
INSERT INTO municipios (cve_mun, cve_ent, nombre, hashtag) VALUES
('06001','06','Armería','#Armería'), ('06002','06','Colima','#ColimaCapital'),
('06003','06','Comala','#Comala'), ('06004','06','Coquimatlán','#Coquimatlán'),
('06005','06','Cuauhtémoc','#CuauhtémocCol'), ('06006','06','Ixtlahuacán','#Ixtlahuacán'),
('06007','06','Manzanillo','#Manzanillo'), ('06008','06','Minatitlán','#Minatitlán'),
('06009','06','Tecomán','#Tecomán'), ('06010','06','Villa de Álvarez','#VillaDeÁlvarez');
