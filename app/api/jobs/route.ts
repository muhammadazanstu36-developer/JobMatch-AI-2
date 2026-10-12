import type { NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { COUNTRIES } from "@/lib/jobs";
import type { ApplyOption, JobListing } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");
const words = (t: string) => t.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1);

function plain(html: unknown, max = 2500): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function money(min?: number | null, max?: number | null, cur = "USD", period = ""): string {
  const f = (n: number) => Math.round(n).toLocaleString("en-US");
  const per = period ? ` / ${period.toLowerCase().replace("year", "yr").replace("month", "mo").replace("hour", "hr")}` : "";
  if (min && max && min !== max) return `${cur} ${f(min)} – ${f(max)}${per}`;
  const one = min || max;
  return one ? `${cur} ${f(one)}${per}` : "";
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------------- LinkedIn / Indeed / Glassdoor via JSearch (RapidAPI) ---------------- */
interface JSearchJob {
  job_id?: string;
  employer_name?: string;
  job_title?: string;
  job_publisher?: string;
  job_apply_link?: string;
  job_employment_type?: string;
  job_description?: string;
  job_is_remote?: boolean;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
  job_salary_period?: string | null;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
  apply_options?: { publisher?: string; apply_link?: string }[];
}

async function fromJSearch(q: string, loc: string, country: string, remote: boolean, days: number, pick: string[]): Promise<JobListing[]> {
  const key = process.env.RAPIDAPI_KEY as string;
  const pages = Math.min(Math.max(Number(process.env.JSEARCH_PAGES) || 2, 1), 5);
  const query = `${q}${loc ? " in " + loc : ""}`;
  const p = new URLSearchParams({
    query,
    page: "1",
    num_pages: String(pages),
    date_posted: days <= 1 ? "today" : days <= 3 ? "3days" : "week",
    country
  });
  if (remote) p.set("work_from_home", "true");
  const data = (await getJson(`https://jsearch.p.rapidapi.com/search?${p}`, {
    "X-RapidAPI-Key": key,
    "X-RapidAPI-Host": "jsearch.p.rapidapi.com"
  })) as { data?: JSearchJob[] };

  const out: JobListing[] = [];
  for (const x of data.data ?? []) {
    const opts: ApplyOption[] = (x.apply_options ?? [])
      .map((o) => ({ publisher: o.publisher || "Apply", url: safeUrl(o.apply_link) }))
      .filter((o) => o.url);
    if (!opts.length && safeUrl(x.job_apply_link)) opts.push({ publisher: x.job_publisher || "Apply", url: safeUrl(x.job_apply_link) });
    if (!opts.length) continue;

    // keep only jobs listed on at least one of the chosen sites
    const matches = opts.filter((o) => pick.some((s) => o.publisher.toLowerCase().includes(s)));
    if (!matches.length) continue;
    const rest = opts.filter((o) => !matches.includes(o));

    const posted = x.job_posted_at_datetime_utc || (x.job_posted_at_timestamp ? new Date(x.job_posted_at_timestamp * 1000).toISOString() : "");
    out.push({
      id: `js-${x.job_id ?? out.length}`,
      title: x.job_title ?? "",
      company: x.employer_name ?? "",
      location: [x.job_city, x.job_state, x.job_country].filter(Boolean).join(", ") || (x.job_is_remote ? "Remote" : ""),
      remote: !!x.job_is_remote,
      postedAt: posted,
      salary: money(x.job_min_salary, x.job_max_salary, x.job_salary_currency || "USD", x.job_salary_period || ""),
      type: (x.job_employment_type ?? "").replace(/_/g, " ").toLowerCase(),
      description: plain(x.job_description),
      sources: matches.map((m) => m.publisher),
      applyOptions: [...matches, ...rest].slice(0, 5)
    });
  }
  return out;
}

/* ---------------- free open feeds ---------------- */
async function fromRemotive(q: string): Promise<JobListing[]> {
  const base = process.env.REMOTIVE_URL || "https://remotive.com/api/remote-jobs";
  const d = (await getJson(`${base}?limit=100&search=${encodeURIComponent(q)}`)) as {
    jobs?: { id?: number; title?: string; company_name?: string; candidate_required_location?: string; publication_date?: string; url?: string; job_type?: string; salary?: string; description?: string }[];
  };
  return (d.jobs ?? []).flatMap<JobListing>((x) => {
    const url = safeUrl(x.url);
    if (!url) return [];
    return [{
      id: `rm-${x.id ?? url}`,
      title: x.title ?? "",
      company: x.company_name ?? "",
      location: x.candidate_required_location || "Remote",
      remote: true,
      postedAt: x.publication_date ? new Date(x.publication_date).toISOString() : "",
      salary: (x.salary ?? "").trim(),
      type: (x.job_type ?? "").replace(/_/g, " "),
      description: plain(x.description),
      sources: ["Remotive"],
      applyOptions: [{ publisher: "Remotive", url }]
    }];
  });
}

async function fromRemoteOK(q: string): Promise<JobListing[]> {
  const d = (await getJson(process.env.REMOTEOK_URL || "https://remoteok.com/api", { "User-Agent": "JobTailor/1.0" })) as {
    id?: string; slug?: string; position?: string; company?: string; location?: string; tags?: string[]; date?: string; epoch?: number;
    salary_min?: number; salary_max?: number; url?: string; apply_url?: string; description?: string;
  }[];
  const w = words(q);
  return d
    .filter((x) => x.position && x.company)
    .filter((x) => {
      const hay = `${x.position} ${(x.tags ?? []).join(" ")}`.toLowerCase();
      return w.every((t) => hay.includes(t));
    })
    .flatMap<JobListing>((x) => {
      const url = safeUrl(x.apply_url) || safeUrl(x.url);
      if (!url) return [];
      return [{
        id: `ro-${x.id ?? x.slug}`,
        title: x.position ?? "",
        company: x.company ?? "",
        location: x.location || "Remote",
        remote: true,
        postedAt: x.date ? new Date(x.date).toISOString() : x.epoch ? new Date(x.epoch * 1000).toISOString() : "",
        salary: money(x.salary_min, x.salary_max, "USD", "year"),
        type: "",
        description: plain(x.description),
        sources: ["RemoteOK"],
        applyOptions: [{ publisher: "RemoteOK", url }]
      }];
    });
}

async function fromArbeitnow(q: string, remote: boolean): Promise<JobListing[]> {
  const d = (await getJson(process.env.ARBEITNOW_URL || "https://www.arbeitnow.com/api/job-board-api")) as {
    data?: { slug?: string; title?: string; company_name?: string; location?: string; remote?: boolean; tags?: string[]; job_types?: string[]; created_at?: number; url?: string; description?: string }[];
  };
  const w = words(q);
  const hay = (x: { title?: string; tags?: string[] }) => `${x.title ?? ""} ${(x.tags ?? []).join(" ")}`.toLowerCase();
  const all = (d.data ?? []).filter((x) => !remote || x.remote);
  let match = all.filter((x) => w.every((t) => hay(x).includes(t)));
  if (!match.length) match = all.filter((x) => w.some((t) => hay(x).includes(t)));
  return match.flatMap<JobListing>((x) => {
    const url = safeUrl(x.url);
    if (!url) return [];
    return [{
      id: `an-${x.slug ?? url}`,
      title: x.title ?? "",
      company: x.company_name ?? "",
      location: `${x.location ?? ""}${x.remote ? " (remote)" : ""}`.trim(),
      remote: !!x.remote,
      postedAt: x.created_at ? new Date(x.created_at * 1000).toISOString() : "",
      salary: "",
      type: (x.job_types ?? []).join(", "),
      description: plain(x.description),
      sources: ["Arbeitnow"],
      applyOptions: [{ publisher: "Arbeitnow", url }]
    }];
  });
}

/* ---------------- handler ---------------- */
const cache = new Map<string, { at: number; jobs: JobListing[]; warnings: string[] }>();
const TTL = 15 * 60_000; // saves the free JSearch quota

export async function GET(req: NextRequest) {
  if (!(await getUser(req))) return json({ error: "Please sign in to search jobs." }, 401);

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim().slice(0, 80);
  const loc = (sp.get("loc") || "").trim().slice(0, 60);
  const remote = sp.get("remote") === "1";
  const salaryOnly = sp.get("salary") === "1";
  const days = [1, 3, 7].includes(Number(sp.get("days"))) ? Number(sp.get("days")) : 7;
  const country = COUNTRIES[sp.get("country") || ""] ?? "us";
  const chosen = (sp.get("sources") || "linkedin,indeed,glassdoor").split(",").map((s) => s.trim().toLowerCase());
  if (!q) return json({ error: "Enter a job title." }, 400);
  if (!chosen.some(Boolean)) return json({ error: "Pick at least one job site." }, 400);

  const ck = JSON.stringify([q, loc, remote, days, country, [...chosen].sort()]);
  const hit = cache.get(ck);
  let all: JobListing[];
  let warnings: string[];

  if (hit && Date.now() - hit.at < TTL) {
    all = hit.jobs;
    warnings = hit.warnings;
  } else {
    const boards = chosen.filter((s) => ["linkedin", "indeed", "glassdoor"].includes(s));
    const jobs: Promise<JobListing[]>[] = [];
    const labels: string[] = [];
    warnings = [];

    if (boards.length) {
      if (process.env.RAPIDAPI_KEY) {
        jobs.push(fromJSearch(q, loc, country, remote, days, boards));
        labels.push(boards.join("/"));
      } else {
        warnings.push("LinkedIn, Indeed and Glassdoor need a RAPIDAPI_KEY on the server (free JSearch plan). Ask the site owner to add it. Showing the other sites only.");
      }
    }
    if (chosen.includes("remotive")) { jobs.push(fromRemotive(q)); labels.push("Remotive"); }
    if (chosen.includes("remoteok")) { jobs.push(fromRemoteOK(q)); labels.push("RemoteOK"); }
    if (chosen.includes("arbeitnow")) { jobs.push(fromArbeitnow(q, remote)); labels.push("Arbeitnow"); }

    if (!jobs.length) return json({ jobs: [], warnings });

    const res = await Promise.allSettled(jobs);
    all = [];
    res.forEach((r, i) => {
      if (r.status === "fulfilled") all.push(...r.value);
      else warnings.push(`${labels[i]} could not be loaded right now.`);
    });
    if (res.every((r) => r.status === "rejected")) return json({ error: "The job sources could not be reached right now. Try again shortly." }, 502);
    cache.set(ck, { at: Date.now(), jobs: all, warnings });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  }

  // filters: posted within N days, remote, location, salary, then merge duplicates
  const cutoff = Date.now() - days * 24 * 3_600_000;
  const l = loc.toLowerCase();
  let list = all.filter((j) => j.title && j.applyOptions.length);
  list = list.filter((j) => {
    const t = Date.parse(j.postedAt);
    return t ? t >= cutoff : false; // jobs with no date are dropped, so "last 24 hours" stays honest
  });
  if (remote) list = list.filter((j) => j.remote);
  if (l && !remote) {
    const near = list.filter((j) => j.location.toLowerCase().includes(l) || j.remote);
    if (near.length) list = near;
  }
  if (salaryOnly) list = list.filter((j) => j.salary);

  const seen = new Map<string, JobListing>();
  for (const j of list) {
    const k = `${j.title.toLowerCase().trim()}|${j.company.toLowerCase().trim()}`;
    const e = seen.get(k);
    if (!e) {
      seen.set(k, { ...j });
      continue;
    }
    e.sources = Array.from(new Set([...e.sources, ...j.sources]));
    for (const o of j.applyOptions) if (!e.applyOptions.some((x) => x.url === o.url)) e.applyOptions.push(o);
    if (!e.salary) e.salary = j.salary;
    if (!e.description) e.description = j.description;
  }
  const out = Array.from(seen.values()).sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, 60);
  return json({ jobs: out, warnings });
}
