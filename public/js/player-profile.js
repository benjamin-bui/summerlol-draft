import {
  escapeHtml,
  renderNameWithTag,
  renderTrueSkillValue,
  renderSoloQueueRank,
  getRankTier,
  renderChampionIcon,
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
    window.history.pushState(null, "", `/?tab=${encodeURIComponent(lastKnownTab)}`);
    activatePanel(lastKnownTab);
  }
}

function buildChartHtml(history) {
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
  const width =
    xMax <= 1
      ? 240
      : (() => {
          const spanCount = xMax - 1;
          const pxPerGame = Math.max(basePxPerGame, targetFilledWidth / spanCount);
          return padL + padR + pxPerGame * spanCount;
        })();
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

  return `
    <div class="profile-chart-scroll">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="profile-chart-svg">
        ${gridlines}
        <path d="${trueskillPath}" fill="none" stroke="#2b6cb0" stroke-width="2" />
        ${dots}
        ${badges}
        <text x="${xMax <= 1 ? padL + plotW / 2 : padL}" y="${height - 6}" ${xMax <= 1 ? 'text-anchor="middle"' : ""} font-size="10" fill="#888">Game 1</text>
        ${xMax > 1 ? `<text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="#888">Game ${xMax}</text>` : ""}
      </svg>
    </div>
    <div class="profile-chart-legend">
      <span><i style="background:#2b6cb0"></i> TrueSkill (skill estimate)</span>
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
      const placement = t.finalPlacement != null ? `#${t.finalPlacement}` : "–";
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

function renderChampionRows(championStats) {
  if (!championStats.length) {
    return `<tr><td colspan="4" class="stat-formula">No champion data for this filter.</td></tr>`;
  }
  return championStats
    .map((c) => {
      const winRate = c.winRate != null ? `${Math.round(c.winRate * 100)}%` : "–";
      const kda = c.kda == null ? "Perfect" : c.kda.toFixed(2);
      return `<tr>
        <td>${renderChampionIcon(c.champion)}</td>
        <td>${c.games}</td>
        <td>${winRate}</td>
        <td>${kda}</td>
      </tr>`;
    })
    .join("");
}

function renderChampionsBlock(championStats) {
  if (!championStats.length) {
    return `<section class="profile-block"><h3>Champions</h3><p class="stat-formula">No champion data recorded yet.</p></section>`;
  }
  return `<section class="profile-block">
    <h3>Champions</h3>
    <table>
      <thead><tr><th>Champion</th><th>Games</th><th>Win rate</th><th>KDA</th></tr></thead>
      <tbody id="championsTableBody">${renderChampionRows(championStats)}</tbody>
    </table>
  </section>`;
}

// Same aggregation the server does once, career-wide, in /api/player/:key
// -- reimplemented here so the Champions block can be recomputed
// client-side for whatever subset of games the tournament filter (and/or
// played-with/against search) currently has selected, without a round
// trip back to the server for every filter change.
function computeChampionStats(historyEntries) {
  const championMap = new Map();
  for (const entry of historyEntries) {
    const detail = entry.playerDetails?.[0];
    if (!detail || !detail.champion) continue;
    if (!championMap.has(detail.champion)) {
      championMap.set(detail.champion, {
        champion: detail.champion,
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
  return [...championMap.values()]
    .map((c) => ({
      ...c,
      winRate: c.games ? round3(c.wins / c.games) : null,
      kda: c.deaths > 0 ? round3((c.kills + c.assists) / c.deaths) : null,
    }))
    .sort((a, b) => b.games - a.games);
}

// Updates just the Champions block's rows in place -- used by every
// filter change (tournament filter, played-with/against search) rather
// than each one re-deriving how to touch the DOM itself.
function renderChampionsTable(championStats) {
  const tbody = document.getElementById("championsTableBody");
  if (tbody) tbody.innerHTML = renderChampionRows(championStats);
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
      const rosterTable = (team, name) => {
        const rows = (team?.roster || [])
          .map((member) => {
            const detail = detailsByPlayer.get(
              normalizePlayer(member.displayName),
            );
            return `<tr><td>${escapeHtml(member.displayName)}</td><td>${renderTrueSkillValue(member.conservativeRating)}</td>${
              hasDetails
                ? `<td>${detail ? renderChampionIcon(detail.champion) : "–"}</td><td>${detail?.kills ?? "–"}</td><td>${detail?.deaths ?? "–"}</td><td>${detail?.assists ?? "–"}</td>`
                : ""
            }</tr>`;
          })
          .join("");
        const detailHeaders = hasDetails
          ? "<th>Champion</th><th>K</th><th>D</th><th>A</th>"
          : "";
        return `<div><strong>${escapeHtml(name)}</strong><table class="match-details-table"><thead><tr><th>Player</th><th>TrueSkill</th>${detailHeaders}</tr></thead><tbody>${rows}</tbody></table></div>`;
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
      <td colspan="8">
        <div class="roster-detail">
          ${rosterTable(entry.ownTeam, entry.ownTeam?.name || "Your team")}
          ${rosterTable(entry.opponentTeam, entry.opponentName || "Opponent")}
        </div>
        ${extraStatsHtml}
      </td>
    </tr>`;
    })
    .join("");
  return `<table class="profile-history-table"><thead><tr><th class="col-toggle"><span class="sr-only">Expand</span></th><th class="col-match">Match</th><th class="col-secondary col-matchup">Matchup</th><th>Champion</th><th>K/D/A</th><th class="col-result">Result</th><th class="col-secondary col-ratings">Avg Rating</th><th class="col-secondary col-trueskill">TrueSkill</th></tr></thead><tbody>${rows}</tbody></table>`;
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

function renderPlayerProfileContent(player) {
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
  profileSearch = {
    selfKey: player?.identityKey,
    history,
    tournaments,
    championStats,
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
      <div class="profile-header-chart">${buildChartHtml(history)}</div>
    </div>
    <div class="profile-layout">
      <aside class="profile-sidebar">
        ${renderTournamentFilterBlock(tournaments)}
        ${renderTournamentsBlock(tournaments)}
        ${renderTrueSkillBlock(player, tournaments)}
        ${renderChampionsBlock(championStats)}
      </aside>
      <main class="profile-main">
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
        <div class="profile-current-rank">${escapeHtml(overallLabel)} <span class="stat-formula">(${games} games)</span></div>
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
    playerProfileContent.innerHTML = renderPlayerProfileContent(player);
    // Default the chart's scroll position to the far right (most recent
    // game) rather than the far left (oldest game, game 1) -- what
    // someone opening a profile actually wants to see first.
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
} = {}) {
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
