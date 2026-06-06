export type Theme = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "hermes_theme";

// Inline pre-paint script: runs in <head> before React hydrates.
// Reads localStorage, falls back to OS preference, sets `dark` class on <html>.
export const themeBootstrapScript = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored !== 'light' && prefersDark);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
`;
