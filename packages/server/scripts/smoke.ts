// Run once after you have credentials:  npm run neo4j:smoke   (and  npm run sarvam:smoke)
// It loads the same synthetic scenario into Neo4j and into memory, then checks that both give the same graph answers.
import '../src/loadEnv.js';
import { MemoryStore } from '../src/memoryStore.js';
import { Neo4jStore } from '../src/neo4jStore.js';
import { deviceAttack, rng } from '../src/scenarios.js';
import { IncidentService } from '../src/service.js';
import { transcribe } from '../src/intake.js';

const NOW = Date.UTC(2026, 10, 1, 12, 0);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function neo4jSmoke(): Promise<void> {
  const { NEO4J_URI, NEO4J_USER = 'neo4j', NEO4J_PASSWORD } = process.env;
  if (!NEO4J_URI || !NEO4J_PASSWORD) return console.log('neo4j: skipped (set NEO4J_URI and NEO4J_PASSWORD in .env)');
  const prefix = `smoke${Date.now().toString(36)}-`;
  const complaints = deviceAttack({ n: 12, devices: 3, at: { lat: 27.4924, lng: 77.6737 }, now: NOW, r: rng(1), prefix });
  const neo = await Neo4jStore.connect(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);
  const sides = [new IncidentService(neo, { clock: () => NOW }), new IncidentService(new MemoryStore(), { clock: () => NOW })];
  const incidents = await Promise.all(sides.map((s) => s.ingestDemo(complaints)));
  const checks: [string, boolean][] = [['same number of incidents', incidents[0].length === incidents[1].length]];
  const id = incidents[0][0]?.incident.id;
  if (id) {
    const [a, b] = await Promise.all(sides.map((s) => s.subgraph(id)));
    checks.push(['shared devices found (3 devices, 4 reporters each)', a.sharedDevices.length === 3 && same(a.sharedDevices.map((d) => d.reporters), [4, 4, 4])]);
    checks.push(['shared devices match memory', same([...a.sharedDevices].sort((x, y) => x.deviceId.localeCompare(y.deviceId)), [...b.sharedDevices].sort((x, y) => x.deviceId.localeCompare(y.deviceId)))]);
  }
  const [d1, d2] = await Promise.all(sides.map((s) => s.downstream('Z1', 3)));
  checks.push(['downstream of Z1 matches memory', same(d1, d2)]);
  checks.push(['me-too lock: first confirm ok, second refused', (await neo.confirm('smoke-r', id ?? 'x')) === !!id && (await neo.confirm('smoke-r', id ?? 'x')) === false]);
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`(test data prefix: ${prefix}; remove with: MATCH (n) WHERE n.id STARTS WITH "${prefix}" DETACH DELETE n)`);
  await neo.close();
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

async function sarvamSmoke(): Promise<void> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return console.log('sarvam: skipped (set SARVAM_API_KEY in .env)');
  const wav = Buffer.alloc(44 + 32000); // one second of silence, 16 kHz mono 16-bit
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + 32000, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
  try {
    const out = await transcribe(wav, 'audio/wav', key);
    console.log('PASS  sarvam answered:', JSON.stringify(out));
  } catch (e) {
    console.log('FAIL  sarvam:', (e as Error).message);
    process.exitCode = 1;
  }
}

await neo4jSmoke();
await sarvamSmoke();
