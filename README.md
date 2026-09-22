# Alertas MQ — Fase 1: Infraestructura

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
