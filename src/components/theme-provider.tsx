"use client";

import { Moon, Sun } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ACCENTS, DEFAULT_ACCENT, isAccent, type Accent } from "@/lib/accent";
import { DEFAULT_TEXT_SIZE, isTextSize, TEXT_SIZES, type TextSize } from "@/lib/text-size";

const STORAGE_KEY = "ai-multi-theme";
const ACCENT_STORAGE_KEY = "ai-multi-accent";
const TEXT_SIZE_STORAGE_KEY = "ai-multi-text-size";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  textSize: TextSize;
  setTextSize: (textSize: TextSize) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "light";

  const savedTheme = localStorage.getItem(STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getPreferredAccent(): Accent {
  if (typeof window === "undefined") return DEFAULT_ACCENT;

  const savedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
  return isAccent(savedAccent) ? savedAccent : DEFAULT_ACCENT;
}

/** Picks the accent palette in globals.css (DES-15). */
function applyAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent;
}

function getPreferredTextSize(): TextSize {
  if (typeof window === "undefined") return DEFAULT_TEXT_SIZE;

  const savedTextSize = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
  return isTextSize(savedTextSize) ? savedTextSize : DEFAULT_TEXT_SIZE;
}

/** Picks the root font size in globals.css (DES-19). */
function applyTextSize(textSize: TextSize) {
  document.documentElement.dataset.textSize = textSize;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getPreferredTheme());
  const [accent, setAccentState] = useState<Accent>(() => getPreferredAccent());
  const [textSize, setTextSizeState] = useState<TextSize>(() => getPreferredTextSize());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  useEffect(() => {
    applyTextSize(textSize);
  }, [textSize]);

  // A choice is saved when someone makes it, never when the app starts (#526). A save on start
  // wrote back the value the first render read, over anything stored in between, such as a
  // test's setItem right after a page shows. Until someone picks a theme, each load follows
  // the device's light or dark setting.
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const setAccent = useCallback((next: Accent) => {
    setAccentState(next);
    localStorage.setItem(ACCENT_STORAGE_KEY, next);
  }, []);

  const setTextSize = useCallback((next: TextSize) => {
    setTextSizeState(next);
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => {
        setTheme(theme === "dark" ? "light" : "dark");
      },
      accent,
      setAccent,
      textSize,
      setTextSize,
    }),
    [theme, accent, textSize, setTheme, setAccent, setTextSize],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}

export function ThemeToggle() {
  const { toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink transition-colors hover:bg-surface-hover"
      aria-label="Toggle theme"
    >
      {/* The init script sets the dark class before hydration, so CSS picks the icon. */}
      <Sun aria-hidden="true" className="h-4 w-4 text-muted dark:hidden" />
      <Moon aria-hidden="true" className="hidden h-4 w-4 text-muted dark:block" />
      Theme
    </button>
  );
}

export function ThemeInitScript() {
  const script = `(() => {
    const STORAGE_KEY = '${STORAGE_KEY}';
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme === 'light' || savedTheme === 'dark'
      ? savedTheme
      : (prefersDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const savedAccent = localStorage.getItem('${ACCENT_STORAGE_KEY}');
    document.documentElement.dataset.accent = ${JSON.stringify(ACCENTS.map((accent) => accent.id))}.includes(savedAccent)
      ? savedAccent
      : '${DEFAULT_ACCENT}';
    const savedTextSize = localStorage.getItem('${TEXT_SIZE_STORAGE_KEY}');
    document.documentElement.dataset.textSize = ${JSON.stringify(TEXT_SIZES.map((size) => size.id))}.includes(savedTextSize)
      ? savedTextSize
      : '${DEFAULT_TEXT_SIZE}';
  })();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
