-- Coordenadas aproximadas de las cabeceras municipales de Colima y municipios
-- extra para probar la segmentación. En la fase de ingestores se reemplaza
-- por el catálogo completo del INEGI (~2,470 municipios con centroides).
UPDATE municipios m SET lat = v.lat, lon = v.lon
FROM (VALUES
  ('06001', 18.9367, -103.9606), ('06002', 19.2433, -103.7250),
  ('06003', 19.3208, -103.7600), ('06004', 19.2069, -103.8083),
  ('06005', 19.3281, -103.6036), ('06006', 19.0017, -103.7361),
  ('06007', 19.0522, -104.3158), ('06008', 19.3869, -104.0567),
  ('06009', 18.9089, -103.8747), ('06010', 19.2672, -103.7372)
) AS v(cve_mun, lat, lon)
WHERE m.cve_mun = v.cve_mun;

INSERT INTO municipios (cve_mun, cve_ent, nombre, hashtag, lat, lon) VALUES
  ('19039', '19', 'Monterrey', '#Monterrey', 25.6866, -100.3161),
  ('14039', '14', 'Guadalajara', '#Guadalajara', 20.6597, -103.3496),
  ('09015', '09', 'Cuauhtémoc', '#CuauhtémocCDMX', 19.4326, -99.1332),
  ('12001', '12', 'Acapulco de Juárez', '#Acapulco', 16.8531, -99.8237)
ON CONFLICT (cve_mun) DO NOTHING;
