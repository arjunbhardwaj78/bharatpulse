import { fileURLToPath } from 'node:url';

/** Reads the repo-root .env if there is one (Node 20.12+). A missing file is fine: everything then runs in demo mode. */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  /* no .env */
}
