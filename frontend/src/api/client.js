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
  champion: (key) => getJson(`/api/champion/${encodeURIComponent(key)}`),
  raw: () => getJson("/api/raw"),
  rawMatches: () => getJson("/api/raw-matches"),
  upcomingRoster: async () => {
    const res = await fetch("/api/upcoming-roster");
    if (res.status === 404) return null;
    return res.json();
  },
};

// ---- sign-in and match editing ---------------------------------------------
// Everything below talks to routes the server only honors for signed-in,
// authorized editors. The UI hides the controls from everyone else, but that
// is a convenience -- the server is what actually refuses.

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function sendJson(url, { method = "GET", csrfToken, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error body (e.g. a proxy page): fall through to ApiError below.
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const authApi = {
  me: () => sendJson("/api/auth/me"),
  logout: (csrfToken) => sendJson("/auth/logout", { method: "POST", csrfToken, body: {} }),
};

export const editorApi = {
  getMatch: (matchKey) => sendJson(`/api/editor/matches/${encodeURIComponent(matchKey)}`),
  saveMatch: (matchKey, body, csrfToken) =>
    sendJson(`/api/editor/matches/${encodeURIComponent(matchKey)}`, { method: "PUT", csrfToken, body }),
  getTournamentStructure: (year, tournament) =>
    sendJson(`/api/editor/tournaments/${year}/${encodeURIComponent(tournament)}/structure`),
  saveTournamentStages: (year, tournament, stages, csrfToken) =>
    sendJson(`/api/editor/tournaments/${year}/${encodeURIComponent(tournament)}/stages`, {
      method: "PUT",
      csrfToken,
      body: { stages },
    }),
  createSeries: (year, tournament, body, csrfToken) =>
    sendJson(`/api/editor/tournaments/${year}/${encodeURIComponent(tournament)}/series`, {
      method: "POST",
      csrfToken,
      body,
    }),
  updateGameStructure: (year, tournament, assignments, csrfToken) =>
    sendJson(`/api/editor/tournaments/${year}/${encodeURIComponent(tournament)}/games`, {
      method: "PUT",
      csrfToken,
      body: { assignments },
    }),
  updateGameRounds: (year, tournament, rounds, csrfToken) =>
    sendJson(`/api/editor/tournaments/${year}/${encodeURIComponent(tournament)}/rounds`, {
      method: "PUT",
      csrfToken,
      body: { rounds },
    }),
  addSeriesGame: (year, tournament, seriesId, body, csrfToken) =>
    sendJson(
      `/api/editor/tournaments/${year}/${encodeURIComponent(tournament)}/series/${encodeURIComponent(seriesId)}/games`,
      { method: "POST", csrfToken, body },
    ),
};

export function downloadUrl(path, filename) {
  const a = document.createElement("a");
  a.href = path;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
