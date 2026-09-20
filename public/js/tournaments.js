// Tournaments tab: pick a tournament, see its team rosters, a summary of how
// champions played out, and every match. All data for every tournament comes
// from one request (/api/tournaments) -- switching tournaments just
// re-renders, no further round trips. The definitions behind each number
// (entering rank, diversity, upset...) live in src/lib/tournament-summary.js.
//
// The left column deliberately reuses the player profile page's layout and
// markup (.profile-layout / .profile-block / the same champion table rows)
// so the two pages read as one family.

import {
  escapeHtml,
  renderNameWithTag,
  buildPlayerSlug,
  renderChampionIcon,
  renderTrueSkillValue,
} from "./utils.js";
import { renderChampionRows } from "./player-profile.js";

let tournaments = [];
let selectedId = null;
// Normalized key (see championKey in src/lib/champion-releases.js) of the
// champion the match list is filtered to, or null for no filter. Reset
// whenever the tournament changes.
let championFilterKey = null;
// Champion table sort. `column` is null until a header is clicked (the table
// then shows the server's default order: most games first). Clicking a column
// starts it descending; clicking the active column flips the direction. Kept
// across tournament switches.
let championSort = { column: null, dir: "desc" };
let loadPromise = null;

// Set once from app.js via initTournamentsTab().
let ensureTiersReady = async () => {};
let onSelectionChange = () => {};

const selectEl = () => document.getElementById("tournamentSelect");
const metaEl = () => document.getElementById("tournamentPickerMeta");
const contentEl = () => document.getElementById("tournamentsContent");

// ---------------------------------------------------------------- helpers

// A clickable name that goes to the player's profile page. Every roster
// member has at least one rated game, so /api/player/:key always resolves --
// same rule the TrueSkill table uses (link whenever there's an identityKey).
function playerLink(displayName, identityKey) {
  const name = renderNameWithTag(displayName || identityKey || "–");
  if (!identityKey) return name;
  const slug = buildPlayerSlug(displayName) || encodeURIComponent(identityKey);
  return `<a href="/player/${slug}" class="player-link" data-player-key="${escapeHtml(slug)}" title="View profile">${name}</a>`;
}

function ordinal(n) {
  if (!Number.isInteger(n)) return `#${n}`;
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

// Win probability as a whole-number percent, but never "0%" for something
// that merely rounds to it -- a 0.3% upset is still possible, just tiny.
function pctOrLessThanOne(x) {
  const rounded = Math.round(x * 100);
  return rounded === 0 && x > 0 ? "<1%" : `${rounded}%`;
}

// A summary value for one or more champions: every champion (ties included)
// gets its own icon + name, then the stat line sits on its own line beneath.
// Keeping the stat off the icon's line is what keeps things aligned -- text
// that follows an inline icon lines up with the icon's bottom edge, not its
// middle, so it looked crooked whenever it happened to fit beside the icon.
// Capped so a big tie can't blow out the sidebar.
const MAX_TIED_CHAMPIONS_SHOWN = 4;
function championValue(names, statHtml) {
  const cells = names
    .slice(0, MAX_TIED_CHAMPIONS_SHOWN)
    .map(renderChampionIcon)
    .join("");
  const more =
    names.length > MAX_TIED_CHAMPIONS_SHOWN
      ? `<span class="stat-formula">+${names.length - MAX_TIED_CHAMPIONS_SHOWN} more</span>`
      : "";
  return `<span class="tournament-champion-value"><span class="tournament-champion-list">${cells}${more}</span><span class="stat-formula">${statHtml}</span></span>`;
}

// ------------------------------------------------------------ summary panel

function summaryRow(label, valueHtml, { title } = {}) {
  const labelHtml = title
    ? `<span title="${escapeHtml(title)}">${label}</span>`
    : `<span>${label}</span>`;
  return `<div>${labelHtml}<span class="profile-summary-coplay-value">${valueHtml}</span></div>`;
}

function renderUpset(u) {
  if (!u) {
    return `<div class="tournament-stack"><span>Biggest upset</span><div class="stat-formula">No decisive games recorded.</div></div>`;
  }
  const where = [
    u.matchStage ? escapeHtml(u.matchStage) : null,
    u.matchOrder != null ? `match ${escapeHtml(String(u.matchOrder))}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const avgs =
    u.winnerAvg != null && u.loserAvg != null
      ? ` (avg TrueSkill ${Math.round(u.winnerAvg)} vs ${Math.round(u.loserAvg)})`
      : "";
  return `<div class="tournament-stack">
    <span>Biggest upset</span>
    <div class="tournament-upset-line">${playerLink(u.winnerName, u.winnerKey)} <span class="stat-formula">over</span> ${playerLink(u.loserName, u.loserKey)}</div>
    <div class="stat-formula">${where ? `${where}: ` : ""}only a ${pctOrLessThanOne(u.predictedWinProbForWinner)} predicted chance${avgs}.
      <button type="button" class="tournament-jump" data-match-key="${escapeHtml(u.matchKey)}">View match ↓</button></div>
  </div>`;
}

function renderSummaryBlock(t) {
  const s = t.summary;
  const hasChampionData = t.championCoverage.gamesWithDetails > 0;
  const min = s.minGamesForWinRateCallouts;
  const rows = [];

  if (hasChampionData) {
    const mp = s.mostPicked;
    rows.push(
      summaryRow(
        "Most picked champion",
        championValue(
          mp.champions,
          `(${mp.games} games${mp.champions.length > 1 ? " each" : ""} · ${pct(mp.pickRate)} pick rate)`,
        ),
      ),
    );
    const recordRow = (label, entry) =>
      summaryRow(
        label,
        entry
          ? championValue(
              entry.champions,
              `(${pct(entry.winRate)} · ${entry.wins}-${entry.losses}${entry.champions.length > 1 ? " each" : ""})`,
            )
          : `<span class="stat-formula">None with ${min}+ games</span>`,
        { title: `Highest/lowest win rate among champions with at least ${min} games` },
      );
    rows.push(recordRow(`Best champion (${min}+ games)`, s.winningest));
    rows.push(recordRow(`Worst champion (${min}+ games)`, s.losingest));

    const d = s.diversity;
    rows.push(
      summaryRow(
        "Champion Diversity (0-1)",
        d
          ? `<strong>${d.diversity.toFixed(2)}</strong>`
          : `<span class="stat-formula">–</span>`,
        {
          title: d
            ? `Champion diversity is 1 minus the Gini coefficient of pick rates across all ${d.poolSize} champions that could have been picked in ${t.year} (released that year or earlier; ${d.championsPicked} were picked, and champions nobody picked count as a 0% pick rate). 0 means every pick went to a single champion; 1 means every available champion was picked equally often. Higher = more diverse.`
            : "Needs champion data for this tournament.",
        },
      ),
    );
  }

  const noDataNote = hasChampionData
    ? ""
    : `<p class="stat-formula tournament-note">Champion stats aren't available — no champion data has been recorded for this tournament.</p>`;

  return `<section class="profile-block profile-summary-block">
    <h3>Summary</h3>
    <div class="profile-summary-coplay">
      ${rows.join("")}
      ${renderUpset(s.biggestUpset)}
    </div>
    ${noDataNote}
  </section>`;
}

// --------------------------------------------------------- champions block

function renderChampionsBlock(t) {
  if (!t.championStats.length) {
    return `<section class="profile-block"><h3>Champions</h3><p class="stat-formula">No champion data recorded for this tournament.</p></section>`;
  }
  const { gamesWithDetails, totalGames } = t.championCoverage;
  const notes = [];
  if (gamesWithDetails < totalGames) {
    notes.push(
      `Champion data covers ${gamesWithDetails} of ${totalGames} games.`,
    );
  }
  if (t.unrecognizedChampions.length) {
    notes.push(
      `Not recognized as champions (check the match-details CSV for typos): ${t.unrecognizedChampions.map(escapeHtml).join(", ")}.`,
    );
  }
  return `<section class="profile-block tournament-champions-block">
    <h3>Champions <span class="stat-formula">(${t.championStats.length} played · click to filter)</span></h3>
    <div class="tournament-champions-body">
      <div class="tournament-champions-scroll">
        <table class="tournament-champions-table">
          <thead><tr>
            <th class="not-sortable">Champion</th>
            ${sortHeader("games", "Games")}
            ${sortHeader("winRate", "Win rate")}
            ${sortHeader("kda", "KDA")}
          </tr></thead>
          <tbody>${renderChampionRows(sortedChampionStats(t))}</tbody>
        </table>
      </div>
    </div>
    ${notes.map((n) => `<p class="stat-formula tournament-note">${n}</p>`).join("")}
  </section>`;
}

// ---- champion table sorting

// "Perfect" KDA (zero deaths, sent as null) counts as the best possible KDA;
// a champion with no decided games has no win rate and sorts as the lowest.
const CHAMPION_SORT_VALUE = {
  games: (c) => c.games,
  winRate: (c) => c.winRate ?? -1,
  kda: (c) => (c.kda === null ? Infinity : c.kda),
};
// What breaks a tie on the sorted column: the other "how much" stat first,
// then name -- so equal values stay in a stable, sensible order in both
// directions (only the primary comparison flips).
const CHAMPION_SORT_TIEBREAK = {
  games: ["winRate"],
  winRate: ["games"],
  kda: ["games"],
};

function sortedChampionStats(t) {
  const list = [...t.championStats]; // server order = the default order
  const { column, dir } = championSort;
  if (!column) return list;
  const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
  const sign = dir === "asc" ? 1 : -1;
  return list.sort((a, b) => {
    const primary = cmp(
      CHAMPION_SORT_VALUE[column](a),
      CHAMPION_SORT_VALUE[column](b),
    );
    if (primary) return sign * primary;
    for (const key of CHAMPION_SORT_TIEBREAK[column]) {
      const tie = cmp(CHAMPION_SORT_VALUE[key](b), CHAMPION_SORT_VALUE[key](a));
      if (tie) return tie;
    }
    return a.champion.localeCompare(b.champion);
  });
}

function sortHeaderAttrs(column) {
  const active = championSort.column === column;
  const asc = championSort.dir === "asc";
  return {
    cls: active ? (asc ? "sorted-asc" : "sorted-desc") : "",
    aria: active ? (asc ? "ascending" : "descending") : "none",
  };
}

function sortHeader(column, label) {
  const { cls, aria } = sortHeaderAttrs(column);
  return `<th class="${cls}" data-champion-sort="${column}" tabindex="0" aria-sort="${aria}" title="Sort by ${label.toLowerCase()}">${label}</th>`;
}

function toggleChampionSort(column) {
  if (championSort.column === column) {
    championSort.dir = championSort.dir === "desc" ? "asc" : "desc";
  } else {
    championSort = { column, dir: "desc" };
  }
  const t = tournaments.find((x) => x.id === selectedId);
  if (!t) return;
  const table = contentEl().querySelector(".tournament-champions-table");
  if (!table) return;
  // Re-render only the rows and header state (not the block), so the block
  // keeps its size; then jump to the top of the newly ordered list.
  table.querySelector("tbody").innerHTML = renderChampionRows(sortedChampionStats(t));
  table.querySelectorAll("th[data-champion-sort]").forEach((th) => {
    const { cls, aria } = sortHeaderAttrs(th.dataset.championSort);
    th.classList.remove("sorted-asc", "sorted-desc");
    if (cls) th.classList.add(cls);
    th.setAttribute("aria-sort", aria);
  });
  syncChampionRows(t);
  table.closest(".tournament-champions-scroll").scrollTop = 0;
}

// ------------------------------------------------------------ team rosters

function renderTeamCard(team) {
  const record = team.games
    ? `${team.wins}-${team.losses}${team.draws ? `-${team.draws}` : ""}`
    : "–";
  const place =
    team.placement != null
      ? `<span class="tournament-team-place" title="Final placement">${ordinal(team.placement)}</span>`
      : "";
  const rows = team.roster
    .map((m) => {
      const pick = m.isCaptain
        ? "Cap"
        : m.pickOrder != null
          ? `#${m.pickOrder}`
          : "–";
      const entry =
        m.entryRank != null
          ? `<td title="TrueSkill entering the tournament: ${Math.round(m.entryRating)}">#${m.entryRank}</td>`
          : `<td>–</td>`;
      return `<tr${m.isCaptain ? ' class="roster-captain-row"' : ""}>
        <td>${pick}</td>
        <td>${playerLink(m.displayName, m.identityKey)}</td>
        ${entry}
      </tr>`;
    })
    .join("");
  return `<article class="tournament-team-card">
    <header class="tournament-team-head">
      ${place}
      <span class="tournament-team-name">${playerLink(team.captainName, team.captainKey)}</span>
      <span class="stat-formula">${record}${team.winRate != null ? ` · ${pct(team.winRate)}` : ""}</span>
    </header>
    <table>
      <thead><tr><th>Pick</th><th>Player</th><th>Entering rank</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </article>`;
}

function renderTeamsBlock(t) {
  const pool = t.entryRankPoolSize;
  const legend = pool
    ? `Pick = draft pick number (captains aren't picked). Entering rank = TrueSkill rank among all ${pool} players entering this tournament (#1 = best).`
    : `Pick = draft pick number (captains aren't picked). Entering rank isn't available — there were no earlier games to rate anyone from.`;
  return `<section class="profile-block">
    <h3>Team rosters</h3>
    <p class="stat-formula tournament-note">${legend}</p>
    <div class="tournament-teams">${t.teams.map(renderTeamCard).join("")}</div>
  </section>`;
}

// ----------------------------------------------------------------- matches

function renderMatchRosterTable(side, won, hasDetails) {
  const rows = side.roster
    .map(
      (p) => `<tr${championFilterKey && p.championKey === championFilterKey ? ' class="tournament-picked"' : ""}>
      <td>${playerLink(p.displayName, p.identityKey)}</td>
      <td>${renderTrueSkillValue(p.conservativeRating)}</td>
      ${
        hasDetails
          ? `<td>${p.champion ? renderChampionIcon(p.champion) : "–"}</td><td>${p.kills ?? "–"}</td><td>${p.deaths ?? "–"}</td><td>${p.assists ?? "–"}</td>`
          : ""
      }
    </tr>`,
    )
    .join("");
  const detailHeaders = hasDetails
    ? "<th>Champion</th><th>K</th><th>D</th><th>A</th>"
    : "";
  const result =
    won === null
      ? ""
      : won
        ? ' <span class="outcome-win">Win</span>'
        : ' <span class="outcome-loss">Loss</span>';
  return `<div>
    <strong>${escapeHtml(side.name)}</strong>${result} <span class="stat-formula">avg TrueSkill ${renderTrueSkillValue(side.avg, side.avgMu)}</span>
    <table class="match-details-table"><thead><tr><th>Player</th><th>TrueSkill</th>${detailHeaders}</tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function matchHasChampion(m, key) {
  return (
    m.team1.roster.some((p) => p.championKey === key) ||
    m.team2.roster.some((p) => p.championKey === key)
  );
}

function renderMatchesBlock(t) {
  if (!t.matches.length) {
    return `<section class="profile-block tournament-matches" id="tournamentMatches"><h3>Matches</h3><p class="stat-formula">No matches recorded.</p></section>`;
  }
  const upsetKey = t.summary.biggestUpset?.matchKey;
  // Keep each match's original index so detail-row ids stay unique and stable
  // while filtering.
  const shown = t.matches
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !championFilterKey || matchHasChampion(m, championFilterKey));

  const filterChampion = championFilterKey
    ? t.championStats.find((c) => c.key === championFilterKey)
    : null;
  const filterBar = filterChampion
    ? `<div class="tournament-filter-bar">
        <span>Matches with ${renderChampionIcon(filterChampion.champion)}</span>
        <button type="button" class="tournament-clear-filter">Clear filter</button>
      </div>`
    : "";

  const rows = shown
    .map(({ m, i }) => {
      const detailId = `tmatch-detail-${i}`;
      const t1Won = m.winner === "team1";
      const t2Won = m.winner === "team2";
      const winnerSide = t1Won ? m.team1 : t2Won ? m.team2 : null;
      const winProb = t1Won
        ? m.predictedWinProbTeam1
        : t2Won
          ? 1 - m.predictedWinProbTeam1
          : null;
      const isUpset = upsetKey && m.matchKey === upsetKey;
      return `<tr data-match-key="${escapeHtml(m.matchKey || "")}"${isUpset ? ' class="tournament-upset-row" title="Biggest upset of the tournament"' : ""}>
      <td class="col-toggle"><button class="roster-toggle" data-target="${detailId}" aria-expanded="false" aria-label="Show match details">▶</button></td>
      <td class="col-narrow">${m.order ?? "–"}</td>
      <td class="col-narrow">${m.stage ? escapeHtml(m.stage) : "–"}</td>
      <td class="${t1Won ? "tournament-winner" : ""}">${playerLink(m.team1.name, m.team1.key)}</td>
      <td class="${t2Won ? "tournament-winner" : ""}">${playerLink(m.team2.name, m.team2.key)}</td>
      <td>${winnerSide ? playerLink(winnerSide.name, winnerSide.key) : "Draw"}</td>
      <td class="col-narrow">${winProb != null ? pctOrLessThanOne(winProb) : "–"}</td>
    </tr>
    <tr id="${detailId}" class="roster-detail-row" hidden>
      <td colspan="7">
        <div class="roster-detail">
          ${renderMatchRosterTable(m.team1, m.winner === "draw" ? null : t1Won, m.hasDetails)}
          ${renderMatchRosterTable(m.team2, m.winner === "draw" ? null : t2Won, m.hasDetails)}
        </div>
      </td>
    </tr>`;
    })
    .join("");

  const count = championFilterKey
    ? `${shown.length} of ${t.matches.length}, in play order`
    : `${t.matches.length}, in play order`;
  const body = shown.length
    ? `<div class="tournament-matches-scroll">
      <table class="tournament-matches-table">
        <thead><tr>
          <th class="col-toggle"><span class="sr-only">Expand</span></th>
          <th class="col-narrow" title="Match Order from the match data">#</th>
          <th class="col-narrow">Stage</th>
          <th>Team 1</th>
          <th>Team 2</th>
          <th>Winner</th>
          <th class="col-narrow" title="Pre-match predicted win probability of the winner">Pred. win %</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
    : `<p class="stat-formula">No matches with this champion.</p>`;
  return `<section class="profile-block tournament-matches" id="tournamentMatches">
    <h3>Matches <span class="stat-formula">(${count})</span></h3>
    ${filterBar}
    ${body}
  </section>`;
}

// ------------------------------------------------------------------ render

function renderTournament(t) {
  const meta = metaEl();
  if (meta) {
    meta.textContent = `${t.gamesPlayed} games · ${t.teamCount} teams`;
  }
  contentEl().innerHTML = `
    <div class="profile-layout tournament-layout">
      <aside class="profile-sidebar">
        ${renderSummaryBlock(t)}
        ${renderChampionsBlock(t)}
      </aside>
      <main class="profile-main">
        ${renderTeamsBlock(t)}
        ${renderMatchesBlock(t)}
      </main>
    </div>`;
  syncChampionRows(t);
}

// The champion table's rows come from the profile page's shared renderer,
// which knows nothing about filtering -- so mark them up here. Rows are in
// the same order as sortedChampionStats(t) (the order currently displayed).
function syncChampionRows(t) {
  const rows = contentEl().querySelectorAll(".tournament-champions-table tbody tr");
  const displayed = sortedChampionStats(t);
  rows.forEach((row, i) => {
    const c = displayed[i];
    if (!c) return;
    row.classList.add("tournament-champion-row");
    row.dataset.championKey = c.key;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    const selected = c.key === championFilterKey;
    row.classList.toggle("is-selected", selected);
    row.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

// Re-render just the match list (keeps the champion table's and page's
// scroll position) and re-sync which champion row looks selected.
function applyChampionFilter(key, { scroll = false } = {}) {
  const t = tournaments.find((x) => x.id === selectedId);
  if (!t) return;
  championFilterKey = key;
  const el = document.getElementById("tournamentMatches");
  if (el) el.outerHTML = renderMatchesBlock(t);
  syncChampionRows(t);
  // The champion list is long, so the match list can be well off-screen
  // when a champion is clicked -- bring it into view so the click visibly
  // does something. A block that only just peeks in along the bottom edge
  // (its top in the lowest ~40% of the window) counts as off-screen; one
  // that's already comfortably on screen is left alone.
  if (scroll) {
    const rect = document.getElementById("tournamentMatches")?.getBoundingClientRect();
    if (rect && (rect.bottom < 0 || rect.top > window.innerHeight * 0.6)) {
      document
        .getElementById("tournamentMatches")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function populateSelect() {
  const sel = selectEl();
  sel.innerHTML = tournaments
    .map(
      (t) =>
        `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`,
    )
    .join("");
  sel.disabled = false;
}

function select(id) {
  const t = tournaments.find((x) => x.id === id);
  if (!t) return;
  selectedId = id;
  championFilterKey = null; // a champion filter only makes sense within one tournament
  selectEl().value = id;
  renderTournament(t);
}

async function loadTournaments() {
  if (!loadPromise) {
    loadPromise = fetch("/api/tournaments")
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((data) => {
        tournaments = data.tournaments || [];
        populateSelect();
      })
      .catch((err) => {
        loadPromise = null; // let the next visit to the tab retry
        throw err;
      });
  }
  return loadPromise;
}

// Called whenever the Tournaments tab becomes visible (tab click, URL
// route, back/forward). `requestedId` comes from ?tournament= and may be
// missing or stale; falls back to whatever was already selected, then to
// the most recent tournament (the API returns newest first).
export async function showTournamentsTab(requestedId) {
  try {
    await Promise.all([loadTournaments(), ensureTiersReady()]);
  } catch (err) {
    const el = contentEl();
    if (el) {
      el.textContent = `Unable to load tournaments: ${err.message || err}`;
    }
    return;
  }
  if (!tournaments.length) {
    contentEl().innerHTML = `<p class="stat-formula">No tournaments have been played yet.</p>`;
    selectEl().innerHTML = "<option>None</option>";
    return;
  }
  const has = (id) => id && tournaments.some((t) => t.id === id);
  const id = has(requestedId)
    ? requestedId
    : has(selectedId)
      ? selectedId
      : tournaments[0].id;
  select(id);
}

export function getSelectedTournamentId() {
  return selectedId;
}

export function initTournamentsTab({
  ensureTiersReady: ensureTiersReadyFn,
  onSelectionChange: onSelectionChangeFn,
} = {}) {
  if (typeof ensureTiersReadyFn === "function") {
    ensureTiersReady = ensureTiersReadyFn;
  }
  if (typeof onSelectionChangeFn === "function") {
    onSelectionChange = onSelectionChangeFn;
  }

  selectEl()?.addEventListener("change", (e) => {
    select(e.target.value);
    onSelectionChange(selectedId);
  });

  // Click a champion in the list to filter the matches to games where it
  // was picked; click it again (or "Clear filter") to go back to all matches.
  const toggleChampion = (row) => {
    const key = row.dataset.championKey;
    applyChampionFilter(key === championFilterKey ? null : key, {
      scroll: key !== championFilterKey,
    });
  };
  contentEl()?.addEventListener("click", (e) => {
    const sortTh = e.target.closest("th[data-champion-sort]");
    if (sortTh) return toggleChampionSort(sortTh.dataset.championSort);
    const row = e.target.closest(".tournament-champion-row");
    if (row) return toggleChampion(row);
    if (e.target.closest(".tournament-clear-filter")) applyChampionFilter(null);
  });
  contentEl()?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const sortTh = e.target.closest("th[data-champion-sort]");
    const row = e.target.closest(".tournament-champion-row");
    if (!sortTh && !row) return;
    e.preventDefault(); // Space would otherwise scroll the page
    if (sortTh) toggleChampionSort(sortTh.dataset.championSort);
    else toggleChampion(row);
  });

  // "View match ↓" in the summary's biggest-upset entry: open that match's
  // detail row and scroll to it.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".tournament-jump");
    if (!btn) return;
    const findRow = () =>
      contentEl()?.querySelector(
        `tr[data-match-key="${CSS.escape(btn.dataset.matchKey)}"]`,
      );
    let row = findRow();
    if (!row && championFilterKey) {
      // The upset game is hidden by the active champion filter -- drop it.
      applyChampionFilter(null);
      row = findRow();
    }
    if (!row) return;
    const toggle = row.querySelector(".roster-toggle");
    if (toggle && toggle.getAttribute("aria-expanded") !== "true") {
      toggle.click(); // handled by the shared .roster-toggle listener
    }
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.remove("tournament-row-flash");
    void row.offsetWidth; // restart the animation if it was already running
    row.classList.add("tournament-row-flash");
  });
}
