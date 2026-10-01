// Thin wrappers over the existing Express API (server.js) -- unchanged on
// the backend, this is purely the front-end porting to React.

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Request failed (${res.status}): ${url}`);
  return res.json();
}

export const api = {
  meta: () => getJson("/api/meta"),
  trueskill: () => getJson("/api/trueskill"),
  presets: () => getJson("/api/presets", { cache: "no-store" }),
  preset: (id) => getJson(`/api/presets/${encodeURIComponent(id)}`, { cache: "no-store" }),
  draftAnalysis: () => getJson("/api/draft-analysis"),
  placements: () => getJson("/api/placements"),
  tournaments: () => getJson("/api/tournaments"),
  player: (keyOrSlug) => getJson(`/api/player/${keyOrSlug}`),
  raw: () => getJson("/api/raw"),
  rawMatches: () => getJson("/api/raw-matches"),
  upcomingRoster: async () => {
    const res = await fetch("/api/upcoming-roster");
    if (res.status === 404) return null;
    return res.json();
  },
};

export function downloadUrl(path, filename) {
  const a = document.createElement("a");
  a.href = path;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
