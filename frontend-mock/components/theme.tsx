"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "light" | "dark" | "system";

const KEY = "casa_theme";

interface ThemeState {
  mode: Mode;
  resolved: "light" | "dark";
  setMode: (m: Mode) => void;
}

const ThemeContext = React.createContext<ThemeState | null>(null);

/** Runs before paint so the page never flashes the wrong theme. */
export const themeScript = `
(function(){
  try {
    var m = localStorage.getItem("${KEY}") || "system";
    var d = m === "dark" || (m === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", d);
    document.documentElement.style.colorScheme = d ? "dark" : "light";
  } catch (e) {}
})();
`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<Mode>("system");
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  const apply = React.useCallback((m: Mode) => {
    const dark =
      m === "dark" ||
      (m === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    setResolved(dark ? "dark" : "light");
  }, []);

  React.useEffect(() => {
    const stored = (localStorage.getItem(KEY) as Mode) || "system";
    setModeState(stored);
    apply(stored);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem(KEY) as Mode) === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [apply]);

  const setMode = React.useCallback(
    (m: Mode) => {
      localStorage.setItem(KEY, m);
      setModeState(m);
      apply(m);
    },
    [apply]
  );

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

const OPTIONS: { value: Mode; icon: React.ElementType; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "System" },
  { value: "dark", icon: Moon, label: "Dark" },
];

/** Three-way segmented control: light / system / dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5",
        className
      )}
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = mode === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={`${o.label} theme`}
            onClick={() => setMode(o.value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
