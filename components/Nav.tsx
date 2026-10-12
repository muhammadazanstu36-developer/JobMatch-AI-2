"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import { LogoMark } from "@/components/Illustrations";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";
import type { TabKey } from "@/types";

const ITEMS = [
  { id: "tailor", label: "Tailor" },
  { id: "resume", label: "Resume" },
  { id: "letter", label: "Cover letter" },
  { id: "fit", label: "Fit notes" },
  { id: "interview", label: "Mock interview" },
  { id: "jobs", label: "Find jobs" },
  { id: "help", label: "How it works" }
] as const;

const TABS: string[] = ["resume", "letter", "fit", "interview"];
const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Nav() {
  const { setTab, setHelpOpen, user, openAuth, logout } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (id: string) => {
    setOpen(false);
    if (id === "help") {
      setHelpOpen((o) => !o);
      return window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (!user && id !== "help") return openAuth("register");
    if (TABS.includes(id)) {
      setTab(id as TabKey);
      return scrollToId("results");
    }
    scrollToId(id);
  };

  const desktopItems = ITEMS;

  return (
    <header
      ref={box}
      className="fixed inset-x-0 top-0 z-40 border-b border-line bg-panel pt-[env(safe-area-inset-top)] shadow-[0_10px_24px_-18px_var(--shadow)]"
    >
      <div className="mx-auto flex h-[60px] max-w-[1160px] items-center gap-3.5 px-3 sm:px-5">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="flex shrink-0 items-center gap-2 text-lg font-extrabold tracking-tight no-underline"
        >
          <LogoMark className="h-[26px] w-[26px]" />
          <span className="bg-brand bg-clip-text text-transparent">Tailor</span>
        </a>

        <nav aria-label="Main menu" className="ml-auto hidden items-center gap-0.5 nav:flex">
          {desktopItems.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => go(i.id)}
              className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-mute transition-colors hover:bg-soft hover:text-accent"
            >
              {i.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 nav:ml-0">
          <ThemeToggle />
          {user ? (
            <>
              <span className="hidden max-w-[140px] truncate text-sm font-semibold text-mute nav:inline" title={user.email}>
                {user.name}
              </span>
              <Button variant="ghost" onClick={() => void logout()} className="hidden nav:inline-flex">
                <LogOut size={15} /> Log out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => openAuth("login")} className="hidden nav:inline-flex">
                Sign in
              </Button>
              <Button onClick={() => openAuth("register")} className="hidden !px-[18px] !py-2 text-sm nav:inline-flex">
                <UserPlus size={16} /> Sign up
              </Button>
            </>
          )}
          <Button
            variant="icon"
            className="nav:hidden"
            aria-label="Menu"
            title="Menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={open ? "x" : "bars"}
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="grid place-items-center"
              >
                {open ? <X size={20} /> : <Menu size={20} />}
              </motion.span>
            </AnimatePresence>
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            id="mobile-menu"
            aria-label="Menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-x-0 top-full max-h-[calc(100dvh-76px)] overflow-y-auto border-b border-line bg-panel px-3 py-2 shadow-[0_24px_40px_-20px_rgba(0,0,0,0.35)] nav:hidden"
          >
            {ITEMS.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => go(i.id)}
                className="block w-full rounded-lg px-3 py-3.5 text-left text-base font-semibold text-ink transition-colors hover:bg-soft hover:text-accent"
              >
                {i.label}
              </button>
            ))}
            <div className="mt-1 border-t border-line pt-1">
              {user ? (
                <button type="button" onClick={() => { setOpen(false); void logout(); }} className="block w-full rounded-lg px-3 py-3.5 text-left text-base font-semibold text-ink hover:bg-soft hover:text-accent">
                  Log out ({user.name})
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => { setOpen(false); openAuth("login"); }} className="block w-full rounded-lg px-3 py-3.5 text-left text-base font-semibold text-ink hover:bg-soft hover:text-accent">Sign in</button>
                  <button type="button" onClick={() => { setOpen(false); openAuth("register"); }} className="block w-full rounded-lg px-3 py-3.5 text-left text-base font-semibold text-ink hover:bg-soft hover:text-accent">Sign up</button>
                </>
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
