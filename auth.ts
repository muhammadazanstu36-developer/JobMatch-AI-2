import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";
import type { User } from "@/types";

/**
 * Small file-based account system (no database needed).
 * Passwords are hashed with scrypt. Sessions are signed cookies (HMAC-SHA256).
 * NOTE: the users file needs a disk that persists. It will NOT survive on serverless hosts
 * such as Vercel. For those, swap the three functions marked "storage" for a real database.
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

/* ---------- storage (replace these three for a real database) ---------- */
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
const findByEmail = async (email: string) => (await readAll()).find((u) => u.email === email);
const findById = async (id: string) => (await readAll()).find((u) => u.id === id);
/* ------------------------------------------------------------------------ */

const hashPw = (pw: string, salt: string) => crypto.scryptSync(pw, salt, 64).toString("hex");
const pub = (u: StoredUser): User => ({ id: u.id, name: u.name, email: u.email });

export const normEmail = (e: string) => e.trim().toLowerCase();

export async function createUser(name: string, email: string, password: string): Promise<User | "exists"> {
  return serial(async () => {
    const users = await readAll();
    if (users.some((u) => u.email === email)) return "exists" as const;
    const salt = crypto.randomBytes(16).toString("hex");
    const u: StoredUser = {
      id: crypto.randomUUID(),
      name,
      email,
      salt,
      hash: hashPw(password, salt),
      createdAt: new Date().toISOString()
    };
    users.push(u);
    await writeAll(users);
    return pub(u);
  });
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
