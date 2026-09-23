# Red de Alertas — app móvil (Expo SDK 57)

Una sola base de código para Android e iPhone.

## Qué hace

- Registro con estado y municipio (catálogo del INEGI desde el servidor) y zonas adicionales.
- Alertas en vivo por WebSocket; al reconectar recupera las que se perdió (cursor `seq`).
- Todo se guarda en SQLite en el teléfono: el historial nunca se borra.
- Alertas críticas a pantalla completa con sirena según el tipo, vibración y botón "Enterado".
- Avisos no críticos como aviso desplegable con sonido corto.
- "Estoy bien" / "Necesito ayuda" y chat global con hashtags (#Manzanillo, #Colima…).
- Bandeja de salida: lo que escribes sin conexión se envía al reconectar, sin duplicarse.
- Sensor sísmico con acelerómetro + giroscopio (modo demostración o realista).

## Arranque

```bash
cd mobile
npm install
npm run tunnel        # expo start --tunnel
```

Escanea el código QR con **Expo Go** (Android: desde la app Expo Go; iPhone: con la cámara).
`--tunnel` hace que los teléfonos lleguen a tu laptop aunque no estén en la misma red.

La dirección del servidor se configura en `src/config.ts` o desde la pantalla de inicio ("Cambiar servidor").

## Estructura

```
App.tsx                  navegación por pestañas, sensor global, overlays
src/store.tsx            estado global: sesión, conexión, alertas, chat
src/realtime.ts          Socket.IO: alertas, sync, ACKs, chat, sensor, bandeja de salida
src/db.ts                SQLite: alertas, chat, bandeja de salida, ajustes
src/sensor.ts            detector STA/LTA con acelerómetro y giroscopio
src/sounds.ts            sonidos por tipo (assets/sounds/*.wav, originales)
src/screens/             Inicio, Historial, Chat, Perfil, Detalle, Registro
src/components/          tarjeta de alerta, alerta crítica, avisos, selectores
```
