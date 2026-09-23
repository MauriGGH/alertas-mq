import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import type { Alert } from "./types";

// Sonidos originales sintetizados para este proyecto (assets/sounds). Puedes reemplazar
// cualquier archivo por otro .wav o .mp3 con el mismo nombre.
const SOURCES = {
  siren: require("../assets/sounds/siren.wav"),
  tsunami: require("../assets/sounds/tsunami.wav"),
  alarm: require("../assets/sounds/alarm.wav"),
  chime: require("../assets/sounds/chime.wav"),
  zombie: require("../assets/sounds/zombie.wav"),
  alien: require("../assets/sounds/alien.wav"),
};
export type SoundKey = keyof typeof SOURCES;

let loop: AudioPlayer | null = null;

export async function initAudio() {
  // Suena aunque el iPhone esté en modo silencio (con la app abierta)
  await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
}

export function soundFor(a: Pick<Alert, "type">): SoundKey {
  switch (a.type) {
    case "EARTHQUAKE": return "siren";
    case "TSUNAMI": return "tsunami";
    case "ZOMBIE": return "zombie";
    case "ALIEN": return "alien";
    default: return "alarm";
  }
}

export function playLoop(key: SoundKey) {
  stopLoop();
  const p = createAudioPlayer(SOURCES[key]);
  p.loop = true;
  p.volume = 1;
  p.play();
  loop = p;
}

export function stopLoop() {
  if (!loop) return;
  loop.pause();
  loop.remove();
  loop = null;
}

export function playOnce(key: SoundKey, ms = 5000) {
  const p = createAudioPlayer(SOURCES[key]);
  p.volume = 1;
  p.play();
  setTimeout(() => {
    p.pause();
    p.remove();
  }, ms);
}
