import { createHash } from 'node:crypto';
import { haversineMeters, type IssueType } from '@bharatpulse/engine';
import exifr from 'exifr';
import sharp from 'sharp';
import { CITY } from './data.js';
import { AppError } from './errors.js';

/** First match wins, so the specific words come first. English, Hinglish and Devanagari. */
const KEYWORDS: [IssueType, RegExp][] = [
  ['CAVE_IN', /cav(e|ing)|sink|collaps|धंस|धँस|dhans/i],
  ['WATERLOGGING', /waterlog|jal ?bhar|जलभराव|paani ?bhar|पानी ?भर/i],
  ['POTHOLE', /pothole|gadda|gaddha|गड्ढ|गढ्ढ|road/i],
  ['DIRTY_WATER', /dirty|smell|gandh?[aei]|muddy|गंद|बदबू|badbu/i],
  ['LEAK', /leak|burst|tapak|पाइप|फट|लीक|pipe/i],
  ['LOW_PRESSURE', /pressure|dheere|dhime|कम ?दबाव|धीमा|slow/i],
  ['NO_WATER', /no water|paani ?nahi|pani ?nahi|पानी ?नहीं|supply|water/i],
];
export const classify = (text: string): IssueType | undefined => KEYWORDS.find(([, re]) => re.test(text))?.[0];

/** 64-bit difference hash as 16 hex chars: survives resizing and recompression. */
export async function dHash(image: Buffer): Promise<string> {
  const px = await sharp(image).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

export interface PhotoFacts { hash: string; exifTime?: number }

/** Decodes a base64 photo (JPEG/PNG), hashes it and reads the capture time if the phone left one. */
export async function readPhoto(base64: string): Promise<PhotoFacts> {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0 || buf.length > 4_000_000) throw new AppError(400, 'validation_error', 'photo must be 1 byte to 4 MB');
  try {
    const exif = await exifr.parse(buf, ['DateTimeOriginal']).catch(() => undefined);
    const t = exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal.getTime() : undefined;
    return { hash: await dHash(buf), exifTime: t };
  } catch {
    throw new AppError(400, 'validation_error', 'photo is not a readable image');
  }
}

export const nearestLocality = (lat: number, lng: number): string | undefined => {
  const best = CITY.localities.map((l) => ({ id: l.id, d: haversineMeters({ lat, lng }, l) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d <= 2000 ? best.id : undefined;
};

export const nearFacility = (lat: number, lng: number): boolean => CITY.facilities.some((f) => haversineMeters({ lat, lng }, f) <= 250);

/**
 * Speech to text through Sarvam (model saaras:v4, mode "transcribe", synchronous endpoint, up to 30 s of audio).
 * WRITTEN FROM THE DOCS, NOT TESTED AGAINST THE LIVE API: run `npm run sarvam:smoke` once with a real key.
 */
export async function transcribe(audio: Buffer, mime: string, key: string, fetchFn: typeof fetch = fetch): Promise<{ text: string; language?: string }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), 'complaint.wav');
  form.append('model', 'saaras:v4');
  form.append('mode', 'transcribe');
  const res = await fetchFn('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': key }, body: form });
  if (!res.ok) throw new AppError(502, 'voice_failed', `Speech service answered ${res.status}`);
  const j = (await res.json()) as { transcript?: string; language_code?: string };
  return { text: j.transcript ?? '', language: j.language_code };
}

/** An officer's fix photo: checked to be an image, shrunk to at most 1024 px, and fingerprinted. */
export async function normalizeProof(base64: string): Promise<{ photo: string; hash: string }> {
  const buf = Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length === 0 || buf.length > 6_000_000) throw new AppError(400, 'validation_error', 'proof photo must be 1 byte to 6 MB');
  try {
    const out = await sharp(buf).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return { photo: `data:image/jpeg;base64,${out.toString('base64')}`, hash: sha256(buf) };
  } catch {
    throw new AppError(400, 'validation_error', 'proof photo is not a readable image');
  }
}

/** A plain green picture used as the fix photo in the sample town. */
export async function placeholderPhoto(): Promise<string> {
  const out = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#8fbf9f' } }).jpeg({ quality: 60 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}
