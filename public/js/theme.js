const THEME_STORAGE_KEY = "lol-draft-theme";

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const themeToggleBtn = document.getElementById("themeToggle");
  if (themeToggleBtn) {
    themeToggleBtn.textContent = theme === "light" ? "☀️" : "🌙";
  }
}

export function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}

export function initTheme() {
  const themeToggleBtn = document.getElementById("themeToggle");
  if (!themeToggleBtn) return;

  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    applyTheme(stored);
  } else {
    const prefersLight =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    applyTheme(prefersLight ? "light" : "dark");
  }

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
      if (localStorage.getItem(THEME_STORAGE_KEY)) return;
      applyTheme(e.matches ? "light" : "dark");
    });
  }

  themeToggleBtn.addEventListener("click", () => {
    const next = currentTheme() === "light" ? "dark" : "light";
    applyTheme(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
  });
}
