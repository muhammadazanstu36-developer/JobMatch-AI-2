import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { User } from "@/types";

/**
 * Small file-based account system (no database needed).
 * Passwords are hashed with scrypt. Sessions are signed cookies (HMAC-SHA256).
 * Storage: if an Upstash Redis / Vercel KV REST URL + token are set, accounts live there (works on Vercel).
 * Otherwise a local JSON file is used (works on a normal server or `npm run dev`, NOT on Vercel).
 */

const FILE = process.env.USERS_FILE || path.join(process.cwd(), "data", "users.json");
export const COOKIE = "jt_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

interface StoredUser extends User {
  salt: string;
  hash: string;
  createdAt: string;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is missing or too short (use at least 16 random characters).");
  }
  return "dev-only-secret-change-me-please";
}

/* ---------- storage ---------- */
// Accepts Upstash's own names, Vercel's KV_ names, or any custom prefix (e.g. STORAGE_REST_API_URL).
function findEnv(suffix: string): string {
  const exact = process.env[`UPSTASH_REDIS_${suffix}`] || process.env[`KV_${suffix}`];
  if (exact) return exact;
  const k = Object.keys(process.env).find((n) => n.endsWith(`_${suffix}`) && !n.includes("READ_ONLY"));
  return (k && process.env[k]) || "";
}
const REDIS_URL = findEnv("REST_API_URL") || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = findEnv("REST_API_TOKEN") || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

export class StorageError extends Error {}

function assertStorage() {
  if (!useRedis && process.env.VERCEL) {
    throw new StorageError(
      "Accounts are not set up on this server yet. Add an Upstash Redis database (Vercel > Storage) and redeploy."
    );
  }
}

async function redis(...cmd: (string | number)[]): Promise<unknown> {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store"
  });
  const j = (await r.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!r.ok || j.error) throw new StorageError(j.error || "Database request failed.");
  return j.result;
}

/* file fallback (local use) */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};
async function readAll(): Promise<StoredUser[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as StoredUser[];
  } catch {
    return [];
  }
}
async function writeAll(users: StoredUser[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(users, null, 2), "utf8");
}

async function findByEmail(email: string): Promise<StoredUser | undefined> {
  assertStorage();
  if (useRedis) {
    const id = (await redis("GET", `jt:email:${email}`)) as string | null;
    return id ? findById(id) : undefined;
  }
  return (await readAll()).find((u) => u.email === email);
}
async function findById(id: string): Promise<StoredUser | undefined> {
  assertStorage();
  if (useRedis) {
    const raw = (await redis("GET", `jt:user:${id}`)) as string | null;
    return raw ? (JSON.parse(raw) as StoredUser) : undefined;
  }
  return (await readAll()).find((u) => u.id === id);
}
async function insertUser(u: StoredUser): Promise<boolean> {
  assertStorage();
  if (useRedis) {
    // NX = only set if the email is not taken (atomic, no race)
    const ok = await redis("SET", `jt:email:${u.email}`, u.id, "NX");
    if (ok !== "OK") return false;
    await redis("SET", `jt:user:${u.id}`, JSON.stringify(u));
    return true;
  }
  return serial(async () => {
    const users = await readAll();
    if (users.some((x) => x.email === u.email)) return false;
    users.push(u);
    await writeAll(users);
    return true;
  });
}
/* ------------------------------------------------------------------------ */

const hashPw = (pw: string, salt: string) => crypto.scryptSync(pw, salt, 64).toString("hex");
const pub = (u: StoredUser): User => ({ id: u.id, name: u.name, email: u.email });

export const normEmail = (e: string) => e.trim().toLowerCase();

export async function createUser(name: string, email: string, password: string): Promise<User | "exists"> {
  const salt = crypto.randomBytes(16).toString("hex");
  const u: StoredUser = {
    id: crypto.randomUUID(),
    name,
    email,
    salt,
    hash: hashPw(password, salt),
    createdAt: new Date().toISOString()
  };
  return (await insertUser(u)) ? pub(u) : "exists";
}

export async function checkLogin(email: string, password: string): Promise<User | null> {
  const u = await findByEmail(email);
  // Always hash, so the response time does not reveal whether the email exists.
  const salt = u?.salt ?? "0".repeat(32);
  const got = Buffer.from(hashPw(password, salt), "hex");
  const want = Buffer.from(u?.hash ?? "0".repeat(128), "hex");
  const ok = got.length === want.length && crypto.timingSafeEqual(got, want);
  return u && ok ? pub(u) : null;
}

/* ---------- sessions ---------- */
const sign = (data: string) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");

export function makeToken(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid?: string; exp?: number };
    return uid && typeof exp === "number" && exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}

export async function getUser(req: NextRequest): Promise<User | null> {
  const uid = readToken(req.cookies.get(COOKIE)?.value);
  if (!uid) return null;
  const u = await findById(uid);
  return u ? pub(u) : null;
}

export const cookieHeader = (token: string, clear = false) =>
  `${COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : MAX_AGE}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;

/* ---------- small in-memory throttle for login attempts ---------- */
const tries = new Map<string, number[]>();
export function throttled(key: string, max = 10, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const arr = (tries.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  tries.set(key, arr);
  return arr.length > max;
}

/* ---------- diagnostics (no secrets are returned) ---------- */
export async function status() {
  const out: Record<string, unknown> = {
    version: "signup-fix-3",
    onVercel: Boolean(process.env.VERCEL),
    authSecretOk: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16),
    storage: useRedis ? "redis" : "file",
    redisUrlFound: Boolean(REDIS_URL),
    redisTokenFound: Boolean(REDIS_TOKEN)
  };
  if (useRedis) {
    try {
      out.redisPing = await redis("PING");
    } catch (e) {
      out.redisPing = "FAILED: " + (e instanceof Error ? e.message : String(e));
    }
  } else if (process.env.VERCEL) {
    out.problem = "No database variables found. Connect Upstash to THIS project (prefix KV) and redeploy.";
  }
  return out;
}
