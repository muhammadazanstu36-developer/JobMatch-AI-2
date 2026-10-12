# job-tailor-next: structure and build sequence

Next.js 14 (App Router) + React 18 + Tailwind 3 + framer-motion. TypeScript passes `tsc --noEmit` with no errors.

## Folder structure

```
job-tailor-next/
├── package.json / package-lock.json     dependencies and scripts
├── next.config.mjs, tsconfig.json       framework + TS config
├── tailwind.config.ts, postcss.config.mjs
├── next-env.d.ts
├── .env.example                         copy to .env.local and fill in
├── .gitignore
├── README.md
├── data/users.json                      account store (starts empty)
├── public/icons/                        PWA icons (192, 512, maskable, apple-touch)
├── types/index.ts                       shared types
├── lib/                                 logic, no UI
│   ├── cn.ts                            class-name helper
│   ├── sample.ts                        sample resume / job text
│   ├── jobs.ts                          countries, sources, date helpers
│   ├── prompts.ts                       AI prompt builders
│   ├── parse.ts                         parse AI output
│   ├── ai.ts                            client-side wrapper for /api/ai
│   └── auth.ts                          users file, scrypt hashing, signed cookies
├── app/
│   ├── globals.css
│   ├── layout.tsx
│   ├── manifest.ts
│   ├── page.tsx                         assembles the whole page
│   └── api/
│       ├── auth/[action]/route.ts       register | login | logout | me
│       ├── ai/route.ts                  multi-provider AI proxy (auth required)
│       └── jobs/route.ts                job search + filters + cache (auth required)
└── components/
    ├── ui/Button.tsx
    ├── AppContext.tsx                   global state: user, resume, results
    ├── (landing) Nav, Hero, Features, HowItWorks, Footer, Wallpaper, Illustrations, ThemeToggle
    ├── (access)  AuthDialog, Gate
    └── (tools)   TailorForm, Results, ScoreCard, MockInterview, CoachChat, JobFinder
```

## Build / reading sequence (each layer depends only on earlier layers)

| # | Layer | Files |
|---|-------|-------|
| 1 | Config | package.json, next.config.mjs, tsconfig.json, tailwind.config.ts, postcss.config.mjs, .env.example |
| 2 | Types | types/index.ts |
| 3 | Leaf utilities | lib/cn.ts, lib/sample.ts, lib/jobs.ts |
| 4 | Prompts and parsing | lib/prompts.ts, lib/parse.ts (parse imports prompts) |
| 5 | Server auth | lib/auth.ts |
| 6 | API routes | app/api/auth/[action], app/api/ai, app/api/jobs |
| 7 | Client AI wrapper | lib/ai.ts |
| 8 | UI primitives | components/ui/Button.tsx, ThemeToggle, Illustrations, Wallpaper, ScoreCard |
| 9 | App state | components/AppContext.tsx |
| 10 | Access | components/AuthDialog.tsx, Gate.tsx |
| 11 | Landing | Nav, Hero, Features, HowItWorks, Footer |
| 12 | Tools | TailorForm, MockInterview, Results, CoachChat, JobFinder |
| 13 | Shell | app/globals.css, layout.tsx, manifest.ts, page.tsx |

## Run

```
npm install
cp .env.example .env.local    # set AUTH_SECRET and GEMINI_API_KEY (and RAPIDAPI_KEY for jobs)
npm run dev
```
