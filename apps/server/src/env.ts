import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";

// El .env vive en la raíz del monorepo
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

export const env = process.env;
