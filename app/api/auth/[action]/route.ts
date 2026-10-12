import type { NextRequest } from "next/server";
import { checkLogin, cookieHeader, createUser, getUser, makeToken, normEmail, throttled } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) }
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ip = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  if (params.action !== "me") return json({ error: "Not found." }, 404);
  return json({ user: await getUser(req) });
}

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const { action } = params;

  if (action === "logout") return json({ ok: true }, 200, cookieHeader("", true));
  if (action !== "register" && action !== "login") return json({ error: "Not found." }, 404);

  let b: { name?: unknown; email?: unknown; password?: unknown };
  try {
    b = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const email = typeof b.email === "string" ? normEmail(b.email) : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!EMAIL.test(email) || email.length > 120) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: "Password must be 8 to 128 characters." }, 400);
  if (throttled(`${action}:${ip(req)}`) || throttled(`${action}:${email}`)) {
    return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  }

  if (action === "register") {
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    if (name.length < 2) return json({ error: "Enter your name." }, 400);
    const u = await createUser(name, email, password);
    if (u === "exists") return json({ error: "An account with this email already exists. Sign in instead." }, 409);
    return json({ user: u }, 201, cookieHeader(makeToken(u.id)));
  }

  const u = await checkLogin(email, password);
  if (!u) return json({ error: "Wrong email or password." }, 401);
  return json({ user: u }, 200, cookieHeader(makeToken(u.id)));
}
