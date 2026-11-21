import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import type { Role } from './types.js';

export interface Officer { id: string; name: string; role: Role; office: string }

/**
 * Officer sign-in. SAMPLE accounts that share one password (OFFICER_PASSWORD, default below).
 * shortcut: replace with the department's real login (SSO) before real use. Tokens live in memory and reset on restart.
 */
export const OFFICERS: Officer[] = [
  { id: 'field1', name: 'Field Officer', role: 'L1', office: 'Nagar Palika Parishad' },
  { id: 'zonal1', name: 'Zonal Officer', role: 'L2', office: 'Nagar Palika Parishad' },
  { id: 'head1', name: 'Department Head', role: 'L3', office: 'Nagar Palika Parishad' },
  { id: 'commissioner1', name: 'Commissioner', role: 'L4', office: 'Nagar Palika Parishad' },
];

const hash = (s: string): Buffer => createHash('sha256').update(s).digest();

const TOKEN_MS = 7 * 24 * 3_600_000;

export class Officers {
  /** `secret` signs the sign-in tokens; keep it stable and a restart will not sign officers out. */
  constructor(private readonly password = 'officer@123', private readonly secret = password, private readonly clock: () => number = Date.now) {}

  private sign = (body: string): string => createHmac('sha256', this.secret).update(`officer:${body}`).digest('base64url').slice(0, 32);

  login(id: unknown, role: unknown, password: unknown): { token: string; officer: Officer } {
    const o = OFFICERS.find((x) => x.id === id);
    const okPassword = typeof password === 'string' && timingSafeEqual(hash(password), hash(this.password));
    if (!o || !okPassword) throw new AppError(401, 'bad_login', 'Wrong officer ID or password');
    if (o.role !== role) throw new AppError(403, 'wrong_role', `${o.id} is not a ${String(role)} account`);
    const body = Buffer.from(JSON.stringify({ o: o.id, e: this.clock() + TOKEN_MS })).toString('base64url');
    return { token: `${body}.${this.sign(body)}`, officer: o };
  }

  /** The signed-in officer behind a token, or a 401. */
  who(token: unknown): Officer {
    const bad = new AppError(401, 'not_signed_in', 'Sign in as an officer first');
    if (typeof token !== 'string') throw bad;
    const [body, sig] = token.split('.');
    if (!body || !sig || sig.length !== 32 || !timingSafeEqual(Buffer.from(sig), Buffer.from(this.sign(body)))) throw bad;
    try {
      const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as { o: string; e: number };
      const o = OFFICERS.find((x) => x.id === t.o);
      if (!o || this.clock() > t.e) throw bad;
      return o;
    } catch {
      throw bad;
    }
  }
}
