# Alertas MQ

## Fase 1: Infraestructura

Sistema de alertas productor/consumidor sobre Apache Kafka.
Esta fase deja listos Kafka, PostgreSQL, el contrato de mensajes (JSON + validación) y el túnel de Cloudflare.

## Estructura

```
alertas-mq/
├── docker-compose.yml          Kafka (KRaft), Postgres, túnel, Kafka UI opcional
├── infra/kafka/create-topics.sh  Topics y particiones
├── infra/postgres/init.sql       Esquema + catálogo INEGI inicial
├── packages/shared/            Contrato de mensajes (zod) compartido con app y panel
└── apps/server/                Servidor (por ahora /health + prueba de humo)
```

## Requisitos (laptop Linux)

- Docker Engine + plugin compose (`docker compose version`)
- Node.js 20 o 22 LTS (`node -v`)
- 8 GB de RAM: cierra lo que no uses; se recomienda tener swap de 4 GB o más

## 1. Levantar infraestructura

```bash
cp .env.example .env
docker compose up -d
docker compose logs kafka-init      # debe listar los 8 topics
docker compose ps                   # kafka y postgres en estado "healthy"
```

## 2. Probar el patrón productor → Kafka → consumidor

```bash
npm install
npm run smoke
```

La salida esperada son 5 líneas `✔ Consumidor ...` con su latencia y, al final, `✅ Fase 1 OK`.

## 3. Levantar el servidor

```bash
npm run dev:server
curl localhost:3000/health          # {"ok":true,"kafka":true,"postgres":true,"missingTopics":[],"estados":32,...}
```

## 4. Túnel de Cloudflare (sin abrir puertos del router)

1. En el panel de Cloudflare entra a **Zero Trust → Networks → Tunnels** y crea un túnel de tipo *cloudflared*.
2. Copia el **token** que aparece en el comando de instalación y pégalo en `.env` como `CF_TUNNEL_TOKEN=...`.
3. En la pestaña **Public Hostname** del túnel agrega:
   - Subdominio `api` en tu dominio → Service `HTTP` → `localhost:3000`
4. Arranca el túnel:
   ```bash
   npm run tunnel:up
   docker compose logs -f cloudflared   # busca "Registered tunnel connection"
   ```
5. Desde el celular, **con datos móviles** (para confirmar que no depende de la red local), abre:
   `https://api.TU-DOMINIO/health`

La conexión del túnel es saliente, así que funciona detrás de cualquier router.
Cloudflare cierra conexiones WebSocket inactivas después de unos 100 segundos; el servidor enviará un heartbeat cada 25 segundos (a partir de la Fase 2).

## Opcional: Kafka UI

```bash
docker compose --profile tools up -d kafka-ui   # http://localhost:8080  (~400 MB de RAM)
```

Más adelante el panel admin propio mostrará topics, lag y offsets, así que Kafka UI solo hace falta para depurar.

## Reiniciar desde cero

```bash
docker compose down -v    # borra también los volúmenes de Kafka y Postgres
```

---

## Fase 2: Núcleo del backend

### Qué hay nuevo

```
apps/server/
├── migrations/001_municipios_demo.sql   Coordenadas de Colima + Monterrey, Guadalajara, CDMX, Acapulco
└── src/
    ├── gateway.ts               WebSocket (Socket.IO): auth JWT, salas por municipio, sync, ACKs
    ├── pipeline/normalizer.ts   alerts.raw -> resuelve municipios -> Postgres -> alerts.normalized
    ├── pipeline/dispatcher.ts   alerts.normalized -> dispositivos de esos municipios
    ├── pipeline/acks.ts         device.acks -> quién recibió / confirmó
    ├── routes/                  /auth/register, /auth/login, /me, /me/zones, /catalog, /admin/alerts
    └── tools/
        ├── client.ts            dispositivo simulado en terminal
        └── send-alert.ts        productor manual con escenarios
```

### Flujo de una alerta

1. `POST /admin/alerts` (productor) publica JSON en `alerts.raw`.
2. El **normalizador** valida, calcula los municipios afectados (lista, estado completo o radio desde un punto), agrega hashtags y guarda en Postgres, que asigna el `seq`.
3. Publica en `alerts.normalized` (y en `alerts.critical` si es CRÍTICA).
4. El **dispatcher** la envía por WebSocket solo a las salas `mun:<clave>` afectadas.
5. El dispositivo guarda localmente, responde `RECEIVED` y, si es crítica, `ACKNOWLEDGED`.
6. Si estaba desconectado, al reconectar pide `sync` con su cursor y recibe lo que se perdió.

### Variables nuevas en `.env`

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
echo "ADMIN_TOKEN=$(openssl rand -hex 16)" >> .env
echo "PUBLIC_URL=https://api.TU-DOMINIO" >> .env
```

### Escenarios de prueba

```bash
npm run alert                              # lista escenarios
npm run alert -- huracan-colima            # Manzanillo, Armería, Tecomán
npm run alert -- tormenta-monterrey        # solo Monterrey
npm run alert -- sismo-colima              # CRÍTICA, todo Colima
npm run alert -- tsunami-pacifico          # CRÍTICA, costa de Colima + Acapulco
npm run alert -- aviso-colima              # INFO, todo el estado
```

### Dispositivos simulados

```bash
npm run client -- --email ana@demo.mx --name Ana --mun 06007
npm run client -- --email beto@demo.mx --name Beto --mun 19039 --url https://api.TU-DOMINIO
npm run client -- --email ana@demo.mx --reset     # borra su almacenamiento local y empieza de cero
```

Cada cliente guarda sus alertas en `apps/server/.clientes/<correo>.json`, igual que la app lo hará en SQLite.

### Métricas

`GET /metrics` devuelve contadores del pipeline (alertas normalizadas, enviadas, entregas, ACKs, latencia, conexiones). El panel gráfico los usará después.

---

## Fase 2.5: Red sísmica comunitaria y simulacros ficticios

### Detector sísmico (streaming con ventana)

```
celular (acelerómetro + giroscopio) --sensor:trigger--> gateway --> sensor.triggers
   --> detector: ventana de 10 s, ≥3 dispositivos distintos a ≤50 km entre sí
   --> alerta CRÍTICA (source CROWDSENSE) en alerts.raw --> pipeline normal
```

- Límite de 1 disparo cada 5 s por dispositivo.
- Periodo de enfriamiento de 60 s entre detecciones.
- Si todos los disparos vienen de simuladores, la alerta sale marcada como SIMULACRO.
- El servidor crea el topic `sensor.triggers` solo al arrancar.

Configuración en vivo:

```bash
curl -H "x-admin-token: $ADMIN_TOKEN" localhost:3000/admin/detector
curl -X PUT -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"minDevices":2,"scope":"nacional"}' localhost:3000/admin/detector
```

Para cargar `$ADMIN_TOKEN` en la terminal: `export $(grep ADMIN_TOKEN .env)`.

### Probar sin celulares

```bash
npm run quake -- --devices 3 --mun 06002          # 3 sensores en Colima capital
npm run quake -- --devices 2 --mun 06007 --spread 3
```

O en cada `npm run client` pulsa la tecla **s** para simular una sacudida (varias terminales a la vez).

### Escenarios ficticios

```bash
npm run alert -- zombies     # CRÍTICA + SIMULACRO, estado de Colima
npm run alert -- aliens      # CRÍTICA + SIMULACRO, todo el país
```

Los tipos `ZOMBIE` y `ALIEN` tendrán su propio sonido en la app (archivos en `assets/sounds/`).

---

## Fase 3: Panel gráfico y app móvil

### Panel del servidor

Con el servidor corriendo abre **http://localhost:3000/panel/** en la laptop y pega tu `ADMIN_TOKEN`.

- Sala de control: sismograma en vivo del flujo de mensajes, cifras y mapa de alertas vigentes.
- Emitir alerta: escenarios rápidos, formulario con menús, destino por radio en el mapa, estados o municipios.
- Red sísmica: ajustes del detector y simulación de sacudidas.
- Dispositivos, Historial (recibidas, "Enterado", bien, ayuda), Chat (moderación) y Bitácora filtrable.

### Catálogo completo

La migración `002_catalogo_inegi.sql` carga los 2,463 municipios del INEGI con la ubicación de su cabecera.

### App móvil

Ver `mobile/README.md`.
