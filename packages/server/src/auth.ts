import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { SlidingWindowLimiter } from './rateLimit.js';

const SESSION_MS = 30 * 24 * 3_600_000;

export interface Profile {
  firstSeen: number;
  confirmedResolved: number;
  lostDisputes: number;
}

/**
 * SIMULATED phone verification for the demo: every phone gets the same fixed code.
 * Real SMS is the next step. The phone number itself is never stored, only a salted hash.
 * shortcut: sessions and profiles live in memory, so they reset on restart; move them to the store when real.
 */
export class Auth {
  private profiles = new Map<string, Profile>();
  private attempts = new SlidingWindowLimiter(5, 10 * 60_000);
  private requests = new SlidingWindowLimiter(5, 10 * 60_000);

  constructor(private readonly salt: string, private readonly code = '123456', private readonly clock: () => number = Date.now) {}

  readonly reporterId = (phone: string): string => `r_${createHmac('sha256', this.salt).update(phone).digest('hex').slice(0, 16)}`;
  readonly ipHash = (ip: string): string => createHmac('sha256', this.salt).update(`ip:${ip}`).digest('hex').slice(0, 16);

  /** Step 1: "send" the code. Nothing is sent in this build; the code is fixed (see the class note). */
  request(phone: unknown): { sent: true; simulated: true } {
    if (typeof phone !== 'string' || !/^\+?\d{10,13}$/.test(phone)) throw new AppError(400, 'validation_error', 'Enter a valid phone number');
    if (this.requests.tryConsume(this.reporterId(phone), this.clock()) > 0) throw new AppError(429, 'rate_limited', 'Too many codes requested, try again later');
    return { sent: true, simulated: true };
  }

  verify(phone: unknown, code: unknown): { token: string; reporterId: string; simulated: true } {
    if (typeof phone !== 'string' || !/^\+?\d{10,13}$/.test(phone)) throw new AppError(400, 'validation_error', 'phone must be 10 to 13 digits');
    const id = this.reporterId(phone);
    if (this.attempts.tryConsume(id, this.clock()) > 0) throw new AppError(429, 'rate_limited', 'Too many attempts, try again later');
    if (code !== this.code) throw new AppError(401, 'bad_code', 'Wrong code');
    if (!this.profiles.has(id)) this.profiles.set(id, { firstSeen: this.clock(), confirmedResolved: 0, lostDisputes: 0 });
    return { token: this.issue(id), reporterId: id, simulated: true };
  }

  /** Signed token: it carries the reporter and an expiry, so a restart does not sign anyone out as long as the salt stays the same. */
  private issue(id: string): string {
    const iat = this.clock();
    const body = Buffer.from(JSON.stringify({ r: id, i: iat, e: iat + SESSION_MS })).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }
  private sign = (body: string): string => createHmac('sha256', this.salt).update(`session:${body}`).digest('base64url').slice(0, 32);

  /** The reporter behind a session token, or a 401. */
  session(token: unknown): string {
    const bad = new AppError(401, 'not_verified', 'Verify your phone first');
    if (typeof token !== 'string') throw bad;
    const [body, sig] = token.split('.');
    if (!body || !sig || sig.length !== 32 || !timingSafeEqual(Buffer.from(sig), Buffer.from(this.sign(body)))) throw bad;
    try {
      const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as { r: string; i: number; e: number };
      if (this.clock() > t.e) throw bad;
      if (!this.profiles.has(t.r)) this.profiles.set(t.r, { firstSeen: t.i, confirmedResolved: 0, lostDisputes: 0 });
      return t.r;
    } catch {
      throw bad;
    }
  }

  profile(id: string): Profile {
    return this.profiles.get(id) ?? { firstSeen: this.clock(), confirmedResolved: 0, lostDisputes: 0 };
  }

  bump(id: string, field: 'confirmedResolved' | 'lostDisputes'): void {
    const p = this.profiles.get(id);
    if (p) p[field]++;
  }
}
