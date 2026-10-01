// Tracks which real tab (trueskill/draftiq/etc.) was last active, so the
// player-profile page's Back button always has somewhere sane to land even
// when someone opened a /player/... link directly (no in-app history to pop
// back to). Mirrors the module-level `lastKnownTab` in the old
// player-profile.js.
export const routeState = {
  lastKnownTab: "trueskill",
  lastTournamentId: null,
};
