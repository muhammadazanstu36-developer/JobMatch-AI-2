# Job Application Tailor (Next.js)

Copyright © 2026 Muhammad Azan

Tailor your resume and cover letter to a job post, get a match score, practice interviews, chat with a career
coach, and search recent jobs from LinkedIn, Indeed, Glassdoor and more, all inside your own site.

## Setup (about 5 minutes)

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - **AI key (free):** `GEMINI_API_KEY` from https://aistudio.google.com/apikey (no card needed).
     Groq or OpenRouter keys also work. `ANTHROPIC_API_KEY` is still supported but is paid.
   - **`AUTH_SECRET`:** any long random string. Generate one with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - **`RAPIDAPI_KEY`:** free JSearch plan (https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch).
     This is what brings in LinkedIn, Indeed and Glassdoor listings. Without it, only Remotive, RemoteOK and
     Arbeitnow work.
3. `npm run dev` and open http://localhost:3000

## What changed in this version

- **Free AI:** `/api/ai` now works with Gemini, Groq, OpenRouter or Anthropic. First key found wins, or force one with `AI_PROVIDER`.
- **Accounts:** people must register and sign in before using any tool. Passwords are hashed (scrypt); login is a
  signed HttpOnly cookie. `/api/ai` and `/api/jobs` reject anyone who is not signed in.
- **Jobs inside your site:** pick LinkedIn / Indeed / Glassdoor / Remotive / RemoteOK / Arbeitnow (any mix). Results
  appear on the page with salary range, how long ago they were posted, a details view, and Apply buttons that go to the
  job's own application page. Filter: last 24 hours, 3 days or 7 days; remote only; only jobs with a salary.

## Honest limits

- **Applying itself happens on the job site.** LinkedIn, Indeed and Glassdoor do not let other websites submit
  applications for a user, so the Apply button opens that job's application page in a new tab. The browsing, filtering and
  reading all stay on your site.
- **LinkedIn / Indeed / Glassdoor have no public job API** and forbid scraping. JSearch is a third-party service that
  collects Google-for-Jobs listings and the sites they link to. The free plan is small (about 200 requests per month); results
  are cached for 15 minutes and `JSEARCH_PAGES` controls how many requests each search uses. Check their current plans.
- **Salary** only appears when the employer published it. Many jobs, especially in Pakistan, do not list one.
  Jobs with no posting date are hidden so the time filter stays accurate.
- **Accounts are stored in `data/users.json`.** That works on a normal server or VPS with a persistent disk. It will
  **not** work on Vercel or other serverless hosts (the file is lost). For those, replace the three "storage" functions in
  `lib/auth.ts` with a database such as Supabase or Neon. There is no password reset or email verification yet.
- This was written without internet access, so it has **not been run or type-checked**. Run `npm install`, then
  `npm run typecheck` and `npm run dev`, and test sign-up, an AI tailor, and a job search once before going live.
- Free AI model names change over time. If you see "No usable model was found", set `AI_MODEL` to a current model name.

## Layout

```
app/api/ai/route.ts          AI proxy (needs sign-in), multi-provider
app/api/jobs/route.ts        job search: JSearch + Remotive + RemoteOK + Arbeitnow, filters, dedupe, cache
app/api/auth/[action]/       register, login, logout, me
lib/auth.ts                  users file, password hashing, signed sessions
lib/jobs.ts                  countries, sources, date helpers
components/AuthDialog.tsx    sign-up / sign-in popup
components/Gate.tsx          shows tools only to signed-in people
components/JobFinder.tsx     job search UI
```
