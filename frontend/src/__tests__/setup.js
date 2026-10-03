import { readFileSync } from "fs";
import { join } from "path";
import "@testing-library/jest-dom/vitest";

const FIXTURES = join(process.cwd(), "test-fixtures");
function load(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf-8"));
}

const trueskill = load("trueskill.json");
const draftAnalysis = load("draftanalysis.json");
const tournaments = load("tournaments.json");
const raw = load("raw.json");
const rawMatches = load("rawmatches.json");
const player = load("player.json");
const champion = load("champion.json");
const meta = load("meta.json");
const presets = load("presets.json");

// jsdom doesn't implement these -- our components use them defensively
// (ResizeObserver for sticky-column measurement and the profile chart's
// responsive width, matchMedia for the theme's OS-preference detection).
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia =
  window.matchMedia ||
  (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

global.fetch = vi.fn((url) => {
  const u = String(url);
  const json = (data, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });
  if (u.startsWith("/api/trueskill")) return json(trueskill);
  if (u.startsWith("/api/draft-analysis")) return json(draftAnalysis);
  if (u.startsWith("/api/tournaments")) return json(tournaments);
  if (u.startsWith("/api/raw-matches")) return json(rawMatches);
  if (u.startsWith("/api/raw-matches.csv")) return json({});
  if (u.startsWith("/api/raw.csv")) return json({});
  if (u.startsWith("/api/raw")) return json(raw);
  if (u.startsWith("/api/meta")) return json(meta);
  if (u.startsWith("/api/presets")) return json(presets);
  if (u.startsWith("/api/upcoming-roster")) return json({ error: "not found" }, 404);
  if (u.startsWith("/api/player/")) return json(player);
  if (u.startsWith("/api/champion/")) return json(champion);
  return Promise.reject(new Error(`Unmocked fetch: ${u}`));
});
