import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefersDark;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      style={{ width: 34, height: 34 }}
      className="inline-flex items-center justify-center rounded-[6px] border-0 bg-transparent text-fg-2 cursor-pointer transition-colors hover:bg-surface-hover hover:text-fg-1"
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
