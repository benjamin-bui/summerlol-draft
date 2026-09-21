import {
  escapeHtml,
  renderNameWithTag,
  renderTrueSkillValue,
  renderSoloQueueRank,
  getRankTier,
  renderChampionIcon,
  renderBanList,
  renderRoleIcon,
  renderRoleLabel,
  ROLES,
  sortByRole,
  buildPlayerSlug,
  round3,
  seasonRankLocal,
} from "./utils.js";

const playerProfileBackBtn = document.getElementById("playerProfileBack");
const playerProfileContent = document.getElementById("playerProfileContent");
const playerProfileTitle = document.getElementById("playerProfileTitle");

// Set once from app.js via initPlayerProfile({ activatePanel }) -- this is
// the *same* setActiveTab() every normal tab click uses, just handed down
// instead of duplicated here. See the README's "known recurring bug
// pattern" note: two copies of panel-activation logic drifting apart is
// exactly the shape of bug this avoids.
let activatePanel = () => {};
// Set once from app.js via initPlayerProfile({ ensureTiersReady }) -- lets
// loadPlayerProfilePage guarantee rank-badge tier cutoffs exist before it
// renders, without player-profile.js needing to know anything about how
// or where that data comes from.
let ensureTiersReady = async () => {};
// URL for a given tab. app.js overrides this so tabs that keep extra state in
// the URL (Tournaments remembers the selected tournament) get it back when
// the Back button rebuilds the URL itself.
let getTabUrl = (tab) => `/?tab=${encodeURIComponent(tab)}`;
// Tracks which real tab (trueskill/draftiq/etc.) the profile page should
// fall back to if the back button is used with no safe browser-history
// entry to return to (e.g. someone opened a /player/... link directly).
let lastKnownTab = "trueskill";

// One session-wide fetch, reused across every profile page and every
// search on that page -- a team's own placement (used for "their
// placement" in the "played against" summary) doesn't change while the
// tab is open, so there's no reason to refetch it per search or per
// profile navigated to.
let placementsCache = null;
let placementsPromise = null;
async function getPlacements() {
  if (placementsCache) return placementsCache;
  if (!placementsPromise) {
    placementsPromise = fetch("/api/placements")
      .then((res) => res.json())
      .then((data) => {
        placementsCache = data.placements || {};
        return placementsCache;
      })
      .catch(() => ({}));
  }
  return placementsPromise;
}

// State for whichever profile page is currently on screen -- rebuilt each
// time loadPlayerProfilePage renders a new one. Holds what the "played
// with / played against" search needs on every keystroke and selection,
// so those handlers don't have to re-derive it (or worse, read it back
// out of already-rendered DOM).
let profileSearch = null;

const PLAYER_PATH_RE = /^\/player\/([^/]+)$/;
const SIMPLE_PLAYER_PATH_RE = /^\/player\/simple\/([^/]+)$/;

// Reads the player identifier straight out of the URL path -- left in its
// still-percent-encoded form (not decoded here), since both consumers
// below either use it as-is (loadPlayerProfilePage, where an identityKey
// has no special characters and a slug is already a valid path segment)
// or decode it themselves component-by-component after splitting
// (unslugSimpleName). Used both on first load and from the popstate
// handler -- there is exactly one function that knows how to parse this
// URL shape, and exactly one function (loadPlayerProfilePage /
// loadSimpleProfilePage) that knows how to act on it.
export function parsePlayerRouteFromPath(pathname = window.location.pathname) {
  const simpleMatch = pathname.match(SIMPLE_PLAYER_PATH_RE);
  if (simpleMatch) {
    return { kind: "simple", value: simpleMatch[1] };
  }
  const match = pathname.match(PLAYER_PATH_RE);
  if (match) {
    return { kind: "identity", value: match[1] };
  }
  return null;
}

// Called by app.js any time a real tab becomes active, so the back button
// always has somewhere sane to land.
export function notifyActiveTab(tabName) {
  if (tabName && tabName !== "player") lastKnownTab = tabName;
}

function goBack() {
  const cameFromThisSite =
    document.referrer && document.referrer.startsWith(window.location.origin);
  if (cameFromThisSite && window.history.length > 1) {
    window.history.back();
  } else {
    // Direct/shared link with no in-app history to pop back to -- land on
    // whichever tab we last knew about instead of leaving the site.
    window.history.pushState(null, "", getTabUrl(lastKnownTab));
    activatePanel(lastKnownTab);
  }
}

function buildChartHtml(history, containerWidth = 0) {
  if (!history.length) {
    return '<p class="profile-chart-empty">No games recorded yet.</p>';
  }

  const xMax = history.length;
  // Width grows with game count instead of stretching to fit the
  // container -- a fixed px-per-game spacing keeps circles/text at a
  // constant, undistorted size regardless of how many games there are.
  // For a small game count, though, a fixed spacing would leave the
  // chart far short of a reasonable width -- rather than padding that
  // out with blank canvas past the last point (or, worse, pinning a
  // single point to the left edge with nothing but empty space to its
  // right), spacing widens to fill a modest target width instead, so
  // there's always something drawn across the whole chart. Past
  // roughly two dozen games this converges back to the base spacing and
  // the chart just grows with the game count, scrolling horizontally as
  // it already did.
  const basePxPerGame = 26;
  const targetFilledWidth = 600;
  const height = 260;
  const padL = 45;
  const padR = 15;
  const padT = 15;
  const padB = 30;
  const naturalWidth =
    xMax <= 1
      ? 240
      : (() => {
          const spanCount = xMax - 1;
          const pxPerGame = Math.max(basePxPerGame, targetFilledWidth / spanCount);
          return padL + padR + pxPerGame * spanCount;
        })();
  // On a wide display, the natural (game-count-driven) width is often
  // narrower than the actual space available in the header panel,
  // leaving a slab of blank canvas to the right -- growing to fill
  // whatever room the container actually has (never shrinking below the
  // natural width, so a player with enough games to need scrolling still
  // scrolls) fixes that without touching the per-game spacing logic
  // above at all.
  const width = Math.max(naturalWidth, containerWidth || 0);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const points = history.map((h, i) => ({
    x: i + 1,
    trueskill: h.conservativeRating,
    mu: h.mu,
    sigma: h.sigma,
    outcome: h.outcome,
    opponent: h.opponent,
    year: h.year,
    tournament: h.tournament,
  }));

  const yMin = Math.min(...points.map((p) => p.trueskill));
  const yMax = Math.max(...points.map((p) => p.trueskill));
  const yPad = (yMax - yMin) * 0.05 || 1;

  // A lone point has no second point to anchor against, so the usual
  // "spread first-to-last across the full width" formula degenerates to
  // pinning it at the left edge -- center it instead.
  const xScale = (x) =>
    xMax <= 1 ? padL + plotW / 2 : padL + ((x - 1) / (xMax - 1)) * plotW;
  const yScale = (y) =>
    padT +
    plotH -
    ((y - (yMin - yPad)) / (yMax + yPad - (yMin - yPad))) * plotH;

  const badgeSize = 16;
  const badgeOffset = 6;

  const badges = points
    .map((p) => {
      const tier = getRankTier(p.trueskill);
      const tierName = tier && tier.name ? tier.name.toLowerCase() : "unranked";
      const iconPath = `/icons/${tierName}.webp`;
      const cx = xScale(p.x);
      const cy = yScale(p.trueskill);
      const imgX = cx - badgeSize / 2;
      const imgY = cy - badgeSize - badgeOffset;

      return `
      <image href="${iconPath}" x="${imgX}" y="${imgY}" width="${badgeSize}" height="${badgeSize}">
        <title>${tier ? tier.name : "Unranked"} Rank</title>
      </image>`;
    })
    .join("");

  const trueskillPath = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.trueskill)}`,
    )
    .join(" ");

  const outcomeColor = { win: "#2e7d32", loss: "#c62828" };
  const dots = points
    .map(
      (p) => `
    <circle cx="${xScale(p.x)}" cy="${yScale(p.trueskill)}" r="3.5" fill="${outcomeColor[p.outcome] || "#888"}">
    <title>${escapeHtml(`${p.year} ${p.tournament}${p.matchStage ? " (" + p.matchStage + ")" : ""} vs ${p.opponent}: ${p.outcome} (TrueSkill = ${p.trueskill}, μ=${p.mu}, σ=${p.sigma})`)}</title>
    </circle>`,
    )
    .join("");

  const ticks = 4;
  const gridlines = Array.from({ length: ticks + 1 }, (_, i) => {
    const val = yMin - yPad + (yMax + yPad - (yMin - yPad)) * (i / ticks);
    const y = yScale(val);
    return `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#eee" stroke-width="1" />
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#888">${val.toFixed(1)}</text>`;
  }).join("");

  // Consecutive games sharing the same year+tournament, in order -- used
  // both for the dashed tournament-boundary lines and the x-axis labels
  // below, so a run of games always gets exactly one line marking where
  // it starts and one label naming it, no matter how many tournaments a
  // player has been through.
  const segments = [];
  points.forEach((p, i) => {
    const last = segments[segments.length - 1];
    if (last && last.year === p.year && last.tournament === p.tournament) {
      last.endIndex = i;
    } else {
      segments.push({ year: p.year, tournament: p.tournament, startIndex: i, endIndex: i });
    }
  });

  // Dashed line in the gap between the last game of one tournament and
  // the first game of the next -- nothing to mark a boundary against
  // before the very first game, so that one's skipped.
  const tournamentBoundaries = segments
    .slice(1)
    .map((seg, idx) => {
      const prevSeg = segments[idx]; // segments[idx] is the segment right before `seg`, since seg itself is segments[idx + 1] here
      const prevX = xScale(points[prevSeg.endIndex].x);
      const nextX = xScale(points[seg.startIndex].x);
      const boundaryX = (prevX + nextX) / 2;
      return `<line x1="${boundaryX}" y1="${padT}" x2="${boundaryX}" y2="${padT + plotH}" stroke="#bbb" stroke-width="1" stroke-dasharray="4 3" />`;
    })
    .join("");

  // One label per tournament, centered under its span of games, replacing
  // the old generic "Game 1"/"Game N" endpoints. Skipped for a segment
  // too narrow to fit "Tournament YYYY" without overlapping its
  // neighbors -- the dashed boundary line still marks it either way, so
  // nothing is silently dropped, just its label on very short stints.
  const minLabelWidth = 50;
  const xAxisLabels = segments
    .map((seg) => {
      const xStart = xScale(points[seg.startIndex].x);
      const xEnd = xScale(points[seg.endIndex].x);
      if (segments.length > 1 && xEnd - xStart < minLabelWidth) return "";
      const midX = (xStart + xEnd) / 2;
      return `<text x="${midX}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#888">${escapeHtml(seg.tournament)} ${escapeHtml(String(seg.year))}</text>`;
    })
    .join("");

  return `
    <div class="profile-chart-scroll">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="profile-chart-svg">
        ${gridlines}
        ${tournamentBoundaries}
        <path d="${trueskillPath}" fill="none" stroke="#2b6cb0" stroke-width="2" />
        ${dots}
        ${badges}
        ${xAxisLabels}
      </svg>
    </div>
    <div class="profile-chart-legend">
      <span><i style="background:#2e7d32"></i> win</span>
      <span><i style="background:#c62828"></i> loss</span>
    </div>`;
}

// Shared "N of M" formatter for both the pick-order and entering-rank
// sidebar rows -- same fallback rule (missing either half of the pair
// means we show a dash, not a half-formed fraction).
function ofTotal(n, total) {
  return n != null && total != null ? `${n} / ${total}` : "–";
}

function tournamentKey(t) {
  return `${t.year}::${t.tournament}`;
}

// ---- Summary panel: percentiles, champion diversity, best/worst co-play ----

// "Picked Nth of M" -> what fraction of the way through the draft you
// were picked (lower = picked earlier = better). Captains have no pick
// order at all (they were never in the pool of pickable players to
// begin with), so they're excluded rather than assigned some
// placeholder rank.
function pickPercentile(t) {
  if (typeof t.pickOrder !== "number" || !t.totalPicks) return null;
  return (t.pickOrder / t.totalPicks) * 100;
}

// Same idea for final placement against the number of teams that
// tournament actually had -- unlike pick order, every appearance
// (captain or pick) has a placement, so this one always applies.
function placementPercentile(t) {
  if (t.finalPlacement == null || !t.totalTeams) return null;
  return (t.finalPlacement / t.totalTeams) * 100;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Gini-Simpson diversity index over champion pick distribution: 1 minus
// the probability that two of this player's games, picked at random,
// were on the same champion. 0 = always the same champion, close to 1 =
// evenly spread across many different ones.
function computeChampionDiversity(championStats) {
  const total = championStats.reduce((sum, c) => sum + c.games, 0);
  if (!total) return null;
  const sumSquares = championStats.reduce(
    (sum, c) => sum + Math.pow(c.games / total, 2),
    0,
  );
  return 1 - sumSquares;
}

// Every teammate/opponent's win rate playing with/against this player,
// plus enough to break a tie the way the summary panel wants to: most
// games first, then whether they ever captained the shared team, then
// genuinely random. isCaptain is derived from the team name matching
// their own display name (a captain's team is named after them), since
// roster entries don't carry an explicit "is captain" flag.
function computeCoPlayRecords(history, selfKey) {
  const withMap = new Map();
  const againstMap = new Map();
  for (const entry of history) {
    const isWin = entry.outcome === "win";
    for (const m of entry.ownTeam?.roster || []) {
      if (!m.identityKey || m.identityKey === selfKey) continue;
      if (!withMap.has(m.identityKey)) {
        withMap.set(m.identityKey, {
          identityKey: m.identityKey,
          name: m.displayName,
          games: 0,
          wins: 0,
          captainGames: 0,
        });
      }
      const rec = withMap.get(m.identityKey);
      rec.games += 1;
      if (isWin) rec.wins += 1;
      if (m.displayName === entry.ownTeam?.name) rec.captainGames += 1;
    }
    for (const m of entry.opponentTeam?.roster || []) {
      if (!m.identityKey) continue;
      if (!againstMap.has(m.identityKey)) {
        againstMap.set(m.identityKey, {
          identityKey: m.identityKey,
          name: m.displayName,
          games: 0,
          wins: 0,
          captainGames: 0,
        });
      }
      const rec = againstMap.get(m.identityKey);
      rec.games += 1;
      if (isWin) rec.wins += 1; // "win rate against them" is from this player's own perspective
      if (m.displayName === entry.opponentTeam?.name) rec.captainGames += 1;
    }
  }
  return { withMap, againstMap };
}

function pickExtreme(map, mode) {
  const entries = [...map.values()].map((r) => ({
    ...r,
    winRate: r.games ? r.wins / r.games : 0,
    isCaptain: r.captainGames > 0,
  }));
  if (!entries.length) return null;
  entries.sort((a, b) => {
    const winDiff = mode === "max" ? b.winRate - a.winRate : a.winRate - b.winRate;
    if (winDiff !== 0) return winDiff;
    if (b.games !== a.games) return b.games - a.games; // most games first
    if (b.isCaptain !== a.isCaptain) return (b.isCaptain ? 1 : 0) - (a.isCaptain ? 1 : 0); // then favor a captain
    return Math.random() - 0.5; // otherwise genuinely random
  });
  return entries[0];
}

function renderSummaryPlayerLink(rec) {
  if (!rec) return '<span class="profile-summary-coplay-value stat-formula">–</span>';
  const slug = buildPlayerSlug(rec.name) || rec.identityKey;
  const pct = Math.round(rec.winRate * 100);
  return `<span class="profile-summary-coplay-value"><a href="/player/${slug}" class="player-link" data-player-key="${escapeHtml(slug)}">${renderNameWithTag(rec.name)}</a> <span class="stat-formula">(${pct}%, ${rec.games} g)</span></span>`;
}

// Share of this player's games spent in each role. Only games with a role
// recorded count -- a game with no Role in the CSV isn't "no role", it's
// unknown -- so the percentages always add to 100 over the games we know about.
// Returns "" when no game has a role, so profiles without role data show nothing.
// Full role names for text ("Supp" is stored, "Support" is shown).
const ROLE_NAMES = { Top: "Top", Jungle: "Jungle", Mid: "Mid", Bot: "Bot", Supp: "Support" };

function renderRoleBreakdown(history) {
  const counts = new Map(ROLES.map((role) => [role, 0]));
  let total = 0;
  for (const entry of history) {
    const role = entry.playerDetails?.[0]?.role;
    if (!counts.has(role)) continue;
    counts.set(role, counts.get(role) + 1);
    total += 1;
  }
  if (!total) return "";
  const rows = ROLES.map((role) => {
    const games = counts.get(role);
    const pct = Math.round((games / total) * 100);
    return `<div class="role-row" title="${games} of ${total} games">
        <span>${role}</span>
        <span class="role-bar"><span style="width:${(games / total) * 100}%"></span></span>
        <strong>${pct}%</strong>
      </div>`;
  }).join("");
  return `<div class="profile-summary-roles">
      <h4>Role breakdown <span class="stat-formula">(${total} ${total === 1 ? "game" : "games"} with a role)</span></h4>
      ${rows}
    </div>`;
}

function renderSummaryPanelBlock(player, tournaments, championStats, history) {
  const avgPick = average(tournaments.map(pickPercentile).filter((v) => v != null));
  const avgPlacement = average(
    tournaments.map(placementPercentile).filter((v) => v != null),
  );
  const diversity = computeChampionDiversity(championStats);
  const { withMap, againstMap } = computeCoPlayRecords(history, player?.identityKey);
  const bestWith = pickExtreme(withMap, "max");
  const worstWith = pickExtreme(withMap, "min");
  const bestAgainst = pickExtreme(againstMap, "max");
  const worstAgainst = pickExtreme(againstMap, "min");

  const fmtPct = (v) => (v != null ? `${Math.round(v)}%` : "–");

  return `<section class="profile-block profile-summary-block">
    <h3>Summary</h3>
    <div class="profile-summary-stats">
      <div><span>Average pick percentile</span><strong>${fmtPct(avgPick)}</strong></div>
      <div><span>Average placement percentile</span><strong>${fmtPct(avgPlacement)}</strong></div>
      <div><span title="Gini-Simpson index">Champion Diversity</span><strong>${diversity != null ? diversity.toFixed(2) : "–"}</strong></div>
    </div>
    ${renderRoleBreakdown(history)}
    <div class="profile-summary-coplay">
      <div><span>Best win rate with</span>${renderSummaryPlayerLink(bestWith)}</div>
      <div><span>Worst win rate with</span>${renderSummaryPlayerLink(worstWith)}</div>
      <div><span>Best win rate against</span>${renderSummaryPlayerLink(bestAgainst)}</div>
      <div><span>Worst win rate against</span>${renderSummaryPlayerLink(worstAgainst)}</div>
    </div>
  </section>`;
}

// A separate block above Tournaments rather than folded into its header --
// this filter also drives the match history table below, not just the
// Tournaments block, so it reads as its own control rather than looking
// like it only scopes the one block it happens to sit next to.
function renderTournamentFilterBlock(tournaments) {
  if (!tournaments.length) return "";
  // Each dropdown option is one tournament *instance* ("Winter 2026"), not
  // just the tournament name -- a player with multiple Winters/Summers on
  // record can filter down to exactly one of them, not just the season.
  const sorted = [...tournaments].sort(
    (a, b) => b.year - a.year || seasonRankLocal(b.tournament) - seasonRankLocal(a.tournament),
  );
  const options = sorted
    .map(
      (t) =>
        `<option value="${escapeHtml(tournamentKey(t))}">${escapeHtml(t.tournament)} ${escapeHtml(String(t.year))}</option>`,
    )
    .join("");
  return `<section class="profile-block profile-filter-block">
    <div class="profile-filter-row">
      <span>Filtered for:</span>
      <select id="tournamentFilterSelect" class="tournament-filter-select">
        <option value="">All</option>
        ${options}
      </select>
    </div>
  </section>`;
}

function renderTournamentRows(tournaments) {
  return tournaments
    .map((t) => {
      const record = t.games ? `${t.wins}-${t.losses}` : "–";
      const winRate =
        t.games && t.winRate != null ? `${Math.round(t.winRate * 100)}%` : "–";
      const placement =
        t.finalPlacement != null
          ? `#${t.finalPlacement}${t.totalTeams ? `/${t.totalTeams}` : ""}`
          : "–";
      // "Captain" is a label, not a position -- don't format it as "N / M"
      // the way an actual pick order gets formatted below.
      const pick =
        t.pickOrder === "Captain" ? "Captain" : ofTotal(t.pickOrder, t.totalPicks);
      return `<tr>
        <td>${escapeHtml(t.tournament)} ${escapeHtml(String(t.year))}</td>
        <td>${winRate} <span class="stat-formula">(${record})</span></td>
        <td>${placement}</td>
        <td>${pick}</td>
      </tr>`;
    })
    .join("");
}

function renderTournamentsBlock(tournaments) {
  if (!tournaments.length) {
    return `<section class="profile-block"><h3>Tournaments</h3><p class="stat-formula">No draft history recorded.</p></section>`;
  }
  return `<section class="profile-block">
    <h3>Tournaments</h3>
    <table>
      <thead><tr><th>Tournament</th><th>Win rate</th><th>Placement</th><th>Pick</th></tr></thead>
      <tbody id="tournamentsTableBody">${renderTournamentRows(tournaments)}</tbody>
    </table>
  </section>`;
}

function renderTrueSkillBlock(player, tournaments) {
  const currentLine = `<div class="profile-current-rank">
    ${renderTrueSkillValue(player.conservativeRating, player.mu)}
    <span class="stat-formula">#${player.overallRank ?? "–"} of ${player.totalPlayers ?? "–"} overall</span>
  </div>`;
  const withEntry = tournaments.filter(
    (t) => t.entryConservativeRating != null,
  );
  const rows = withEntry
    .map(
      (t) => `<tr>
        <td>${escapeHtml(t.tournament)} ${escapeHtml(String(t.year))}</td>
        <td>${ofTotal(t.entryRank ? `#${t.entryRank}` : null, t.totalInDraft)}</td>
        <td>${renderTrueSkillValue(t.entryConservativeRating)}</td>
      </tr>`,
    )
    .join("");
  const table = withEntry.length
    ? `<table>
        <thead><tr><th>Tournament</th><th>Entering rank</th><th>Entering rating</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    : `<p class="stat-formula">No entering-rank history yet (needs at least one prior tournament on record).</p>`;
  return `<section class="profile-block">
    <h3>TrueSkill</h3>
    ${currentLine}
    ${table}
  </section>`;
}

// Extra columns a caller can append after the four standard ones. The player
// profile adds "bannedAgainst"; the Tournaments tab adds "bans" and "contest".
// A champion that was only ever banned (games = 0) was never played, so it has
// no win rate or KDA -- shown as "–", not "Perfect".
const CHAMPION_EXTRA_CELLS = {
  bannedAgainst: (c) => (c.bannedAgainst == null ? "–" : String(c.bannedAgainst)),
  bans: (c) => String(c.bans ?? 0),
  // Contest rate = games the champion was picked or banned in / games with
  // champion data; the caller supplies that game count as options.contestGames.
  contest: (c, { contestGames }) =>
    contestGames ? `${Math.round(((c.contested ?? c.games) / contestGames) * 100)}%` : "–",
};

// Exported so the Tournaments tab renders its champion table with the exact
// same markup as this page's Champions block.
export function renderChampionRows(championStats, options = {}) {
  const extras = options.extras || [];
  if (!championStats.length) {
    return `<tr><td colspan="${4 + extras.length}" class="stat-formula">No champion data for this filter.</td></tr>`;
  }
  return championStats
    .map((c) => {
      const played = c.games > 0;
      const winRate = played && c.winRate != null ? `${Math.round(c.winRate * 100)}%` : "–";
      const kda = !played ? "–" : c.kda == null ? "Perfect" : c.kda.toFixed(2);
      const extraCells = extras
        .map((id) => `<td>${CHAMPION_EXTRA_CELLS[id](c, options)}</td>`)
        .join("");
      return `<tr>
        <td>${renderChampionIcon(c.champion)}</td>
        <td>${c.games}</td>
        <td>${winRate}</td>
        <td>${kda}</td>
        ${extraCells}
      </tr>`;
    })
    .join("");
}

// Whether any of these games have a ban recorded for either team.
function historyHasBans(history) {
  return history.some(
    (e) => (e.bans?.own?.length || 0) + (e.bans?.opponent?.length || 0) > 0,
  );
}

// ---- champion table sorting
//
// Click a header to sort by it; click again to flip the direction. Two rules
// hold no matter which column or direction is active:
//   1. Champions this player actually played always come before champions that
//      were only ever banned against them (games = 0) -- even when sorting by
//      Games ascending, where the zero-game rows would otherwise lead.
//   2. Ties on the sorted column are broken by number of games, highest first
//      (only the primary comparison flips with the direction), then by the
//      table's default order so equal rows never shuffle.
// A fresh profile has no sort applied and shows the default order (most games
// first).
const compareNumbers = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
const CHAMPION_SORTS = {
  champion: {
    label: "Champion",
    firstDir: "asc", // names read A -> Z first; numbers highest first
    compare: (a, b) => a.champion.localeCompare(b.champion, undefined, { sensitivity: "base" }),
  },
  games: { label: "Games", firstDir: "desc", compare: (a, b) => compareNumbers(a.games, b.games) },
  winRate: {
    label: "Win rate",
    firstDir: "desc",
    compare: (a, b) => compareNumbers(a.winRate ?? -1, b.winRate ?? -1),
  },
  kda: {
    label: "KDA",
    firstDir: "desc",
    // Zero deaths ("Perfect", sent as null) is the best KDA there is.
    compare: (a, b) =>
      compareNumbers(a.kda === null ? Infinity : a.kda, b.kda === null ? Infinity : b.kda),
  },
  bannedAgainst: {
    label: "Banned against",
    firstDir: "desc",
    // null = no ban data at all for these games, so every row ties.
    compare: (a, b) => compareNumbers(a.bannedAgainst ?? -1, b.bannedAgainst ?? -1),
  },
};

// `stats` is in default order; returns a new, sorted array.
function sortChampionStats(stats, sort) {
  const column = sort?.column;
  if (!column) return [...stats];
  const sign = sort.dir === "asc" ? 1 : -1;
  const { compare } = CHAMPION_SORTS[column];
  return stats
    .map((champion, index) => ({ champion, index }))
    .sort((x, y) => {
      const a = x.champion;
      const b = y.champion;
      const playedFirst = (b.games > 0) - (a.games > 0);
      if (playedFirst) return playedFirst;
      const primary = compare(a, b);
      if (primary) return sign * primary;
      return b.games - a.games || x.index - y.index;
    })
    .map((entry) => entry.champion);
}

function championSortAttrs(column) {
  const sort = profileSearch?.championSort;
  const active = sort?.column === column;
  const asc = sort?.dir === "asc";
  return {
    cls: active ? (asc ? "sorted-asc" : "sorted-desc") : "",
    aria: active ? (asc ? "ascending" : "descending") : "none",
  };
}

function championSortHeader(column, hint = null, extraClass = "") {
  const { cls, aria } = championSortAttrs(column);
  const label = CHAMPION_SORTS[column].label;
  const title = hint ? `${hint} Click to sort.` : `Sort by ${label.toLowerCase()}`;
  const classes = [extraClass, cls].filter(Boolean).join(" ");
  return `<th${classes ? ` class="${classes}"` : ""} data-champion-sort="${column}" tabindex="0" aria-sort="${aria}" title="${escapeHtml(title)}">${label}</th>`;
}

function toggleChampionSort(column) {
  if (!profileSearch || !CHAMPION_SORTS[column]) return;
  const current = profileSearch.championSort;
  profileSearch.championSort =
    current.column === column
      ? { column, dir: current.dir === "asc" ? "desc" : "asc" }
      : { column, dir: CHAMPION_SORTS[column].firstDir };
  renderChampionsTable(
    profileSearch.displayedChampionStats || profileSearch.championStats,
  );
  document
    .querySelectorAll("#profileChampionsTable th[data-champion-sort]")
    .forEach((th) => {
      const { cls, aria } = championSortAttrs(th.dataset.championSort);
      th.classList.remove("sorted-asc", "sorted-desc");
      if (cls) th.classList.add(cls);
      th.setAttribute("aria-sort", aria);
    });
}

function renderChampionsBlock(championStats, extras = []) {
  if (!championStats.length) {
    return `<section class="profile-block"><h3>Champions</h3><p class="stat-formula">No champion data recorded yet.</p></section>`;
  }
  const bannedAgainstHeader = extras.includes("bannedAgainst")
    ? championSortHeader(
        "bannedAgainst",
        "Games where an opposing team banned this champion. Bans are a team-level choice, so this isn't specific to this player. Champions banned against them but never played show 0 games.",
        "col-banned-against",
      )
    : "";
  const sorted = sortChampionStats(championStats, profileSearch?.championSort);
  return `<section class="profile-block">
    <h3>Champions</h3>
    <table id="profileChampionsTable" class="profile-champions-table">
      <thead><tr>${championSortHeader("champion")}${championSortHeader("games")}${championSortHeader("winRate")}${championSortHeader("kda")}${bannedAgainstHeader}</tr></thead>
      <tbody id="championsTableBody">${renderChampionRows(sorted, { extras })}</tbody>
    </table>
  </section>`;
}

// Same aggregation the server does once, career-wide, in /api/player/:key
// -- reimplemented here so the Champions block can be recomputed
// client-side for whatever subset of games the tournament filter (and/or
// played-with/against search) currently has selected, without a round
// trip back to the server for every filter change.
function computeChampionStats(historyEntries) {
  // Bans first: how many games an opposing team banned each champion in,
  // counted once per game. `bannedAgainst` stays null (shown "–") when none
  // of these games have any ban recorded, so "no data" never reads as 0.
  const hasBanData = historyHasBans(historyEntries);
  const bannedAgainstByKey = new Map();
  const bannedNameByKey = new Map();
  for (const entry of historyEntries) {
    const seenThisGame = new Set();
    for (const ban of entry.bans?.opponent || []) {
      if (!ban.key || seenThisGame.has(ban.key)) continue;
      seenThisGame.add(ban.key);
      bannedAgainstByKey.set(ban.key, (bannedAgainstByKey.get(ban.key) || 0) + 1);
      if (!bannedNameByKey.has(ban.key)) bannedNameByKey.set(ban.key, ban.champion);
    }
  }

  const championMap = new Map();
  for (const entry of historyEntries) {
    const detail = entry.playerDetails?.[0];
    if (!detail || !detail.champion) continue;
    if (!championMap.has(detail.champion)) {
      championMap.set(detail.champion, {
        champion: detail.champion,
        key: detail.championKey || null,
        games: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
      });
    }
    const c = championMap.get(detail.champion);
    c.games += 1;
    if (entry.outcome === "win") c.wins += 1;
    else if (entry.outcome === "loss") c.losses += 1;
    c.kills += detail.kills ?? 0;
    c.deaths += detail.deaths ?? 0;
    c.assists += detail.assists ?? 0;
  }
  // Champions banned against them but never played still get a row.
  const playedKeys = new Set([...championMap.values()].map((c) => c.key));
  for (const [key, name] of bannedNameByKey) {
    if (playedKeys.has(key)) continue;
    championMap.set(`ban-only::${key}`, {
      champion: name,
      key,
      games: 0,
      wins: 0,
      losses: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
    });
  }
  // Same ordering as /api/player/:key: played champions by games (ties keep
  // first-played order), then ban-only rows, most-banned first.
  return [...championMap.values()]
    .map((c) => ({
      ...c,
      winRate: c.games ? round3(c.wins / c.games) : null,
      kda: c.deaths > 0 ? round3((c.kills + c.assists) / c.deaths) : null,
      bannedAgainst: hasBanData ? bannedAgainstByKey.get(c.key) || 0 : null,
    }))
    .sort(
      (a, b) =>
        b.games - a.games ||
        (a.games === 0
          ? (b.bannedAgainst ?? 0) - (a.bannedAgainst ?? 0) ||
            a.champion.localeCompare(b.champion)
          : 0),
    );
}

// Updates just the Champions block's rows in place -- used by every
// filter change (tournament filter, played-with/against search) rather
// than each one re-deriving how to touch the DOM itself.
// `championStats` is in default order (whatever the filter in effect produced);
// the active header sort, if any, is applied here so it survives filter changes.
function renderChampionsTable(championStats) {
  const tbody = document.getElementById("championsTableBody");
  if (profileSearch) profileSearch.displayedChampionStats = championStats;
  if (tbody) {
    tbody.innerHTML = renderChampionRows(
      sortChampionStats(championStats, profileSearch?.championSort),
      { extras: profileSearch?.championExtras || [] },
    );
  }
}

// Builds the <table> markup for a set of history entries -- shared by the
// full match history (all games) and the "played with / played against"
// search (a filtered subset), so there is exactly one place that knows
// how to render a match row rather than two copies that could drift.
// Entries are rendered in the order given; callers control chronology.
function buildHistoryTableHtml(historyEntries) {
  if (!historyEntries.length) {
    return "<p>No matching games.</p>";
  }
  const showRole = !!profileSearch?.historyHasRoles;
  const rows = historyEntries
    .map((entry, idx) => {
      const outcomeClass =
        entry.outcome === "win"
          ? "outcome-win"
          : entry.outcome === "loss"
            ? "outcome-loss"
            : "outcome-draw";
      const rosterId = `roster-detail-${idx}`;
      const playerDetail = entry.playerDetails?.[0];
      const normalizePlayer = (value) =>
        String(value || "")
          .trim()
          .toLowerCase();
      const detailsByPlayer = new Map(
        (entry.details || []).map((detail) => [
          normalizePlayer(detail.player),
          detail,
        ]),
      );
      const hasDetails = (entry.details || []).length > 0;
      // Someone in this game has a role -> players without one get an empty
      // icon slot so the names still line up.
      const gameHasRoles = (entry.details || []).some((d) => d.role);
      const gameHasBans =
        (entry.bans?.own?.length || 0) + (entry.bans?.opponent?.length || 0) > 0;
      const rosterTable = (team, name, bans) => {
        // Top -> Supp when roles were recorded for this game.
        const orderedRoster = sortByRole(
          team?.roster || [],
          (member) =>
            detailsByPlayer.get(normalizePlayer(member.displayName))?.role,
        );
        const rows = orderedRoster
          .map((member) => {
            const detail = detailsByPlayer.get(
              normalizePlayer(member.displayName),
            );
            const slug = member.identityKey
              ? buildPlayerSlug(member.displayName) || member.identityKey
              : null;
            const nameCell = slug
              ? `<a href="/player/${slug}" class="player-link" data-player-key="${escapeHtml(slug)}">${escapeHtml(member.displayName)}</a>`
              : escapeHtml(member.displayName);
            return `<tr><td>${renderRoleIcon(detail?.role, { reserveSpace: gameHasRoles })}${nameCell}</td><td>${renderTrueSkillValue(member.conservativeRating)}</td>${
              hasDetails
                ? `<td>${detail ? renderChampionIcon(detail.champion) : "–"}</td><td>${detail?.kills ?? "–"}</td><td>${detail?.deaths ?? "–"}</td><td>${detail?.assists ?? "–"}</td>`
                : ""
            }</tr>`;
          })
          .join("");
        const detailHeaders = hasDetails
          ? "<th>Champion</th><th>K</th><th>D</th><th>A</th>"
          : "";
        return `<div><strong>${escapeHtml(name)}</strong>${gameHasBans ? renderBanList(bans) : ""}<table class="match-details-table"><thead><tr><th>Player</th><th>TrueSkill</th>${detailHeaders}</tr></thead><tbody>${rows}</tbody></table></div>`;
      };

      const changeClass =
        entry.ratingChange > 0
          ? "outcome-win"
          : entry.ratingChange < 0
            ? "outcome-loss"
            : "";
      const changeLabel =
        entry.ratingChange > 0
          ? `+${entry.ratingChange}`
          : `${entry.ratingChange}`;
      const predWinPct = Math.round((entry.predictedWinProb ?? 0) * 100);

      // Matchup and Rating stay hidden on narrow screens (see .col-secondary
      // in style.css) and surface instead in the expanded roster detail's
      // "extra stats" block, so nothing is actually lost on mobile -- it's
      // one tap away instead of extra columns that are mostly blank space
      // next to a two- or three-digit number. Pred. Win % isn't repeated
      // here since it now lives inline under Result on every screen size.
      const extraStatsHtml = `<div class="match-extra-stats">
          ${showRole && playerDetail?.role ? `<div><span>Role</span><strong>${escapeHtml(ROLE_NAMES[playerDetail.role] || playerDetail.role)}</strong></div>` : ""}
          <div><span>Captain</span><strong>${escapeHtml(entry.ownTeam?.name || "–")}</strong></div>
          <div><span>Opponent</span><strong>${escapeHtml(entry.opponent || "–")}</strong></div>
          <div><span>Your Team Avg</span><strong>${entry.ownTeam?.avgConservativeRating ?? "–"}</strong></div>
          <div><span>Opp Avg</span><strong>${entry.opponentTeam?.avgConservativeRating ?? "–"}</strong></div>
          <div><span>TrueSkill</span><strong>${renderTrueSkillValue(entry.conservativeRating)}</strong></div>
          <div><span>Change</span><strong class="${changeClass}">${changeLabel}</strong></div>
          <div><span>μ</span><strong>${entry.mu ?? "–"}</strong></div>
          <div><span>σ</span><strong>${entry.sigma ?? "–"}</strong></div>
        </div>`;

      // Every cell below stacks a primary line with a smaller secondary
      // line underneath rather than spreading related facts across
      // separate columns -- the same pattern on every screen size, so
      // desktop and mobile read the same way and only differ in how many
      // of these stacked cells fit side by side.
      return `<tr>
      <td class="col-toggle"><button class="roster-toggle" data-target="${rosterId}" aria-expanded="false" aria-label="Show match details">▶</button></td>
      <td class="col-match">
        <span class="cell-primary">${escapeHtml(entry.year ?? "–")} ${escapeHtml(entry.tournament || "–")}</span>
        ${entry.matchStage ? `<span class="cell-secondary">${escapeHtml(entry.matchStage)}</span>` : ""}
      </td>
      <td class="col-secondary col-matchup">
        <span class="cell-primary">${escapeHtml(entry.ownTeam?.name || "–")}</span>
        <span class="cell-secondary">vs ${escapeHtml(entry.opponent || "–")}</span>
      </td>
      ${showRole ? `<td class="col-secondary col-role">${renderRoleIcon(playerDetail?.role)}</td>` : ""}
      <td>${playerDetail ? renderChampionIcon(playerDetail.champion) : "–"}</td>
      <td>${playerDetail ? `${playerDetail.kills ?? "–"}/${playerDetail.deaths ?? "–"}/${playerDetail.assists ?? "–"}` : "–"}</td>
      <td class="col-result">
        <span class="cell-primary ${outcomeClass}">${escapeHtml(entry.outcome || "–")}</span>
        <span class="cell-secondary">${predWinPct}% pred.</span>
      </td>
      <td class="col-secondary col-ratings">
        <span class="cell-primary">${entry.ownTeam?.avgConservativeRating ?? "–"}</span>
        <span class="cell-secondary">vs ${entry.opponentTeam?.avgConservativeRating ?? "–"}</span>
      </td>
      <td class="col-secondary col-trueskill">
        <span class="cell-primary">${renderTrueSkillValue(entry.conservativeRating)} <span class="${changeClass}">${changeLabel}</span></span>
        <span class="cell-secondary">μ${entry.mu ?? "–"} σ${entry.sigma ?? "–"}</span>
      </td>
    </tr>
    <tr id="${rosterId}" class="roster-detail-row" hidden>
      <td colspan="${showRole ? 9 : 8}">
        <div class="roster-detail">
          ${rosterTable(entry.ownTeam, entry.ownTeam?.name || "Your team", entry.bans?.own)}
          ${rosterTable(entry.opponentTeam, entry.opponentName || "Opponent", entry.bans?.opponent)}
        </div>
        ${extraStatsHtml}
      </td>
    </tr>`;
    })
    .join("");
  return `<table class="profile-history-table"><thead><tr><th class="col-toggle"><span class="sr-only">Expand</span></th><th class="col-match">Match</th><th class="col-secondary col-matchup">Matchup</th>${showRole ? '<th class="col-secondary col-role">Role</th>' : ""}<th>Champion</th><th>K/D/A</th><th class="col-result">Result</th><th class="col-secondary col-ratings">Avg Rating</th><th class="col-secondary col-trueskill">TrueSkill</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Every teammate/opponent this player's own match history has ever
// touched, keyed by identityKey -- built once per profile load straight
// from data the profile fetch already returned (each history entry's own
// ownTeam/opponentTeam rosters), so the search autocomplete needs no
// extra network round trip. selfKey is excluded from the teammates map
// (a player is always their own teammate, which isn't a useful search
// result); it's never present in the opponents map to begin with.
function buildCoPlayMaps(history, selfKey) {
  const teammates = new Map();
  const opponents = new Map();
  for (const entry of history) {
    for (const m of entry.ownTeam?.roster || []) {
      if (m.identityKey && m.identityKey !== selfKey) {
        teammates.set(m.identityKey, m.displayName);
      }
    }
    for (const m of entry.opponentTeam?.roster || []) {
      if (m.identityKey) opponents.set(m.identityKey, m.displayName);
    }
  }
  return { teammates, opponents };
}

function renderPlayerProfileContent(player, containerWidth) {
  const title = player?.group || player?.identityKey || "Player";
  const titleIdx = title.lastIndexOf("#");
  const nameHtml = titleIdx === -1
    ? escapeHtml(title)
    : `${escapeHtml(title.slice(0, titleIdx))}<span class="player-tag">${escapeHtml(title.slice(titleIdx))}</span>`;

  const headerMeta = [
    `<span>${player?.identified ? "Identified" : "Unidentified"}</span>`,
    player?.profileUrl
      ? `<a href="${escapeHtml(player.profileUrl)}" target="_blank" rel="noopener noreferrer">Open op.gg</a>`
      : "",
    `<span>Games: ${player?.games ?? "–"} &middot; ${player?.wins ?? 0}-${player?.losses ?? 0}</span>`,
    player?.soloQueueRank ? renderSoloQueueRank(player.soloQueueRank) : "",
  ]
    .filter(Boolean)
    .join("");

  const tournaments = player?.tournamentSummaries || [];
  const championStats = player?.championStats || [];
  const history = player?.history || [];

  const historyDescending = [...history].reverse();

  playerProfileTitle.innerHTML = nameHtml;

  // Reset per-page search state -- a fresh profile means a fresh
  // teammate/opponent pool and no filter applied yet.
  const { teammates, opponents } = buildCoPlayMaps(history, player?.identityKey);
  // "Banned against" only appears for players with at least one ban on record
  // in their games; otherwise the Champions table is exactly what it was.
  const championExtras = historyHasBans(history) ? ["bannedAgainst"] : [];
  profileSearch = {
    selfKey: player?.identityKey,
    history,
    tournaments,
    championStats,
    championExtras,
    championSort: { column: null, dir: "desc" },
    // The match history's Role column only appears for players with at least
    // one game that has a role recorded (career-wide, so filtering the table
    // never makes the column come and go).
    historyHasRoles: history.some((e) => e.playerDetails?.[0]?.role),
    displayedChampionStats: championStats,
    teammates,
    opponents,
    mode: "with",
    selectedKey: null,
    tournamentFilter: null,
  };

  return `
    <div class="profile-header">
      <div class="profile-header-top">
        <div class="profile-identity">
          <div class="profile-summary">${headerMeta}</div>
        </div>
      </div>
    </div>
    <div class="profile-layout">
      <aside class="profile-sidebar">
        ${renderSummaryPanelBlock(player, tournaments, championStats, history)}
        ${renderTournamentFilterBlock(tournaments)}
        ${renderTournamentsBlock(tournaments)}
        ${renderTrueSkillBlock(player, tournaments)}
        ${renderChampionsBlock(championStats, championExtras)}
      </aside>
      <main class="profile-main">
        <div class="profile-header-chart">${buildChartHtml(history, containerWidth)}</div>
        ${renderSearchBarHtml()}
        <div id="profileSearchSummary" hidden></div>
        <div id="profileHistoryTableWrap">${buildHistoryTableHtml(historyDescending)}</div>
      </main>
    </div>`;
}

// The search bar itself never needs to be rebuilt once a profile page is
// showing -- only its dropdown, the summary panel, and the history table
// underneath it change as someone types/selects/clears. Keeping this
// static means the input never loses focus or its typed value mid-search.
function renderSearchBarHtml() {
  return `
    <div class="profile-search">
      <select id="profileSearchMode" class="profile-search-mode">
        <option value="with" selected>Played with</option>
        <option value="against">Played Against</option>
      </select>
      <div class="profile-search-box">
        <input
          id="profileSearchInput"
          type="text"
          class="profile-search-input"
          placeholder="Search a teammate..."
          autocomplete="off"
        />
        <button id="profileSearchClear" class="profile-search-clear" type="button" hidden aria-label="Clear search">×</button>
        <div id="profileSearchDropdown" class="profile-search-dropdown" hidden></div>
      </div>
    </div>`;
}

function searchPool() {
  if (!profileSearch) return new Map();
  return profileSearch.mode === "against"
    ? profileSearch.opponents
    : profileSearch.teammates;
}

function updateSearchDropdown(query) {
  const dropdown = document.getElementById("profileSearchDropdown");
  if (!dropdown) return;
  const q = query.trim().toLowerCase();
  if (!q) {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    return;
  }
  const matches = [...searchPool().entries()]
    .filter(([, name]) => name.toLowerCase().includes(q))
    .sort((a, b) => a[1].localeCompare(b[1]))
    .slice(0, 8);
  dropdown.innerHTML = matches.length
    ? matches
        .map(
          ([key, name]) =>
            `<div class="profile-search-suggestion" data-key="${escapeHtml(key)}" data-name="${escapeHtml(name)}">${renderNameWithTag(name)}</div>`,
        )
        .join("")
    : `<div class="profile-search-empty">No matches</div>`;
  dropdown.hidden = false;
}

// The match history "played with/against" filters on top of -- respects
// whatever tournament is currently selected in the "Filtered for:" block,
// so the two filters compose (e.g. "games with this teammate, in this one
// tournament") instead of the tournament filter only affecting the
// Tournaments sidebar block.
function getBaseHistory() {
  if (!profileSearch) return [];
  if (!profileSearch.tournamentFilter) return profileSearch.history;
  return profileSearch.history.filter(
    (h) => tournamentKey(h) === profileSearch.tournamentFilter,
  );
}

// Applies the current mode + selected player: filters the match history to
// just games with them, and builds the "played with/against" summary
// panel above it. The only async part is the shared placements lookup
// (fetched once per session, see getPlacements) -- everything else is
// already sitting in profileSearch from the initial profile fetch.
async function applySearchFilter() {
  if (!profileSearch?.selectedKey) return;
  const { mode, selectedKey, tournaments, tournamentFilter } = profileSearch;
  const history = getBaseHistory();
  const otherName =
    (mode === "against" ? profileSearch.opponents : profileSearch.teammates).get(
      selectedKey,
    ) || selectedKey;

  const filtered = history.filter((entry) => {
    const roster =
      mode === "against" ? entry.opponentTeam?.roster : entry.ownTeam?.roster;
    return (roster || []).some((m) => m.identityKey === selectedKey);
  });

  const wins = filtered.filter((e) => e.outcome === "win").length;
  const losses = filtered.filter((e) => e.outcome === "loss").length;
  const games = filtered.length;
  const winRate = games ? round3(wins / games) : null;

  const placements = await getPlacements();
  // If the mode, selection, or tournament filter changed again while that
  // fetch was in flight, this result is stale -- bail rather than
  // overwrite whatever the more recent selection already rendered.
  if (
    profileSearch.selectedKey !== selectedKey ||
    profileSearch.mode !== mode ||
    profileSearch.tournamentFilter !== tournamentFilter
  ) {
    return;
  }

  const byTournament = new Map();
  for (const entry of filtered) {
    const tKey = `${entry.year}::${entry.tournament}`;
    if (!byTournament.has(tKey)) {
      byTournament.set(tKey, {
        year: entry.year,
        tournament: entry.tournament,
        wins: 0,
        losses: 0,
        games: 0,
      });
    }
    const t = byTournament.get(tKey);
    t.games += 1;
    if (entry.outcome === "win") t.wins += 1;
    else if (entry.outcome === "loss") t.losses += 1;
  }
  const tournamentRows = [...byTournament.values()]
    .map((t) => {
      const tKey = `${t.year}::${t.tournament}`;
      const myPlacement =
        tournaments.find((s) => `${s.year}::${s.tournament}` === tKey)
          ?.finalPlacement ?? null;
      const theirPlacement = placements[`${selectedKey}::${tKey}`] ?? null;
      return { ...t, myPlacement, theirPlacement };
    })
    .sort(
      (a, b) =>
        b.year - a.year || seasonRankLocal(b.tournament) - seasonRankLocal(a.tournament),
    );

  const summaryEl = document.getElementById("profileSearchSummary");
  if (summaryEl) {
    const winRateLabel =
      winRate != null ? `${Math.round(winRate * 100)}%` : "–";
    const heading =
      mode === "against" ? `Played against ${otherName}` : `Played with ${otherName}`;
    const overallLabel =
      mode === "against"
        ? `${winRateLabel} win rate against them (${wins}-${losses})`
        : `${winRateLabel} win rate together (${wins}-${losses})`;
    const rows = tournamentRows
      .map((t) => {
        const record = `${t.wins}-${t.losses}`;
        const mine = t.myPlacement != null ? `#${t.myPlacement}` : "–";
        const theirs = t.theirPlacement != null ? `#${t.theirPlacement}` : "–";
        return mode === "against"
          ? `<tr><td>${escapeHtml(t.tournament)} ${escapeHtml(String(t.year))}</td><td>${record}</td><td>${mine}</td><td>${theirs}</td></tr>`
          : `<tr><td>${escapeHtml(t.tournament)} ${escapeHtml(String(t.year))}</td><td>${record}</td><td>${mine}</td></tr>`;
      })
      .join("");
    const headerRow =
      mode === "against"
        ? "<tr><th>Tournament</th><th>Record vs them</th><th>Your placement</th><th>Their placement</th></tr>"
        : "<tr><th>Tournament</th><th>Record</th><th>Placement</th></tr>";
    summaryEl.hidden = false;
    summaryEl.innerHTML = `
      <section class="profile-block profile-search-summary-block">
        <h3>${escapeHtml(heading)}</h3>
        <div class="profile-current-rank">${escapeHtml(overallLabel)} <span class="stat-formula">(${games} g)</span></div>
        ${
          tournamentRows.length
            ? `<table><thead>${headerRow}</thead><tbody>${rows}</tbody></table>`
            : '<p class="stat-formula">No shared tournaments recorded.</p>'
        }
      </section>`;
  }

  const tableWrap = document.getElementById("profileHistoryTableWrap");
  if (tableWrap) {
    tableWrap.innerHTML = buildHistoryTableHtml([...filtered].reverse());
  }
  renderChampionsTable(computeChampionStats(filtered));
}

function selectSearchPlayer(key, name) {
  if (!profileSearch) return;
  profileSearch.selectedKey = key;
  const input = document.getElementById("profileSearchInput");
  const dropdown = document.getElementById("profileSearchDropdown");
  const clearBtn = document.getElementById("profileSearchClear");
  if (input) input.value = name;
  if (dropdown) {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
  }
  if (clearBtn) clearBtn.hidden = false;
  applySearchFilter();
}

function clearSearch() {
  if (!profileSearch) return;
  profileSearch.selectedKey = null;
  const input = document.getElementById("profileSearchInput");
  const dropdown = document.getElementById("profileSearchDropdown");
  const clearBtn = document.getElementById("profileSearchClear");
  const summaryEl = document.getElementById("profileSearchSummary");
  if (input) input.value = "";
  if (dropdown) {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
  }
  if (clearBtn) clearBtn.hidden = true;
  if (summaryEl) {
    summaryEl.hidden = true;
    summaryEl.innerHTML = "";
  }
  const tableWrap = document.getElementById("profileHistoryTableWrap");
  if (tableWrap && profileSearch.history) {
    tableWrap.innerHTML = buildHistoryTableHtml([...getBaseHistory()].reverse());
  }
  // No played-with/against selection anymore, but the tournament filter
  // (if any) still applies -- restore the exact server-computed
  // career-wide stats when there's no filter at all, since that's
  // guaranteed consistent with what the page loaded with; only fall back
  // to a client-side recompute when a tournament filter narrows things.
  renderChampionsTable(
    profileSearch.tournamentFilter
      ? computeChampionStats(getBaseHistory())
      : profileSearch.championStats,
  );
}

// Loads and renders the identified-player page for a given identityKey,
// and puts the browser at /player/:key. This is the single function
// responsible for both showing the page AND fetching its data -- called
// identically whether the navigation came from a click (push: true) or
// from popstate/direct-load (push: false), so there is exactly one
// "player page init" path rather than two that can drift apart (see the
// README's note on that exact bug shape).
export async function loadPlayerProfilePage(keyOrSlug, { push = true } = {}) {
  if (!keyOrSlug) return;
  // keyOrSlug is already a valid URL path segment -- every emitter builds
  // it with buildPlayerSlug (component-wise encodeURIComponent) or passes
  // a bare identityKey ("p18", no special chars). Re-encoding the whole
  // thing here would double-encode any "%" a slug already contains.
  if (push) {
    window.history.pushState({ playerKey: keyOrSlug }, "", `/player/${keyOrSlug}`);
  }
  activatePanel("player");
  // A rough first-pass estimate, used only until the chart's real
  // container exists in the DOM below -- the chart now lives in the
  // narrower main column (beside the sidebar), not the full-width header,
  // so this initial guess is corrected against the actual measurement
  // once it's actually there. Good enough to avoid a visibly-wrong flash
  // before that correction runs, not meant to be exact.
  const roughChartWidth = Math.max(0, playerProfileContent.clientWidth - 32);
  playerProfileTitle.textContent = "Loading…";
  playerProfileContent.innerHTML = "Loading…";

  try {
    // The API accepts either the internal identityKey or the human-
    // readable slug -- keyOrSlug is normally already a slug (every link
    // that renders one builds it from the player's display name), but old
    // bookmarks/links using a raw identityKey still resolve correctly.
    // Fetched in parallel with the tier-cutoff dependency rank badges
    // need (see ensureTiersReady above) rather than after it, so a direct
    // page load doesn't pay for both round trips back to back.
    const [res] = await Promise.all([
      fetch(`/api/player/${keyOrSlug}`),
      ensureTiersReady(),
    ]);
    if (!res.ok) throw new Error("Player profile not found");
    const player = await res.json();
    playerProfileContent.innerHTML = renderPlayerProfileContent(player, roughChartWidth);
    // Now that .profile-header-chart actually exists (inside the main
    // column, whose real width the rough estimate above couldn't know --
    // it depends on the sidebar's width and the responsive breakpoints,
    // and collapses to full-width itself once the layout stacks on
    // narrow screens), remeasure and rebuild the chart if that estimate
    // was off by enough to matter.
    const chartContainer = playerProfileContent.querySelector(".profile-header-chart");
    if (chartContainer) {
      const actualChartWidth = Math.max(0, chartContainer.clientWidth - 32);
      if (Math.abs(actualChartWidth - roughChartWidth) > 20) {
        chartContainer.innerHTML = buildChartHtml(player.history || [], actualChartWidth);
      }
    }
    // Default the chart's scroll position to the far right (most recent
    // game) rather than the far left (oldest game, game 1) -- what
    // someone opening a profile actually wants to see first. Done after
    // the possible rebuild above, since replacing innerHTML resets scroll.
    const chartScroll = playerProfileContent.querySelector(".profile-chart-scroll");
    if (chartScroll) chartScroll.scrollLeft = chartScroll.scrollWidth;
    // Normalize the address bar to the canonical slug once we know it --
    // covers identityKey-based links and any drift between the slug a
    // link was built from and what the server considers canonical.
    // replaceState, not pushState: this is a correction, not a new page.
    if (player.slug && player.slug !== keyOrSlug) {
      window.history.replaceState({ playerKey: player.slug }, "", `/player/${player.slug}`);
    }
  } catch (err) {
    playerProfileContent.innerHTML = `<p>${escapeHtml(err.message || "Unable to load player profile")}</p>`;
  }
}

// Same idea, for names with no real identity yet (Mock Draft manual
// stubs, Upcoming Roster's unrated players) -- there's no backend record
// to fetch, so this just renders the op.gg-link-only view directly.
//
// Accepts either the original full name (from a click, where we have it
// verbatim) or an already-built slug (from a direct/shared URL, where the
// slug is all we have). isSlug picks which. Both paths converge on the
// same slug for the address bar, so a clicked link and a shared link for
// the same name always end up at the same URL.
export function loadSimpleProfilePage(nameOrSlug, { push = true, isSlug = false } = {}) {
  if (!nameOrSlug) return;
  const slug = isSlug ? nameOrSlug : buildPlayerSlug(nameOrSlug) || encodeURIComponent(nameOrSlug);
  if (push) {
    window.history.pushState({ simpleSlug: slug }, "", `/player/simple/${slug}`);
  }
  activatePanel("player");

  // When we arrived from a click we already have the exact original name
  // to display -- no need to reconstruct it. When we arrived from a URL
  // (direct load/shared link), best-effort split the slug back into
  // gameName#tagLine on its LAST hyphen, which matches how the slug was
  // built (Riot tag lines are short alnum codes that don't contain one).
  let displayName = nameOrSlug;
  let gameName = null;
  let tagLine = null;
  if (isSlug) {
    const idx = slug.lastIndexOf("-");
    gameName = decodeURIComponent(idx === -1 ? slug : slug.slice(0, idx));
    tagLine = idx === -1 ? null : decodeURIComponent(slug.slice(idx + 1));
    displayName = tagLine ? `${gameName}#${tagLine}` : gameName;
  } else {
    const idx = nameOrSlug.lastIndexOf("#");
    if (idx !== -1) {
      gameName = nameOrSlug.slice(0, idx).trim();
      tagLine = nameOrSlug.slice(idx + 1).trim();
    }
  }
  const link = gameName && tagLine
    ? `https://op.gg/lol/summoners/na/${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`
    : null;

  playerProfileTitle.textContent = displayName;
  playerProfileContent.innerHTML = `
    <div class="profile-summary">
      ${
        link
          ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open op.gg</a>`
          : '<span class="stat-formula">No # tag to build an op.gg link from.</span>'
      }
    </div>
    <p class="stat-formula" style="margin-top:12px;">No TrueSkill history for this name yet.</p>
  `;
}

export function initPlayerProfile({
  activatePanel: activatePanelFn,
  ensureTiersReady: ensureTiersReadyFn,
  getTabUrl: getTabUrlFn,
} = {}) {
  if (typeof getTabUrlFn === "function") getTabUrl = getTabUrlFn;
  if (typeof activatePanelFn === "function") activatePanel = activatePanelFn;
  if (typeof ensureTiersReadyFn === "function") ensureTiersReady = ensureTiersReadyFn;

  playerProfileBackBtn?.addEventListener("click", goBack);

  document.addEventListener("click", (event) => {
    // Let modified clicks (cmd/ctrl/shift/middle-click) behave like a
    // normal link -- open in a new tab -- instead of hijacking navigation.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const link = event.target.closest(".player-link[data-player-key]");
    if (link) {
      event.preventDefault();
      loadPlayerProfilePage(link.dataset.playerKey, { push: true });
      return;
    }
    const simpleLink = event.target.closest(".simple-profile-link[data-fullname]");
    if (simpleLink) {
      event.preventDefault();
      loadSimpleProfilePage(simpleLink.dataset.fullname, { push: true });
    }
  });

  document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".roster-toggle");
    if (!toggle) return;
    const target = document.getElementById(toggle.dataset.target);
    if (!target) return;
    const isOpen = !target.hidden;
    target.hidden = isOpen;
    toggle.setAttribute("aria-expanded", String(!isOpen));
    toggle.textContent = isOpen ? "▶" : "▼";
  });

  // ---- "Played with / Played against" search ----
  document.addEventListener("input", (e) => {
    if (e.target.id !== "profileSearchInput") return;
    // Typing again after having selected someone starts a fresh search --
    // the old selection no longer matches what's in the box.
    if (profileSearch && profileSearch.selectedKey) {
      profileSearch.selectedKey = null;
      document.getElementById("profileSearchClear")?.setAttribute("hidden", "");
    }
    updateSearchDropdown(e.target.value);
  });

  document.addEventListener("change", (e) => {
    if (e.target.id !== "profileSearchMode") return;
    if (!profileSearch) return;
    profileSearch.mode = e.target.value;
    const input = document.getElementById("profileSearchInput");
    if (input) {
      input.placeholder =
        profileSearch.mode === "against" ? "Search an opponent..." : "Search a teammate...";
    }
    // The teammate/opponent pools are different sets of people -- a
    // selection made in one mode isn't meaningful in the other, so switching
    // modes clears the search rather than trying to carry it over.
    clearSearch();
  });

  document.addEventListener("change", (e) => {
    if (e.target.id !== "tournamentFilterSelect") return;
    if (!profileSearch) return;
    profileSearch.tournamentFilter = e.target.value || null;

    // Tournaments and TrueSkill blocks intentionally stay unfiltered --
    // they're each already scoped per-tournament in their own rows, so
    // this selector filtering them too would just be hiding rows from a
    // table whose whole point is showing every tournament at a glance.
    // Match history and Champions are the two views that show a single
    // pooled-together picture, which is what this filter actually narrows.

    // Re-apply whatever "played with/against" selection is active against
    // the newly tournament-filtered base (this also updates Champions);
    // with no selection, update match history and Champions directly.
    if (profileSearch.selectedKey) {
      applySearchFilter();
    } else {
      const tableWrap = document.getElementById("profileHistoryTableWrap");
      if (tableWrap) {
        tableWrap.innerHTML = buildHistoryTableHtml([...getBaseHistory()].reverse());
      }
      renderChampionsTable(
        profileSearch.tournamentFilter
          ? computeChampionStats(getBaseHistory())
          : profileSearch.championStats,
      );
    }
  });

  document.addEventListener("click", (e) => {
    const sortTh = e.target.closest("#profileChampionsTable th[data-champion-sort]");
    if (sortTh) toggleChampionSort(sortTh.dataset.championSort);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const sortTh = e.target.closest?.("#profileChampionsTable th[data-champion-sort]");
    if (!sortTh) return;
    e.preventDefault(); // Space would otherwise scroll the page
    toggleChampionSort(sortTh.dataset.championSort);
  });

  document.addEventListener("click", (e) => {
    const suggestion = e.target.closest(".profile-search-suggestion");
    if (suggestion) {
      selectSearchPlayer(suggestion.dataset.key, suggestion.dataset.name);
      return;
    }
    if (e.target.id === "profileSearchClear") {
      clearSearch();
      return;
    }
    // Click anywhere outside the search box closes the dropdown without
    // touching whatever's currently selected/filtered.
    if (!e.target.closest(".profile-search-box")) {
      const dropdown = document.getElementById("profileSearchDropdown");
      if (dropdown) dropdown.hidden = true;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.id !== "profileSearchInput") return;
    const dropdown = document.getElementById("profileSearchDropdown");
    if (e.key === "Escape") {
      if (dropdown) dropdown.hidden = true;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = dropdown?.querySelector(".profile-search-suggestion");
      if (first) selectSearchPlayer(first.dataset.key, first.dataset.name);
    }
  });
}

// Used anywhere a name needs to be clickable but might not have a real
// identityKey -- Mock Draft board cells, Mock Draft's Available/Selected
// tables for manual entries, and Upcoming Roster's unrated players. Hrefs
// point at the real page URL (not "#") so middle-click / cmd-click / right-
// click-open-in-new-tab all work the same way a normal link would.
export function renderClickableName(
  fullName,
  identityKey,
  identified,
  profileUrl = null,
) {
  if (identityKey && identified) {
    const slug = buildPlayerSlug(fullName) || identityKey;
    return `<a href="/player/${slug}" class="player-link" data-player-key="${escapeHtml(slug)}">${renderNameWithTag(fullName)}</a>`;
  }
  if (profileUrl) {
    return `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" class="player-link" title="View on op.gg">${renderNameWithTag(fullName)}</a>`;
  }
  const simpleSlug = buildPlayerSlug(fullName) || encodeURIComponent(fullName);
  return `<a href="/player/simple/${simpleSlug}" class="simple-profile-link" data-fullname="${escapeHtml(fullName)}">${renderNameWithTag(fullName)}</a>`;
}
