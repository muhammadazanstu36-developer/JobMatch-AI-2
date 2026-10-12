"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "icon";

const base = "inline-flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed";
const variants: Record<Variant, string> = {
  primary:
    "rounded-xl bg-brand px-6 py-3 font-bold text-accent-ink shadow-glow transition-shadow hover:shadow-glow-lg disabled:opacity-70",
  ghost:
    "rounded-[10px] border border-line bg-panel px-3.5 py-2 text-sm font-semibold text-ink hover:border-accent hover:bg-soft disabled:opacity-60",
  icon: "h-[42px] w-[42px] rounded-xl border border-line bg-panel p-0 text-ink hover:border-accent hover:bg-soft"
};

export function Button({
  variant = "primary",
  className,
  disabled,
  ...props
}: HTMLMotionProps<"button"> & { variant?: Variant }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={cn(base, variants[variant], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: HTMLMotionProps<"a"> & { variant?: Variant }) {
  return (
    <motion.a
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className={cn(base, variants[variant], "no-underline", className)}
      {...props}
    />
  );
}
