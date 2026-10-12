"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import { CoachAvatar } from "@/components/Illustrations";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { AIError, askAI } from "@/lib/ai";
import { coachSystem } from "@/lib/prompts";
import type { ChatMessage } from "@/types";

interface Bubble {
  id: number;
  role: "bot" | "me";
  text: string;
}

const GREETING = "Hi! I'm your career coach. I can see your job post, resume and results. Ask me anything, or tap a question below.";
const SUGGESTIONS = ["What should I fix in my resume first?", 'How do I answer "Tell me about yourself"?', "Help me prepare to negotiate salary"];

export function CoachChat() {
  const { job, resume, sections } = useApp();
  const [open, setOpen] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hist = useRef<ChatMessage[]>([]);
  const counter = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [bubbles]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        fab.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open && window.innerWidth > 640) input.current?.focus();
  }, [open]);

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setError("");
    const meId = ++counter.current;
    const botId = ++counter.current;
    setBubbles((b) => [...b, { id: meId, role: "me", text: q }, { id: botId, role: "bot", text: "" }]);
    setText("");
    setBusy(true);
    const next: ChatMessage[] = [...hist.current, { role: "user", content: q }];
    const msgs = next.map((m, i) =>
      i === 0 ? { ...m, content: `${coachSystem(job, resume, sections)}\n\nMy first message:\n${m.content}` } : m
    );
    try {
      const reply = await askAI(msgs, (full) => setBubbles((b) => b.map((x) => (x.id === botId ? { ...x, text: full } : x))));
      hist.current = [...next, { role: "assistant", content: reply }];
    } catch (e) {
      setBubbles((b) => b.filter((x) => x.id !== meId && x.id !== botId));
      setText(q);
      setError(e instanceof AIError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="Career coach chat"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[min(80dvh,660px)] origin-bottom-right flex-col overflow-hidden rounded-t-[20px] border border-line bg-panel pb-[env(safe-area-inset-bottom)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.4)] sm:inset-x-auto sm:bottom-[84px] sm:right-[18px] sm:h-[min(580px,calc(100dvh-150px))] sm:w-[400px] sm:rounded-[20px]"
          >
            <header className="flex items-center gap-2.5 border-b border-line bg-gradient-to-b from-accent/10 to-transparent px-4 py-3.5">
              <CoachAvatar className="h-[38px] w-[38px] shrink-0" />
              <div className="min-w-0 flex-1 leading-tight">
                <b>Career coach</b>
                <span className="note block">Knows your job post, resume and results</span>
              </div>
              <Button variant="icon" aria-label="Close chat" onClick={() => { setOpen(false); fab.current?.focus(); }}><X size={18} /></Button>
            </header>

            <div ref={log} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3.5">
              <div className="max-w-[88%] self-start rounded-2xl rounded-bl-[5px] bg-soft px-3.5 py-2.5 text-[15px] leading-relaxed">{GREETING}</div>
              {bubbles.map((b) => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed",
                    b.role === "me" ? "self-end rounded-br-[5px] bg-brand text-accent-ink" : "self-start rounded-bl-[5px] bg-soft"
                  )}
                >
                  {b.text || <Loader2 size={16} className="animate-spin" aria-label="Thinking" />}
                </motion.div>
              ))}
            </div>

            {bubbles.length === 0 && (
              <div className="flex flex-wrap gap-1.5 px-3.5 pb-2.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line bg-panel px-3 py-1.5 text-left text-[13px] font-semibold transition-colors hover:border-accent hover:text-accent">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {error && <p role="alert" className="px-3.5 pb-2.5 text-sm font-semibold text-err">{error}</p>}

            <div className="flex items-end gap-2 border-t border-line px-3 py-2.5">
              <textarea
                ref={input}
                rows={1}
                value={text}
                aria-label="Your message"
                placeholder="Ask anything about this application"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(text);
                  }
                }}
                className="field h-11 max-h-[110px] min-h-0 resize-none !font-sans"
              />
              <Button onClick={() => ask(text)} disabled={busy || !text.trim()} aria-label="Send" className="!px-4 !py-[11px]">
                <Send size={17} />
              </Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <motion.button
        ref={fab}
        type="button"
        aria-expanded={open}
        aria-label={open ? "Close coach chat" : "Open coach chat"}
        onClick={() => setOpen((o) => !o)}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-[max(18px,env(safe-area-inset-bottom))] right-[max(18px,env(safe-area-inset-right))] z-[45] flex items-center gap-2 rounded-full bg-brand p-3.5 font-bold text-accent-ink shadow-glow-lg sm:px-[18px] sm:py-[13px]"
      >
        <MessageCircle size={20} />
        <span className="hidden sm:inline">Ask the coach</span>
      </motion.button>
    </>
  );
}
