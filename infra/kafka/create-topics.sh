#!/bin/bash
# Crea los topics del sistema. Idempotente (--if-not-exists).
set -e
BS=kafka:29092
K=/opt/kafka/bin/kafka-topics.sh
HOUR=3600000
DAY=86400000

create() {
  # $1 topic  $2 particiones  $3 retención (ms)
  $K --bootstrap-server "$BS" --create --if-not-exists \
     --topic "$1" --partitions "$2" --replication-factor 1 \
     --config retention.ms="$3"
}

# Alertas: particionadas por código de estado INEGI (clave del mensaje)
create alerts.raw         6  $((7*DAY))    # tal como llegan de APIs / panel / simulador
create alerts.normalized  6  $((30*DAY))   # validadas + municipios objetivo calculados
create alerts.critical    3  $((30*DAY))   # canal prioritario (sismo, tsunami...)

# Tráfico de usuarios
create checkins           6  $((30*DAY))   # "Estoy bien" / "Necesito ayuda"
create chat.global        3  $((7*DAY))
create device.acks        6  $((7*DAY))    # recibido / enterado

# Red sísmica comunitaria: 1 partición para que el detector vea todo en orden
create sensor.triggers    1  $((1*DAY))

# Pruebas de carga y errores
create sim.flood         12  $((1*HOUR))   # eventos masivos del simulador
create dead.letter        1  $((7*DAY))    # mensajes que no pasan validación

echo "== Topics existentes =="
$K --bootstrap-server "$BS" --list
