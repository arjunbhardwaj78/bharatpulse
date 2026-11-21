import './loadEnv.js';
import { randomBytes } from 'node:crypto';
import { buildApp } from './app.js';
import { Auth } from './auth.js';
import { MemoryStore } from './memoryStore.js';
import { Officers } from './officers.js';
import { makePlaceFinder, makePlaceSearch } from './places.js';
import { IncidentService } from './service.js';
import type { IncidentStore } from './store.js';

// Neo4j when NEO4J_URI is set, otherwise memory (data disappears on restart).
let store: IncidentStore = new MemoryStore();
if (process.env.NEO4J_URI) {
  const { Neo4jStore } = await import('./neo4jStore.js');
  store = await Neo4jStore.connect(process.env.NEO4J_URI, process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? '');
}

const isProd = process.env.NODE_ENV === 'production';
// Production must not run with the public sample password from .env.example.
if (isProd && !process.env.OFFICER_PASSWORD) {
  console.error('OFFICER_PASSWORD is not set. Refusing to start in production with the public sample password. Set it in the Render dashboard.');
  process.exit(1);
}
if (isProd && !process.env.NEO4J_URI) {
  console.warn('WARNING: NEO4J_URI is not set. Using in-memory storage: all data is lost on every restart or sleep.');
}

// A stable salt keeps people signed in across restarts. In production set ID_SALT; the development fallback is fixed on purpose.
const salt = process.env.ID_SALT ?? (process.env.NODE_ENV === 'production' ? randomBytes(16).toString('hex') : 'bharatpulse-dev-salt');
const auth = new Auth(salt, process.env.OTP_CODE);
const service = new IncidentService(store, { auth });
const app = buildApp(service, { logger: true }, { auth, officers: new Officers(process.env.OFFICER_PASSWORD, `${salt}:officers`), search: process.env.PLACES === 'off' ? undefined : makePlaceSearch({ email: process.env.CONTACT_EMAIL }), places: process.env.PLACES === 'off' ? undefined : makePlaceFinder({ googleKey: process.env.GOOGLE_MAPS_KEY, email: process.env.CONTACT_EMAIL }), geofence: process.env.GEOFENCE !== 'false', requireOtp: process.env.REQUIRE_OTP !== 'false', sarvamKey: process.env.SARVAM_API_KEY, adminKey: process.env.ADMIN_KEY });

const port = Number(process.env.PORT ?? 3000);
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
