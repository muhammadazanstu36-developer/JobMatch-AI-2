import type { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI provider switch. Set ONE key in .env.local. The first key found is used, in this order:
 *   GEMINI_API_KEY      (Google AI Studio, free tier, no card needed)   <- recommended
 *   GROQ_API_KEY        (Groq, free tier)
 *   OPENROUTER_API_KEY  (OpenRouter, has free models)
 *   ANTHROPIC_API_KEY   (paid)
 * Set AI_PROVIDER=gemini|groq|openrouter|anthropic to force one. AI_MODEL overrides the model.
 */
type Provider = "gemini" | "groq" | "openrouter" | "anthropic";

const CONF: Record<Provider, { env: string; url: string; models: string[] }> = {
  gemini: {
    env: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    models: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]
  },
  groq: {
    env: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
  },
  openrouter: {
    env: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    models: ["meta-llama/llama-3.3-70b-instruct:free", "google/gemini-2.0-flash-exp:free"]
  },
  anthropic: {
    env: "ANTHROPIC_API_KEY",
    url: `${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`,
    models: ["claude-sonnet-5-5", "claude-sonnet-4-6"]
  }
};

function pickProvider(): Provider | null {
  const forced = process.env.AI_PROVIDER as Provider | undefined;
  if (forced && CONF[forced] && process.env[CONF[forced].env]) return forced;
  return (["gemini", "groq", "openrouter", "anthropic"] as Provider[]).find((p) => process.env[CONF[p].env]) ?? null;
}

const hits = new Map<string, number[]>();
function limited(id: string): boolean {
  const now = Date.now();
  const arr = (hits.get(id) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(id, arr);
  return arr.length > 20;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function upstreamError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as unknown;
    const o = (Array.isArray(j) ? j[0] : j) as { error?: { message?: string } | string };
    const e = o?.error;
    return (typeof e === "string" ? e : e?.message) || `HTTP ${r.status}`;
  } catch {
    return `HTTP ${r.status}`;
  }
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

function validMessages(v: unknown): v is Msg[] {
  if (!Array.isArray(v) || v.length === 0 || v.length >= 40) return false;
  const ok = v.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  if (!ok) return false;
  const msgs = v as Msg[];
  return msgs[msgs.length - 1].role === "user" && msgs.reduce((n, m) => n + m.content.length, 0) < 60_000;
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return json({ error: "Please sign in to use this feature." }, 401);

  const provider = pickProvider();
  if (!provider) {
    return json({ error: "No AI key is set on the server. Add GEMINI_API_KEY (free) to .env.local and restart." }, 500);
  }
  if (limited(user.id)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const messages = (body as { messages?: unknown })?.messages;
  if (!validMessages(messages)) return json({ error: "Invalid messages." }, 400);

  const cfg = CONF[provider];
  const key = process.env[cfg.env] as string;
  const models = Array.from(new Set([process.env.AI_MODEL || process.env.ANTHROPIC_MODEL, ...cfg.models].filter(Boolean))) as string[];

  let upstream: Response | null = null;
  let lastMsg = "";
  for (const model of models) {
    let r: Response;
    try {
      r =
        provider === "anthropic"
          ? await fetch(cfg.url, {
              method: "POST",
              headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({ model, max_tokens: 4096, stream: true, messages })
            })
          : await fetch(cfg.url, {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
              body: JSON.stringify({ model, max_tokens: 4096, stream: true, messages })
            });
    } catch {
      return json({ error: "Could not reach the AI service from the server." }, 502);
    }
    if (r.ok) {
      upstream = r;
      break;
    }
    const msg = await upstreamError(r);
    if (r.status === 401 || r.status === 403) return json({ error: `The AI key was rejected: ${msg}` }, 502);
    if (r.status === 404 || (r.status === 400 && /model/i.test(msg))) {
      lastMsg = msg; // try the next model name
      continue;
    }
    if (r.status === 429) return json({ error: "The free AI limit was reached for now. Wait a minute and try again." }, 429);
    return json({ error: msg }, 502);
  }
  if (!upstream || !upstream.body) return json({ error: `No usable model was found. ${lastMsg}`.trim() }, 502);

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const raw = line.slice(5).trim();
              if (!raw || raw === "[DONE]") continue;
              let ev: {
                type?: string;
                delta?: { type?: string; text?: string };
                choices?: { delta?: { content?: string } }[];
                error?: { message?: string };
              };
              try {
                ev = JSON.parse(raw);
              } catch {
                continue;
              }
              // Anthropic format
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
                controller.enqueue(enc.encode(ev.delta.text));
              } else if (ev.type === "error") {
                throw new Error(ev.error?.message || "stream error");
              }
              // OpenAI-compatible format (Gemini, Groq, OpenRouter)
              const t = ev.choices?.[0]?.delta?.content;
              if (t) controller.enqueue(enc.encode(t));
            }
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      void reader.cancel();
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" }
  });
}
