import { initTheme } from "./js/theme.js";
import {
  round3,
  escapeHtml,
  renderNameWithTag,
  renderPlayerCell,
  renderRankBadge,
  renderTrueSkillValue,
  renderSoloQueueRank,
  soloQueueSortValueClient,
  setRankTiers,
  parseNameList,
  seasonRankLocal,
} from "./js/utils.js";
import { initPlayerProfile, renderClickableName } from "./js/player-profile.js";
import { createTabTable, coerceNumericColumns } from "./js/table-utils.js";

let groupColName = "Player";
let latestStats = [];
let trueskillLoaded = false;
let latestTrueskillPlayers = [];
let draftScatterBuilt = false;
let draftAnalysisLoaded = false;
let latestDraftAnalysis = null;
let mockDraftPool = [];
let draftPicks = new Map();
let numCaptains = 8;
let picksPerCaptain = 4;
let mockCaptains = [];
let draftDataLoaded = false;
let matchDataLoaded = false;
let upcomingRosterLoaded = false;

// ==================== Theme toggle ====================
// The theme initialization now lives in its own module so the app entry
// point can focus on orchestration rather than UI bootstrapping.
// TrueSkill Fun Facts
function renderFunFactsHtml(ff) {
  if (!ff) return "";
  const pctRows = ff.staticCutoffs
    .map((p) => {
      const cutoffDisplay = Number.isFinite(p.ratingCutoff)
        ? p.ratingCutoff
        : "–";
      const badgeHtml = renderRankBadge(p.name);
      return `<tr><td class="rank-cell">${badgeHtml} <span>${escapeHtml(p.name)}</span></td><td>${p.percentile}%</td><td>${cutoffDisplay}</td></tr>`;
    })
    .join("");

  const facts = [];
  if (ff.biggestUpset) {
    const u = ff.biggestUpset;
    facts.push(
      `<strong>Biggest upset:</strong> ${escapeHtml(u.winnerName)} (avg ${u.winnerAvgBefore}) over ${escapeHtml(u.loserName)} (avg ${u.loserAvgBefore}) in ${u.tournament} ${u.year} - only a ${Math.round(u.predictedWinProbForWinner * 100)}% predicted chance. ${u.mvpName ? `${escapeHtml(u.mvpName)} swung ${u.mvpRatingChange > 0 ? "+" : ""}${u.mvpRatingChange} TrueSkill.` : ""}`,
    );
  }
  if (ff.longestStreak) {
    facts.push(
      `<strong>Longest win streak:</strong> ${escapeHtml(ff.longestStreak.displayName)}, ${ff.longestStreak.streak} games`,
    );
  }
  if (ff.longestLossStreak) {
    facts.push(
      `<strong>Longest losing streak:</strong> ${escapeHtml(ff.longestLossStreak.displayName)}, ${ff.longestLossStreak.streak} games`,
    );
  }
  if (ff.peakRating) {
    facts.push(
      `<strong>Highest TrueSkill ever reached:</strong> ${escapeHtml(ff.peakRating.displayName)}, ${ff.peakRating.conservativeRating} (${ff.peakRating.tournament} ${ff.peakRating.year})`,
    );
  }
  // if (ff.troughRating) {
  //   facts.push(`<strong>Lowest TrueSkill ever reached:</strong> ${escapeHtml(ff.troughRating.displayName)}, ${ff.troughRating.conservativeRating} (${ff.troughRating.tournament} ${ff.troughRating.year})`);
  // }
  if (ff.mostGamesPlayed) {
    facts.push(
      `<strong>Most games played:</strong> ${escapeHtml(ff.mostGamesPlayed.displayName)}, ${ff.mostGamesPlayed.games} games`,
    );
  }
  if (ff.mostActiveRivalry) {
    const r = ff.mostActiveRivalry;
    facts.push(
      `<strong>Most active rivalry:</strong> ${escapeHtml(r.teamAName)} vs ${escapeHtml(r.teamBName)}, ${r.gamesPlayed} games played (${r.teamAWins}-${r.teamBWins})`,
    );
  }
  if (ff.everMaster) {
    const playerList = ff.everMaster
      .map((p) => escapeHtml(p.group || p.displayName))
      .join(", ");
    facts.push(
      `<strong>Ever hit Master rank (${ff.everMaster.length}):</strong> ${playerList}`,
    );
  }

  return `
    <div class="fun-facts-box">
      <button class="fun-facts-toggle" aria-expanded="false">▶ Fun facts</button>
      <div class="fun-facts-body" hidden>
        <h4>TrueSkill percentile cutoffs (League of Legends rank equivalent)</h4>
        <table class="fun-facts-table"><thead><tr><th>Rank</th><th>Percentile</th><th>Rating cutoff</th></tr></thead>
          <tbody>${pctRows}</tbody></table>
        <ul class="fun-facts-list">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
      </div>
    </div>`;
}

document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".fun-facts-toggle");
  if (!toggle) return;
  const body = toggle.nextElementSibling;
  const isOpen = !body.hidden;
  body.hidden = isOpen;
  toggle.setAttribute("aria-expanded", String(!isOpen));
  toggle.textContent = (isOpen ? "▶" : "▼") + " Fun facts";
});
// The player profile modal behavior is now wired from its own module.

// ==================== Tabs ====================

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

function setActiveTab(tabName) {
  tabButtons.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === tabName),
  );
  tabPanels.forEach((panel) =>
    panel.classList.toggle("active", panel.id === `tab-${tabName}`),
  );
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTab(btn.dataset.tab);
    scheduleUrlUpdate();
  });
});

function buildPastDraftOptions(optgroupEl) {
  optgroupEl.innerHTML = "";
  if (!latestTrueskillPlayers) return;
  const combos = new Set();
  latestTrueskillPlayers.forEach((p) => {
    (p.history || []).forEach((h) => combos.add(`${h.year}::${h.tournament}`));
  });
  [...combos]
    .sort((a, b) => {
      const [ay, at] = a.split("::"),
        [by, bt] = b.split("::");
      if (ay !== by) return by - ay;
      return seasonRankLocal(at) - seasonRankLocal(bt);
    })
    .forEach((combo) => {
      const [year, tournament] = combo.split("::");
      const opt = document.createElement("option");
      opt.value = `past::${combo}`;
      opt.textContent = `${tournament} ${year}`;
      optgroupEl.appendChild(opt);
    });
}

async function buildAdminPresetOptions(optgroupEl) {
  optgroupEl.innerHTML = "";
  try {
    const res = await fetch("/api/presets", { cache: "no-store" });
    const data = await res.json();
    data.presets.forEach((preset) => {
      const opt = document.createElement("option");
      opt.value = `admin::${preset.id}`;
      opt.textContent = preset.label;
      optgroupEl.appendChild(opt);
    });
  } catch (err) {
    /* no presets dir yet */
  }
}
// Everyone (captains + players) with at least one recorded game that
// year+tournament -- since captains are always force-included on their
// own roster and always play, this naturally covers both.
function namesForPastDraft(year, tournament) {
  const names = new Set();
  (latestTrueskillPlayers || []).forEach((p) => {
    const played = (p.history || []).some(
      (h) => String(h.year) === String(year) && h.tournament === tournament,
    );
    if (played) names.add(p.group);
  });
  return [...names];
}
function namesForPastDraftCaptains(year, tournament) {
  const captainNames = new Set();
  (latestTrueskillPlayers || []).forEach((p) => {
    (p.history || []).forEach((h) => {
      if (
        String(h.year) === String(year) &&
        h.tournament === tournament &&
        h.ownTeam?.name
      ) {
        captainNames.add(h.ownTeam.name);
      }
    });
  });
  return [...captainNames];
}
// Matches loosely against BOTH the resolved display name and the raw
// identityKey -- a pasted roster might use the exact in-game name
// (which could still be an unresolved identityKey if that player was
// never matched to a Riot account) or the resolved display name. Case
// and surrounding whitespace are ignored; this is intentionally an
// EXACT match otherwise (no partial/fuzzy matching), since a substring
// match risks silently pulling in the wrong player on a short name.
function buildNameMatcher(names) {
  const normalized = new Set(names.map((n) => n.trim().toLowerCase()));
  const bareNameOf = (s) => {
    const idx = s.lastIndexOf("#");
    return (idx === -1 ? s : s.slice(0, idx)).trim().toLowerCase();
  };
  return {
    matches(player) {
      const candidates = [player.group, player.identityKey].filter(Boolean);
      return candidates.some(
        (c) =>
          normalized.has(c.trim().toLowerCase()) ||
          normalized.has(bareNameOf(c)),
      );
    },
    checkCoverage(players) {
      const matchedNames = new Set();
      players.forEach((p) => {
        [p.group, p.identityKey].filter(Boolean).forEach((s) => {
          const norm = s.trim().toLowerCase();
          if (normalized.has(norm)) matchedNames.add(norm);
        });
      });
      const unmatched = [...normalized].filter((n) => !matchedNames.has(n));
      return {
        matchedCount: matchedNames.size,
        totalCount: normalized.size,
        unmatched,
      };
    },
  };
}

function applyNameFilter(rawText) {
  const names = parseNameList(rawText);
  const summaryEl = document.getElementById("nameFilterSummary");

  if (names.length === 0) {
    trueskillTable.setExternalFilter(null);
    summaryEl.textContent = "";
    return;
  }

  const matcher = buildNameMatcher(names);
  const playersForCoverageCheck = latestTrueskillPlayers || [];
  const { matchedCount, totalCount, unmatched } = matcher.checkCoverage(
    playersForCoverageCheck,
  );

  trueskillTable.setExternalFilter((row) => matcher.matches(row));

  summaryEl.textContent = unmatched.length
    ? `Matched ${matchedCount}/${totalCount}. Unmatched: ${unmatched.join(", ")}`
    : `Matched all ${matchedCount} names.`;
  summaryEl.className = unmatched.length
    ? "name-filter-summary has-misses"
    : "name-filter-summary";
}

document.getElementById("nameFilterApplyBtn").addEventListener("click", () => {
  const text = document.getElementById("nameFilterInput").value;
  applyNameFilter(text);
});

document.getElementById("nameFilterClearBtn").addEventListener("click", () => {
  document.getElementById("nameFilterInput").value = "";
  document.getElementById("nameFilterFile").value = "";
  trueskillTable.setExternalFilter(null);
  document.getElementById("nameFilterSummary").textContent = "";
});

document
  .getElementById("nameFilterFile")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    document.getElementById("nameFilterInput").value = text; // mirror into the textarea so it's visible/editable
    applyNameFilter(text);
  });

// ====================Rank Tier====================
// Rank badge rendering and TrueSkill helpers now live in the shared utilities module.
// ==================== trueskill tab ====================

const TRUESKILL_COLUMNS = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    hideable: false,
    filterable: false,
  },
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    className: "group-name",
    type: "string",
    sticky: true,
  },
  {
    key: "latestGameTournament",
    label: "Latest Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => {
      const raw = String(row.latestGameTournament || "").trim();
      const match = raw.match(/^(winter|summer)\s*(\d{4})?$/i);
      if (!match) return 2_000_000;
      const seasonRank = match[1].toLowerCase() === "summer" ? 0 : 1;
      const year = parseInt(match[2] || "0", 10);
      return seasonRank * 1_000_000 + year;
    },
  },
  {
    key: "conservativeRating",
    label: "TrueSkill (μ)",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
    render: (val, row) => renderTrueSkillValue(row.conservativeRating, row.mu),
  },
  {
    key: "soloQueueRank",
    label: "Solo Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.soloQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "flexQueueRank",
    label: "Flex Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.flexQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "premade5x5Rank",
    label: "5x5 Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    defaultHidden: true,
    sortValue: (row) => soloQueueSortValueClient(row.premade5x5Rank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "mu",
    label: "μ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
    defaultHidden: true,
  },
  {
    key: "sigma",
    label: "σ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    defaultHidden: true,
  },
  {
    key: "games",
    label: "Games",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "tournaments",
    label: "Tournaments",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "wins",
    label: "Wins",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "losses",
    label: "Losses",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "winrate",
    label: "Win Rate %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    sortValue: (row) => {
      if (!row.games || row.games === 0) return 0;
      return row.wins / row.games;
    },
    render: (val, row) => {
      const games = row.games || 0;
      const wins = row.wins || 0;
      if (games === 0) return "0.0%";
      return ((wins / games) * 100).toFixed(1) + "%";
    },
  },
];

const trueskillTable = createTabTable({
  columns: TRUESKILL_COLUMNS,
  headerRowEl: document.getElementById("trueskillHeaderRow"),
  bodyEl: document.getElementById("trueskillBody"),
  columnsBtnEl: document.getElementById("trueskillColumnsBtn"),
  columnsPanelEl: document.getElementById("trueskillColumnsPanel"),
  ownerKey: "trueskill",
  defaultSortColumn: "conservativeRating",
});


async function loadtrueskillData(forceRefresh) {
  if (trueskillLoaded && !forceRefresh) return;
  const res = await fetch(`/api/trueskill`);
  const data = await res.json();
  const players = Array.isArray(data.players) ? data.players : [];
  const funFacts = data.funFacts || { staticCutoffs: [] };
  latestTrueskillPlayers = players;
  buildPastDraftOptions(document.getElementById("pastDraftsOptgroup"));
  setRankTiers(funFacts.staticCutoffs || []);
  document.getElementById("trueskill-fun-facts").innerHTML = renderFunFactsHtml(
    funFacts,
  );
  trueskillTable.setData(players);
  trueskillLoaded = true;
}

document
  .getElementById("nameFilterPresetSelect")
  .addEventListener("change", async (e) => {
    const val = e.target.value;
    if (!val) return;
    const textarea = document.getElementById("nameFilterInput");

    if (val.startsWith("past::")) {
      const [, year, tournament] = val.split("::");
      textarea.value = namesForPastDraft(year, tournament).join("\n");
    } else if (val.startsWith("admin::")) {
      const id = val.slice("admin::".length);
      const res = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      textarea.value = data.names.join("\n");
    }
    applyNameFilter(textarea.value);
    e.target.value = "";
  });

buildAdminPresetOptions(document.getElementById("adminPresetsOptgroup"));

// ==================== Naive Pick Order vs Results ====================

let totalN = 40;
const totalNInput = document.getElementById("totalN");

totalNInput.addEventListener("input", () => {
  const val = parseInt(totalNInput.value, 10);
  if (!Number.isFinite(val) || val < 2) return;
  totalN = val;
  applyTotalN();
  rankingsTable.setData(latestStats);
});
const RANKINGS_COLUMNS = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    hideable: false,
    filterable: false,
  },
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    className: "group-name",
    type: "string",
    sticky: "true",
  },
  {
    key: "adjAvg",
    label: "Adjusted Pick Value",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
  },
  {
    key: "n",
    label: "n",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "mean",
    label: "Unadjusted Pick Value",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    defaultHidden: true,
  },
  {
    key: "sd",
    label: "Std. Dev.",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    defaultHidden: true,
  },
  {
    key: "avgPickPercentile",
    label: "Avg. Pick %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    percentage: true,
  },
  {
    key: "estPickOrder",
    label: "Est. Pick Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 1,
  },
  {
    key: "avgRankPercentile",
    label: "Avg. Rank %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    percentage: true,
  },
  {
    key: "estRankOrder",
    label: "Est. Rank Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 1,
  },
];

const rankingsTable = createTabTable({
  columns: RANKINGS_COLUMNS,
  headerRowEl: statsHeaderRow,
  bodyEl: statsBody,
  columnsBtnEl: columnsBtn,
  columnsPanelEl: columnsPanel,
  ownerKey: "rankings",
  defaultSortColumn: "adjAvg",
  emptyMessage: "No players match the active filters",
});

const RANKINGS_RISK = 0.25;
const RANKINGS_HALF_LIFE = 2;
async function fetchStats(risk, halfLife) {
  const res = await fetch(`/api/stats?risk=${risk}&halfLife=${halfLife}`);
  if (!res.ok) {
    statsBody.innerHTML = `<tr><td colspan="8">Error loading stats</td></tr>`;
    return;
  }
  const data = await res.json();
  latestStats = data.stats;
  applyTotalN();
  rankingsTable.setData(latestStats);
}

// Translates each row's percentile columns into an estimated ordinal
// position on a scale of `totalN` — e.g. "if this were a league of N
// picks/captains, what pick/rank number does this percentile correspond
// to". Purely a client-side transform of already-fetched percentiles, so
// changing N just re-renders, no server round-trip needed.
function applyTotalN() {
  // Est. Pick Order scales against N (total picks). Est. Rank Order
  // scales against N/4 instead — N/4 is the actual number of teams,
  // since each team gets 4 picks in this draft format, and Rank
  // Percentile was always normalized against the team count, not the
  // pick count (see server.js's per-year normalization).
  const numTeams = totalN / 4;
  latestStats.forEach((row) => {
    row.estPickOrder =
      row.avgPickPercentile === null
        ? null
        : row.avgPickPercentile * (totalN - 1) + 1;
    row.estRankOrder =
      row.avgRankPercentile === null
        ? null
        : row.avgRankPercentile * (numTeams - 1) + 1;
  });
}
// ==================== Draft IQ tab ====================

const DRAFT_IQ_COLUMNS = [
  {
    key: "rank",
    label: "#",
    sortable: false,
    hideable: false,
    filterable: false,
  },
  {
    key: "captain",
    label: "Captain",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
    sticky: true,
    render: (val, row) => row.captainDisplay,
  },
  {
    key: "avgDraftValue",
    label: "Draft IQ (avg value)",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
  },
  {
    key: "picksEvaluated",
    label: "Picks Evaluated",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "bestPickLabel",
    label: "Best Pick",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.bestPick?.value ?? -Infinity,
    render: (val) => val,
  },
  {
    key: "worstPickLabel",
    label: "Worst Pick",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.worstPick?.value ?? -Infinity,
    render: (val) => val,
  },
  {
    key: "bestPickLeavingLabel",
    label: "Best Pick (Leaving)",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.bestPickLeaving?.value ?? -Infinity,
    render: (val) => val,
  },
  {
    key: "worstPickLeavingLabel",
    label: "Worst Pick (Leaving)",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.worstPickLeaving?.value ?? -Infinity,
    render: (val) => val,
  },
];

const draftIQTable = createTabTable({
  columns: DRAFT_IQ_COLUMNS,
  headerRowEl: document.getElementById("draftIQHeaderRow"),
  bodyEl: document.getElementById("draftIQBody"),
  columnsBtnEl: document.getElementById("draftIQColumnsBtn"),
  columnsPanelEl: document.getElementById("draftIQColumnsPanel"),
  ownerKey: "draftiq",
  defaultSortColumn: "avgDraftValue",
  emptyMessage: "No draft data available",
});

function openCaptainDraftHistory(captainName) {
  if (!latestDraftAnalysis) return;
  const picks = latestDraftAnalysis.picks.filter(
    (p) => p.captain === captainName,
  );
  const byTournament = new Map();
  for (const p of picks) {
    const key = `${p.year}::${p.tournament}`;
    if (!byTournament.has(key)) byTournament.set(key, []);
    byTournament.get(key).push(p);
  }

  const sections = [...byTournament.entries()]
    .sort((a, b) => {
      const [ay, at] = a[0].split("::");
      const [by, bt] = b[0].split("::");
      if (ay !== by) return by - ay;
      return at.localeCompare(bt);
    })
    .map(([key, tournamentPicks]) => {
      const [year, tournament] = key.split("::");
      const teamBalance = latestDraftAnalysis.teamBalance.find(
        (t) =>
          t.captain === captainName &&
          t.tournament === tournament &&
          Number(t.year) === Number(year),
      );
      const avgValue = round1(
        tournamentPicks.reduce((s, p) => s + p.value, 0) /
          tournamentPicks.length,
      );

      // Leaving/hindsight average -- only over picks that actually have a
      // leavingValue (a player who never played a game has none), same
      // guard as the main-table best/worst-leaving aggregation.
      const withLeaving = tournamentPicks.filter(
        (p) => p.leavingValue !== null,
      );
      const avgLeavingValue = withLeaving.length
        ? round1(
            withLeaving.reduce((s, p) => s + p.leavingValue, 0) /
              withLeaving.length,
          )
        : null;

      const wins = teamBalance?.wins ?? "–";
      const losses = teamBalance?.losses ?? "–";

      const rows = [...tournamentPicks]
        .sort((a, b) => a.pickOrder - b.pickOrder)
        .map(
          (p) => `
        <tr>
          <td>#${p.pickOrder}</td>
          <td>${escapeHtml(p.displayName)}</td>
          <td>#${p.entryRank}</td>
          <td class="${p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}">${p.value > 0 ? "+" : ""}${p.value}</td>
          <td>${p.exitRank !== null ? "#" + p.exitRank : "–"}</td>
          <td class="${p.leavingValue > 0 ? "outcome-win" : p.leavingValue < 0 ? "outcome-loss" : ""}">${p.leavingValue !== null ? (p.leavingValue > 0 ? "+" : "") + p.leavingValue : "–"}</td>
        </tr>`,
        )
        .join("");

      return `
        <h4>${escapeHtml(tournament)} ${escapeHtml(year)}
          <span class="stat-formula">(avg entering value ${avgValue > 0 ? "+" : ""}${avgValue}${avgLeavingValue !== null ? ` · avg leaving value ${avgLeavingValue > 0 ? "+" : ""}${avgLeavingValue}` : ""})</span>
        </h4>
        <h4>${wins}W ${losses}L</h4>
        <table class="profile-history-table">
          <thead><tr><th>Pick #</th><th>Player</th><th>Entering Rank</th><th>Value</th><th>Leaving Rank</th><th>Value (Leaving)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    });

  const modal = ensureCaptainDraftModal();
  modal.querySelector(".captain-draft-title").textContent =
    `${captainName} — Draft History`;
  modal.querySelector(".captain-draft-body").innerHTML =
    sections.join("") || "<p>No draft history found.</p>";
  modal.classList.add("open");
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function ensureCaptainDraftModal() {
  let modal = document.getElementById("captainDraftModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "captainDraftModal";
  modal.className = "player-profile-modal"; // reuse existing modal chrome/CSS
  modal.innerHTML = `
    <div class="player-profile-backdrop" data-close="true"></div>
    <div class="player-profile-panel">
      <button class="player-profile-close" data-close="true">&times;</button>
      <h2 class="captain-draft-title"></h2>
      <div class="captain-draft-body"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target.dataset.close === "true") modal.classList.remove("open");
  });
  return modal;
}

// Scatter plot
function buildDraftScatterData(draftAnalysis) {
  const picksByTeam = new Map(); // `${year}::${tournament}::${captain}` -> picks[]
  for (const p of draftAnalysis.picks) {
    const key = `${p.year}::${p.tournament}::${p.captain}`;
    if (!picksByTeam.has(key)) picksByTeam.set(key, []);
    picksByTeam.get(key).push(p);
  }

  return draftAnalysis.teamBalance
    .map((team) => {
      const key = `${team.year}::${team.tournament}::${team.captain}`;
      const teamPicks = picksByTeam.get(key);
      if (!teamPicks || teamPicks.length === 0 || team.games === 0) return null; // nothing to plot without both a draft value and a game record

      const avgDraftValue = round3(
        teamPicks.reduce((s, p) => s + p.value, 0) / teamPicks.length,
      );
      return {
        captain: team.captain,
        year: team.year,
        tournament: team.tournament,
        avgDraftValue,
        picksEvaluated: teamPicks.length,
        wins: team.wins,
        losses: team.losses,
        games: team.games,
        winRate: team.winRate,
      };
    })
    .filter(Boolean);
}

// Assigns each distinct group key an evenly-spaced hue around the color
// wheel. Works for arbitrary group counts (a handful of years, or dozens
// of captains) without needing a hand-picked palette -- colors get closer
// together as N grows, which is an honest tradeoff rather than reusing
// colors and creating false-equivalence between unrelated groups.
function colorForIndex(i, n) {
  const hue = Math.round((i * 360) / Math.max(n, 1)) % 360;
  return `hsl(${hue}deg 45% 60%)`;
}

function getGroupKey(p, groupBy) {
  if (groupBy === "captain") return p.captain;
  if (groupBy === "year") return String(p.year);
  if (groupBy === "yearTournament") return `${p.year} : ${p.tournament}`;
  return null; // ungrouped -- every point shares one bucket, one color
}

function seasonRank(tournament) {
  const t = String(tournament || "").toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}

// Builds an ordered list of distinct group keys, sorted in a way that
// reads sensibly in the legend (alphabetical for captains, chronological
// for years/tournaments) rather than however Set iteration happens to
// land.
function buildGroupOrder(data, groupBy) {
  if (groupBy === "none") return [null];
  const keys = [...new Set(data.map((p) => getGroupKey(p, groupBy)))];
  if (groupBy === "captain") return keys.sort((a, b) => a.localeCompare(b));
  if (groupBy === "year") return keys.sort((a, b) => Number(b) - Number(a)); // most recent first
  if (groupBy === "yearTournament") {
    return keys.sort((a, b) => {
      const [ay, at] = a.split(" : ");
      const [by, bt] = b.split(" : ");
      if (ay !== by) return Number(by) - Number(ay);
      return seasonRank(at) - seasonRank(bt);
    });
  }
  return keys;
}

function initDraftScatterToggle() {
  const box = document.getElementById("draftScatterBox");
  if (!box) return;
  const toggle = box.querySelector(".collapsible-toggle");
  const body = box.querySelector(".collapsible-body");

  toggle.addEventListener("click", () => {
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    toggle.setAttribute("aria-expanded", String(!isOpen));
    toggle.textContent = (isOpen ? "▶" : "▼") + " Draft IQ vs Win Rate";

    if (!isOpen && !draftScatterBuilt && latestDraftAnalysis) {
      renderDraftScatter(
        document.getElementById("draftScatterContainer"),
        buildDraftScatterData(latestDraftAnalysis),
      );
      draftScatterBuilt = true;
    }
  });
}
// Calculates two-tailed p-value from a t-statistic and degrees of freedom
function studentTPValue(t, df) {
  if (isNaN(t) || df <= 0) return 1;
  const absT = Math.abs(t);

  // Normal approximation for large sample sizes (df > 300)
  if (df > 300) {
    const z = absT;
    const b1 = 0.31938153,
      b2 = -0.356563782,
      b3 = 1.781477937,
      b4 = -1.821255978,
      b5 = 1.330274429;
    const k = 1 / (1 + 0.2316419 * z);
    const poly = k * (b1 + k * (b2 + k * (b3 + k * (b4 + k * b5))));
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
    return Math.min(1, Math.max(0, 2 * phi * poly));
  }

  // Exact trigonometric series for integer degrees of freedom
  const theta = Math.atan(absT / Math.sqrt(df));
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  if (df % 2 === 1) {
    // Odd df
    let term = sin * cos;
    let sum = term;
    for (let i = 3; i < df; i += 2) {
      term *= ((i - 1) / i) * cos * cos;
      sum += term;
    }
    const cdf = (2 / Math.PI) * (theta + (df === 1 ? 0 : sum));
    return Math.max(0, 1 - cdf);
  } else {
    // Even df
    let term = sin;
    let sum = term;
    for (let i = 2; i < df; i += 2) {
      term *= ((i - 1) / i) * cos * cos;
      sum += term;
    }
    return Math.max(0, 1 - sum);
  }
}

// Utility to format p-values nicely
function formatPValue(p) {
  if (p < 0.001) return "p < 0.001";
  return `p = ${p.toFixed(3)}`;
}

function renderDraftScatter(container, data) {
  const width = 700,
    height = 420,
    padL = 55,
    padR = 20,
    padT = 20,
    padB = 45;
  const plotW = width - padL - padR,
    plotH = height - padT - padB;

  function studentTPValue(t, df) {
    if (isNaN(t) || df <= 0) return 1;
    const absT = Math.abs(t);
    if (df > 300) {
      const z = absT;
      const b1 = 0.31938153,
        b2 = -0.356563782,
        b3 = 1.781477937,
        b4 = -1.821255978,
        b5 = 1.330274429;
      const k = 1 / (1 + 0.2316419 * z);
      const poly = k * (b1 + k * (b2 + k * (b3 + k * (b4 + k * b5))));
      const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z);
      return Math.min(1, Math.max(0, 2 * phi * poly));
    }
    const theta = Math.atan(absT / Math.sqrt(df));
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    if (df % 2 === 1) {
      let term = sin * cos;
      let sum = term;
      for (let i = 3; i < df; i += 2) {
        term *= ((i - 1) / i) * cos * cos;
        sum += term;
      }
      const cdf = (2 / Math.PI) * (theta + (df === 1 ? 0 : sum));
      return Math.max(0, 1 - cdf);
    } else {
      let term = sin;
      let sum = term;
      for (let i = 2; i < df; i += 2) {
        term *= ((i - 1) / i) * cos * cos;
        sum += term;
      }
      return Math.max(0, 1 - sum);
    }
  }

  function formatPValue(p) {
    if (p < 0.001) return "p < 0.001";
    return `p = ${p.toFixed(3)}`;
  }

  function computeRegressionLine(pts) {
    const n = pts.length;
    if (n < 3) return null;

    const meanX = pts.reduce((s, p) => s + p.avgDraftValue, 0) / n;
    const meanY = pts.reduce((s, p) => s + p.winRate, 0) / n;

    let ssXX = 0,
      ssYY = 0,
      ssXY = 0;
    for (const p of pts) {
      const dx = p.avgDraftValue - meanX;
      const dy = p.winRate - meanY;
      ssXX += dx * dx;
      ssYY += dy * dy;
      ssXY += dx * dy;
    }

    if (ssXX === 0) return null;

    const slope = ssXY / ssXX;
    const intercept = meanY - slope * meanX;

    // Calculate R-squared
    const rSquared =
      ssYY === 0 ? 0 : Math.min(1, Math.max(0, (ssXY * ssXY) / (ssXX * ssYY)));

    // Calculate p-value (t-test on slope)
    const df = n - 2;
    const ssRes = Math.max(0, ssYY - (ssXY * ssXY) / ssXX);
    const mse = ssRes / df;
    const seSlope = Math.sqrt(mse / ssXX);

    let pValue = 1;
    if (seSlope === 0) {
      pValue = slope === 0 ? 1 : 0;
    } else {
      const tStat = slope / seSlope;
      pValue = studentTPValue(tStat, df);
    }

    return { slope, intercept, rSquared, pValue, n };
  }

  const fullDomain = computeDomain(data);
  let domain = { ...fullDomain };

  function computeDomain(pts) {
    const xs = pts.map((p) => p.avgDraftValue);
    const ys = pts.map((p) => p.winRate);
    const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.1 || 1;
    const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.1 || 0.05;
    return {
      xMin: Math.min(...xs) - xPad,
      xMax: Math.max(...xs) + xPad,
      yMin: Math.max(0, Math.min(...ys) - yPad),
      yMax: Math.min(1, Math.max(...ys) + yPad),
    };
  }

  let selectedKey = null;
  let selectedGroupKey = null;
  let groupBy = "none";

  const groupBySelect = document.getElementById("draftScatterGroupBySelect");
  const legendEl = document.getElementById("draftScatterLegend");

  function colorFor(p) {
    if (groupBy === "none") return "var(--accent)";
    const order = buildGroupOrder(data, groupBy);
    const key = getGroupKey(p, groupBy);
    const idx = order.indexOf(key);
    return colorForIndex(idx, order.length);
  }

  function computeJitteredPositions(points) {
    const groups = new Map();
    for (const p of points) {
      const posKey = `${p.avgDraftValue}:${p.winRate}`;
      if (!groups.has(posKey)) groups.set(posKey, []);
      groups.get(posKey).push(p);
    }

    const jitterOf = new Map();
    for (const group of groups.values()) {
      if (group.length === 1) {
        jitterOf.set(group[0], { dxPx: 0, dyPx: 0 });
        continue;
      }
      const jitterRadiusPx = 7;
      group.forEach((p, i) => {
        const angle = (i / group.length) * 2 * Math.PI;
        jitterOf.set(p, {
          dxPx: Math.cos(angle) * jitterRadiusPx,
          dyPx: Math.sin(angle) * jitterRadiusPx,
        });
      });
    }
    return jitterOf;
  }

  function renderLegend() {
    if (groupBy === "none") {
      legendEl.innerHTML = "";
      legendEl.hidden = true;
      return;
    }
    legendEl.hidden = false;
    const order = buildGroupOrder(data, groupBy);
    legendEl.innerHTML = order
      .map((key, i) => {
        const isDimmed = selectedGroupKey && selectedGroupKey !== key;
        return `<button type="button" class="legend-item${isDimmed ? " dimmed" : ""}" data-group-key="${escapeHtml(key)}">
        <i style="background:${colorForIndex(i, order.length)}"></i>${escapeHtml(key)}
      </button>`;
      })
      .join("");

    legendEl.querySelectorAll(".legend-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedKey = null;
        selectedGroupKey =
          selectedGroupKey === btn.dataset.groupKey
            ? null
            : btn.dataset.groupKey;
        render();
      });
    });
  }

  function render() {
    const xScale = (x) =>
      padL + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * plotW;
    const yScale = (y) =>
      padT + plotH - ((y - domain.yMin) / (domain.yMax - domain.yMin)) * plotH;

    const xTicks = 5,
      yTicks = 5;
    const gridlines = [
      ...Array.from({ length: xTicks + 1 }, (_, i) => {
        const val = domain.xMin + (domain.xMax - domain.xMin) * (i / xTicks);
        const x = xScale(val);
        return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="var(--border)" stroke-width="1" />
                <text x="${x}" y="${height - padB + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${val.toFixed(1)}</text>`;
      }),
      ...Array.from({ length: yTicks + 1 }, (_, i) => {
        const val = domain.yMin + (domain.yMax - domain.yMin) * (i / yTicks);
        const y = yScale(val);
        return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="var(--border)" stroke-width="1" />
                <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(val * 100)}%</text>`;
      }),
    ].join("");

    const visiblePoints = data.filter(
      (p) =>
        p.avgDraftValue >= domain.xMin &&
        p.avgDraftValue <= domain.xMax &&
        p.winRate >= domain.yMin &&
        p.winRate <= domain.yMax,
    );

    const jitterOf = computeJitteredPositions(visiblePoints);

    const sortedForPaint = [...visiblePoints].sort((a, b) => {
      const aKey = `${a.year}::${a.tournament}::${a.captain}`;
      const bKey = `${b.year}::${b.tournament}::${b.captain}`;
      const aHighlighted =
        aKey === selectedKey ||
        (selectedGroupKey && getGroupKey(a, groupBy) === selectedGroupKey);
      const bHighlighted =
        bKey === selectedKey ||
        (selectedGroupKey && getGroupKey(b, groupBy) === selectedGroupKey);
      return (aHighlighted ? 1 : 0) - (bHighlighted ? 1 : 0);
    });

    const dots = sortedForPaint
      .map((p) => {
        const pointKey = `${p.year}::${p.tournament}::${p.captain}`;
        const groupKey = getGroupKey(p, groupBy);
        const isSelectedPoint = pointKey === selectedKey;
        const isDimmedByPoint = selectedKey && !isSelectedPoint;
        const isDimmedByGroup =
          selectedGroupKey && groupKey !== selectedGroupKey;
        const isDimmed = isDimmedByPoint || isDimmedByGroup;
        const r = 4 + Math.sqrt(p.games);
        const fillColor = colorFor(p);
        const jitter = jitterOf.get(p) || { dxPx: 0, dyPx: 0 };
        const cx = xScale(p.avgDraftValue) + jitter.dxPx;
        const cy = yScale(p.winRate) + jitter.dyPx;
        return `<circle
        class="scatter-point"
        data-captain="${escapeHtml(p.captain)}"
        data-key="${escapeHtml(pointKey)}"
        cx="${cx}" cy="${cy}" r="${isSelectedPoint ? r + 2 : r}"
        fill="${fillColor}" fill-opacity="${isDimmed ? 0.08 : 0.5}"
        stroke="${isSelectedPoint ? "var(--text)" : fillColor}"
        stroke-opacity="${isDimmed ? 0.15 : isSelectedPoint ? 1 : 0.75}"
        stroke-width="${isSelectedPoint ? 2.5 : 1.25}"
        style="cursor:pointer" />`;
      })
      .join("");

    const regression = computeRegressionLine(data);
    const regressionLine = regression
      ? (() => {
          const y1 = regression.slope * domain.xMin + regression.intercept;
          const y2 = regression.slope * domain.xMax + regression.intercept;
          return `<line x1="${xScale(domain.xMin)}" y1="${yScale(y1)}" x2="${xScale(domain.xMax)}" y2="${yScale(y2)}"
        stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" clip-path="url(#draftScatterPlotClip)" />`;
        })()
      : "";

    // Label on the top-right corner of plot
    const statsLabel = regression
      ? `<text x="${padL + plotW - 6}" y="${padT + 14}" text-anchor="end" font-size="11" font-weight="600" fill="var(--muted)">
          R² = ${regression.rSquared.toFixed(3)} (${formatPValue(regression.pValue)})
         </text>`
      : "";

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="draft-scatter-svg">
          <defs>
            <clipPath id="draftScatterPlotClip">
              <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" />
            </clipPath>
          </defs>
          ${gridlines}
          <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--muted)" stroke-width="1" />
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="var(--muted)" stroke-width="1" />
          <text x="${padL + plotW / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">Draft IQ (avg pick value)</text>
          <text x="14" y="${padT + plotH / 2}" text-anchor="middle" font-size="11" fill="var(--muted)" transform="rotate(-90 14 ${padT + plotH / 2})">Win Rate</text>
          ${regressionLine}
          ${statsLabel}
          <rect class="scatter-zoom-overlay" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair" />
          ${dots}
          <rect class="scatter-drag-rect" x="0" y="0" width="0" height="0" fill="var(--accent)" fill-opacity="0.15" stroke="var(--accent)" stroke-width="1" style="display:none;pointer-events:none" />
        </svg>
        <div class="draft-scatter-controls">
          <button class="scatter-reset-btn" type="button">Reset zoom / selection</button>
          <span class="draft-scatter-hint">Drag to zoom · click a point or legend entry to highlight</span>
        </div>
        <div class="draft-scatter-tooltip" hidden></div>
      `;

    renderLegend();
    wireInteractions();
  }

  function wireInteractions() {
    const svg = container.querySelector(".draft-scatter-svg");
    const overlay = container.querySelector(".scatter-zoom-overlay");
    const dragRect = container.querySelector(".scatter-drag-rect");
    const tooltip = container.querySelector(".draft-scatter-tooltip");
    const resetBtn = container.querySelector(".scatter-reset-btn");

    container.querySelectorAll(".scatter-point").forEach((circle) => {
      circle.addEventListener("pointerenter", (e) => {
        const key = circle.dataset.key;
        const p = data.find(
          (d) => `${d.year}::${d.tournament}::${d.captain}` === key,
        );
        if (!p) return;
        tooltip.innerHTML = `<strong>${escapeHtml(p.captain)}</strong> <span style="color:var(--muted)">(${escapeHtml(p.tournament)} ${p.year})</span><br>
          Draft value: ${p.avgDraftValue > 0 ? "+" : ""}${p.avgDraftValue} (${p.picksEvaluated} picks)<br>
          Record: ${p.wins}W ${p.losses}L (${Math.round(p.winRate * 100)}%)`;
        tooltip.hidden = false;
        const rect = container.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        tooltip.style.top = `${e.clientY - rect.top + 12}px`;
      });
      circle.addEventListener("pointermove", (e) => {
        const rect = container.getBoundingClientRect();
        tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        tooltip.style.top = `${e.clientY - rect.top + 12}px`;
      });
      circle.addEventListener("pointerleave", () => {
        tooltip.hidden = true;
      });
      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedGroupKey = null;
        selectedKey =
          selectedKey === circle.dataset.key ? null : circle.dataset.key;
        render();
      });
    });

    let dragStart = null;
    const svgPoint = (evt) => {
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height);
      const renderedWidth = width * scale;
      const renderedHeight = height * scale;
      const offsetX = (rect.width - renderedWidth) / 2;
      const offsetY = (rect.height - renderedHeight) / 2;

      return {
        x: (evt.clientX - rect.left - offsetX) / scale,
        y: (evt.clientY - rect.top - offsetY) / scale,
      };
    };

    overlay.addEventListener("pointerdown", (e) => {
      dragStart = svgPoint(e);
      dragRect.style.display = "block";
    });
    svg.addEventListener("pointermove", (e) => {
      if (!dragStart) return;
      const cur = svgPoint(e);
      const x = Math.min(dragStart.x, cur.x),
        y = Math.min(dragStart.y, cur.y);
      dragRect.setAttribute("x", x);
      dragRect.setAttribute("y", y);
      dragRect.setAttribute("width", Math.abs(cur.x - dragStart.x));
      dragRect.setAttribute("height", Math.abs(cur.y - dragStart.y));
    });
    svg.addEventListener("pointerup", (e) => {
      if (!dragStart) return;
      const cur = svgPoint(e);
      const x1 = Math.min(dragStart.x, cur.x),
        x2 = Math.max(dragStart.x, cur.x);
      const y1 = Math.min(dragStart.y, cur.y),
        y2 = Math.max(dragStart.y, cur.y);
      dragStart = null;
      dragRect.style.display = "none";
      if (x2 - x1 < 8 || y2 - y1 < 8) return;

      const invX = (px) =>
        domain.xMin + ((px - padL) / plotW) * (domain.xMax - domain.xMin);
      const invY = (py) =>
        domain.yMin +
        ((padT + plotH - py) / plotH) * (domain.yMax - domain.yMin);
      const newXMin = invX(x1),
        newXMax = invX(x2);
      const newYMin = invY(y2),
        newYMax = invY(y1);
      domain = {
        xMin: newXMin,
        xMax: newXMax,
        yMin: Math.max(0, newYMin),
        yMax: Math.min(1, newYMax),
      };
      render();
    });

    resetBtn.addEventListener("click", () => {
      domain = { ...fullDomain };
      selectedKey = null;
      selectedGroupKey = null;
      render();
    });
  }

  groupBySelect.value = "none";
  groupBySelect.addEventListener("change", () => {
    groupBy = groupBySelect.value;
    selectedKey = null;
    selectedGroupKey = null;
    render();
  });

  render();
}

// Formats a {displayName, pickOrder, entryRank, value} object into a
// single readable string -- e.g. "Voidliss (pick #14, entering-rank #3,
// value +11)". A positive value means they were rated better than where
// they went (a steal); negative means they went earlier than their
// entering rating justified (a reach).
function formatDraftPick(pick, rankLabel = "entering-rank") {
  if (!pick) return "–";
  const sign = pick.value > 0 ? "+" : "";
  const rank = pick.entryRank ?? pick.exitRank;
  return `${escapeHtml(pick.displayName)} <span class="pick-value ${pick.value > 0 ? "outcome-win" : pick.value < 0 ? "outcome-loss" : ""}">${sign}${pick.value}</span><br>
    <span class="pick-detail">pick #${pick.pickOrder} · ${rankLabel} #${rank}</span>`;
}

document.addEventListener("click", (e) => {
  const link = e.target.closest(".captain-draft-link");
  if (!link) return;
  e.preventDefault();
  openCaptainDraftHistory(link.dataset.captain);
});

initDraftScatterToggle();

// ==================== Team Balance tab ====================

const TEAM_BALANCE_COLUMNS = [
  {
    key: "year",
    label: "Year",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "tournament",
    label: "Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "captain",
    label: "Captain",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
  },
  {
    key: "avgEntryRating",
    label: "Avg Entry TrueSkill",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
  },
  {
    key: "finalStage",
    label: "Final Stage",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "wins",
    label: "Wins",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "losses",
    label: "Losses",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "winRate",
    label: "Win Rate",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    percentage: true,
  },
];

function renderTeamMatchList(row) {
  const roster = row.roster || [];
  const matches = row.matches || [];

  const rosterHtml = roster.length
    ? `<ul class="roster-detail-list">${roster
        .map(
          (m) =>
            `<li>${escapeHtml(m.displayName)} <span class="roster-rating">${renderTrueSkillValue(m.conservativeRating)}</span></li>`,
        )
        .join("")}</ul>`
    : "<p>No roster on file.</p>";

  const matchesHtml = matches.length
    ? `<table class="profile-history-table">
        <thead><tr><th>Opponent(s)</th><th>Result</th><th>Stage</th><th>Pred. Win %</th></tr></thead>
        <tbody>${matches
          .map((m) => {
            const outcomeClass =
              m.outcome === "win"
                ? "outcome-win"
                : m.outcome === "loss"
                  ? "outcome-loss"
                  : "outcome-draw";
            return `<tr>
            <td>${escapeHtml(m.opponentName)}</td>
            <td class="${outcomeClass}">${escapeHtml(m.outcome)}</td>
            <td>${m.matchStage ? escapeHtml(m.matchStage) : "–"}</td>
            <td>${Math.round((m.predictedWinProb ?? 0) * 100)}%</td>
          </tr>`;
          })
          .join("")}</tbody>
      </table>`
    : "<p>No matches recorded.</p>";

  return `
    <div class="roster-detail">
      <div><strong>Roster</strong>${rosterHtml}</div>
    </div>
    <div class="team-matches-section">
      <strong>Matches</strong>
      ${matchesHtml}
    </div>`;
}

const teamBalanceTable = createTabTable({
  columns: TEAM_BALANCE_COLUMNS,
  headerRowEl: document.getElementById("teamBalanceHeaderRow"),
  bodyEl: document.getElementById("teamBalanceBody"),
  columnsBtnEl: document.getElementById("teamBalanceColumnsBtn"),
  columnsPanelEl: document.getElementById("teamBalanceColumnsPanel"),
  ownerKey: "teambalance",
  defaultSortColumn: "avgEntryRating",
  emptyMessage: "No team balance data available",
  expandable: { getDetailHtml: renderTeamMatchList },
});

// ==================== Shared fetch: both tabs come from one endpoint ====================

async function loadDraftAnalysis() {
  if (draftAnalysisLoaded) return;
  const res = await fetch("/api/draft-analysis");
  const data = await res.json();
  latestDraftAnalysis = data;

  const draftIQRows = data.captainDraftIQ.map((row) => ({
    ...row,
    captainDisplay: `<a href="#" class="captain-draft-link" data-captain="${escapeHtml(row.captain)}">${renderNameWithTag(row.captain)}</a>`,
    bestPickLabel: formatDraftPick(row.bestPick, "entering-rank"),
    worstPickLabel: formatDraftPick(row.worstPick, "entering-rank"),
    bestPickLeavingLabel: formatDraftPick(row.bestPickLeaving, "leaving-rank"),
    worstPickLeavingLabel: formatDraftPick(
      row.worstPickLeaving,
      "leaving-rank",
    ),
  }));
  draftIQTable.setData(draftIQRows);
  teamBalanceTable.setData(data.teamBalance);
  draftAnalysisLoaded = true;
}

// ==================== Mock Draft Data tab ====================

function applyMockDraftPoolFilter(rawText) {
  const names = parseNameList(rawText);
  const summaryEl = document.getElementById("mockDraftFilterSummary");
  if (names.length === 0) {
    // No list typed/pasted/loaded -- default to every known player rather
    // than an empty pool, so Mock Draft is immediately usable without
    // requiring a preset first.
    mockDraftPool = (latestTrueskillPlayers || []).map((p) => ({
      ...p,
      manual: false,
    }));
    summaryEl.textContent = mockDraftPool.length
      ? `Showing all ${mockDraftPool.length} known players (no list applied).`
      : "";
    renderMockDraftPlayerDatalist();
    draftPicks = new Map(); // pool changed -- stale picks would reference the previous pool
    renderDraftBoard();
    renderAvailableSelectedTables();
    return;
  }

  const matcher = buildNameMatcher(names);
  const playersForCheck = latestTrueskillPlayers || [];
  const { unmatched } = matcher.checkCoverage(playersForCheck);

  // Every pasted/uploaded name becomes a pool entry -- matched names get
  // their real TrueSkill data, names with no match at all (genuinely new
  // people, not in the system yet) become a manual stub with null
  // ratings instead of being silently dropped. This is the same shape
  // resolvePoolPlayerByName already produces for a name typed directly
  // into a board cell, so both paths behave consistently.
  mockDraftPool = names.map((rawName) =>
    resolvePoolPlayerByName(rawName, playersForCheck),
  );

  summaryEl.textContent = unmatched.length
    ? `Matched ${names.length - unmatched.length}/${names.length}. New/unrecognized (added with no TrueSkill data): ${unmatched.join(", ")}`
    : `Matched all ${names.length} names.`;
  summaryEl.className = unmatched.length
    ? "name-filter-summary has-misses"
    : "name-filter-summary";

  renderMockDraftPlayerDatalist();
  draftPicks = new Map();
  renderDraftBoard();
  renderAvailableSelectedTables();
}

document
  .getElementById("mockDraftFilterApplyBtn")
  .addEventListener("click", () =>
    applyMockDraftPoolFilter(
      document.getElementById("mockDraftFilterInput").value,
    ),
  );
document
  .getElementById("mockDraftFilterClearBtn")
  .addEventListener("click", () => {
    document.getElementById("mockDraftFilterInput").value = "";
    document.getElementById("mockDraftFilterFile").value = "";
    applyMockDraftPoolFilter("");
  });
document
  .getElementById("mockDraftFilterFile")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    document.getElementById("mockDraftFilterInput").value = text;
    applyMockDraftPoolFilter(text);
  });
document
  .getElementById("mockDraftPresetSelect")
  .addEventListener("change", async (e) => {
    const val = e.target.value;
    if (!val) return;
    const textarea = document.getElementById("mockDraftFilterInput");
    let names = [],
      captains = [];

    if (val.startsWith("past::")) {
      const [, year, tournament] = val.split("::");
      names = namesForPastDraft(year, tournament);
      // Past drafts already know who captained -- reuse that instead of
      // guessing, same idea as the CSV captain-flag feature below.
      captains = namesForPastDraftCaptains(year, tournament);
    } else if (val.startsWith("admin::")) {
      const res = await fetch(
        `/api/presets/${encodeURIComponent(val.slice(7))}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      names = data.names;
      captains = data.captains || [];
    }

    textarea.value = names.join("\n");
    applyMockDraftPoolFilter(textarea.value);

    if (captains.length > 0) {
      document.getElementById("mockNumCaptains").value = captains.length;
      // Picks per captain: infer from pool size / captain count, rounded
      // down -- a reasonable default the user can still override by hand
      // before generating the board.
      const nonCaptainCount = names.length - captains.length;
      const inferredPicks = Math.max(
        1,
        Math.floor(nonCaptainCount / captains.length),
      );
      document.getElementById("mockPicksPerCaptain").value = inferredPicks;

      numCaptains = captains.length;
      picksPerCaptain = inferredPicks;
      renderCaptainInputs(numCaptains);
      captains.forEach((name, i) => {
        mockCaptains[i] = resolvePoolPlayerByName(name, mockDraftPool);
        document.querySelectorAll(".mock-captain-input")[i].value =
          mockCaptains[i].group;
      });
      renderDraftBoard();
      renderAvailableSelectedTables();
    }

    e.target.value = "";
  });

function renderMockDraftPlayerDatalist() {
  document.getElementById("mockDraftPlayerDatalist").innerHTML = mockDraftPool
    .map((p) => `<option value="${escapeHtml(p.group)}"></option>`)
    .join("");
}

// Matches typed text against a given pool (case/tag-tolerant, same
// convention as the TrueSkill filter's matcher); falls back to a
// "manual" stub if nothing in the pool matches, so someone not in your
// filtered list can still be typed in directly -- they just won't carry
// any TrueSkill data.
function resolvePoolPlayerByName(text, pool) {
  const norm = text.trim().toLowerCase();
  if (!norm) return null;
  const bareOf = (s) => {
    const idx = s.lastIndexOf("#");
    return (idx === -1 ? s : s.slice(0, idx)).trim().toLowerCase();
  };
  const found = pool.find((p) => {
    const g = p.group.trim().toLowerCase();
    return g === norm || bareOf(g) === norm || bareOf(g) === bareOf(norm);
  });
  return found
    ? { ...found, manual: false }
    : {
        identityKey: null,
        group: text.trim(),
        conservativeRating: null,
        mu: null,
        sigma: null,
        soloQueueRank: null,
        flexQueueRank: null,
        wins: null,
        losses: null,
        manual: true,
      };
}

// Draft board
// Standard snake: round 0 goes captain 0..N-1, round 1 reverses N-1..0,
// alternating -- "left to right, then sweep back" exactly as described.
function generateSnakeSlots(nCaptains, nPicks) {
  const slots = [];
  let overall = 1;
  for (let round = 0; round < nPicks; round++) {
    const order =
      round % 2 === 0
        ? [...Array(nCaptains).keys()]
        : [...Array(nCaptains).keys()].reverse();
    for (const captainIndex of order)
      slots.push({ round, captainIndex, overall: overall++ });
  }
  return slots;
}

// Captains
function renderCaptainInputs(n) {
  const container = document.getElementById("mockCaptainInputs");
  container.innerHTML = "";
  mockCaptains = mockCaptains.slice(0, n);
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement("div");
    wrap.className = "mock-captain-input-wrap";
    wrap.innerHTML = `<label>Captain ${i + 1}</label>`;
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("list", "mockDraftPlayerDatalist");
    input.className = "mock-captain-input";
    input.placeholder = "Type or pick a name…";
    input.value = mockCaptains[i]?.group || "";
    input.addEventListener("change", () => {
      mockCaptains[i] = resolvePoolPlayerByName(input.value, mockDraftPool);
      renderDraftBoard();
      renderAvailableSelectedTables();
    });
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}
document
  .getElementById("mockGenerateBoardBtn")
  .addEventListener("click", () => {
    numCaptains = Math.max(
      2,
      parseInt(document.getElementById("mockNumCaptains").value, 10) || 2,
    );
    picksPerCaptain = Math.max(
      1,
      parseInt(document.getElementById("mockPicksPerCaptain").value, 10) || 1,
    );
    draftPicks = new Map();
    renderCaptainInputs(numCaptains);
    renderDraftBoard();
    renderAvailableSelectedTables();
  });

function getAvailablePlayers() {
  const draftedKeys = new Set(),
    draftedNames = new Set();
  draftPicks.forEach((pick) => {
    if (!pick) return;
    if (pick.identityKey) draftedKeys.add(pick.identityKey);
    else draftedNames.add(pick.group.toLowerCase());
  });
  mockCaptains.forEach((captain) => {
    if (!captain) return;
    if (captain.identityKey) draftedKeys.add(captain.identityKey);
    else draftedNames.add(captain.group.toLowerCase());
  });
  return mockDraftPool.filter(
    (p) =>
      !draftedKeys.has(p.identityKey) &&
      !draftedNames.has(p.group.toLowerCase()),
  );
}

function renderMockDraftAvailableDatalist() {
  document.getElementById("mockDraftAvailableDatalist").innerHTML =
    getAvailablePlayers()
      .map((p) => `<option value="${escapeHtml(p.group)}"></option>`)
      .join("");
}

function renderDraftBoard() {
  const slots = generateSnakeSlots(numCaptains, picksPerCaptain);
  const table = document.getElementById("mockDraftBoardTable");
  const headerCells = Array.from({ length: numCaptains }, (_, i) => {
    const captain = mockCaptains[i];
    return `<th>${escapeHtml(captain?.group || `Captain ${i + 1}`)}</th>`;
  }).join("");

  const rows = [];
  for (let round = 0; round < picksPerCaptain; round++) {
    const cells = [];
    for (let c = 0; c < numCaptains; c++) {
      const slot = slots.find((s) => s.round === round && s.captainIndex === c);
      const pick = draftPicks.get(`${round}::${c}`);
      const pickNumberHtml =
        pick && pick.identityKey
          ? `<a href="#" class="player-link mock-pick-number-link" data-player-key="${escapeHtml(pick.identityKey)}" title="View profile">#${slot.overall} <span class="mock-profile-icon">→</span></a>`
          : `<span class="mock-pick-number">#${slot.overall}</span>`;
      cells.push(`<td><div class="mock-pick-cell">
        ${pickNumberHtml}
        <input type="text" list="mockDraftAvailableDatalist" class="mock-pick-input"
          data-round="${round}" data-captain="${c}"
          value="${pick ? escapeHtml(pick.group) : ""}" placeholder="Type or pick…" />
      </div></td>`);
    }
    rows.push(
      `<tr><td class="round-label">Round ${round + 1}</td>${cells.join("")}</tr>`,
    );
  }

  table.innerHTML = `<thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows.join("")}</tbody>`;
  renderMockDraftAvailableDatalist();

  table.querySelectorAll(".mock-pick-input").forEach((input) => {
    input.addEventListener("change", () => {
      const key = `${input.dataset.round}::${input.dataset.captain}`;
      const text = input.value.trim();
      if (!text) draftPicks.delete(key);
      else
        draftPicks.set(
          key,
          resolvePoolPlayerByName(text, getAvailablePlayers()),
        );
      renderDraftBoard(); // rebuilds the board, including the now-resolved pick's arrow/link
      renderAvailableSelectedTables();
    });
  });
}

const MOCK_PLAYER_COLUMNS = [
  {
    key: "group",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
    render: (val, row) => renderClickableName(row.group, row.identityKey, !row.manual),
  },
  {
    key: "conservativeRating",
    label: "TrueSkill",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    className: "adj-avg",
    render: (val, row) => renderTrueSkillValue(row.conservativeRating, row.mu),
  },
  {
    key: "soloQueueRank",
    label: "Solo Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.soloQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "flexQueueRank",
    label: "Flex Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => soloQueueSortValueClient(row.flexQueueRank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "premade5x5Rank",
    label: "5x5 Queue",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    defaultHidden: true,
    sortValue: (row) => soloQueueSortValueClient(row.premade5x5Rank),
    render: (val) => renderSoloQueueRank(val),
  },
  {
    key: "mu",
    label: "μ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
    defaultHidden: true,
  },
  {
    key: "sigma",
    label: "σ",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 2,
  },
  {
    key: "wins",
    label: "Wins",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "losses",
    label: "Losses",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "winrate",
    label: "Win Rate %",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    sortValue: (row) => {
      if (!row.games || row.games === 0) return 0;
      return row.wins / row.games;
    },
    render: (val, row) => {
      const games = row.games || 0;
      const wins = row.wins || 0;
      if (games === 0) return "0.0%";
      return ((wins / games) * 100).toFixed(1) + "%";
    },
  },
];
const MOCK_SELECTED_COLUMNS = [
  ...MOCK_PLAYER_COLUMNS,
  {
    key: "pickLabel",
    label: "Pick",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    sortValue: (row) => row.overall,
  },
];

const mockAvailableTable = createTabTable({
  columns: MOCK_PLAYER_COLUMNS,
  headerRowEl: document.getElementById("mockAvailableHeaderRow"),
  bodyEl: document.getElementById("mockAvailableBody"),
  columnsBtnEl: document.getElementById("mockAvailableColumnsBtn"),
  columnsPanelEl: document.getElementById("mockAvailableColumnsPanel"),
  ownerKey: "mockavailable",
  defaultSortColumn: "conservativeRating",
  emptyMessage: "No players remaining -- add a pool above",
});
const mockSelectedTable = createTabTable({
  columns: MOCK_SELECTED_COLUMNS,
  headerRowEl: document.getElementById("mockSelectedHeaderRow"),
  bodyEl: document.getElementById("mockSelectedBody"),
  columnsBtnEl: document.getElementById("mockSelectedColumnsBtn"),
  columnsPanelEl: document.getElementById("mockSelectedColumnsPanel"),
  ownerKey: "mockselected",
  defaultSortColumn: "pickLabel",
  defaultSortDirection: "asc",
  emptyMessage: "No picks made yet",
});

function renderAvailableSelectedTables() {
  mockAvailableTable.setData(getAvailablePlayers());
  const slots = generateSnakeSlots(numCaptains, picksPerCaptain);
  const selected = [];
  draftPicks.forEach((pick, key) => {
    if (!pick) return;
    const [round, captainIndex] = key.split("::").map(Number);
    const slot = slots.find(
      (s) => s.round === round && s.captainIndex === captainIndex,
    );
    selected.push({
      ...pick,
      overall: slot?.overall ?? 0,
      pickLabel: `#${slot?.overall ?? "?"} (${mockCaptains[captainIndex]?.group || `Captain ${captainIndex + 1}`})`,
    });
  });
  mockSelectedTable.setData(selected);
}

// Same methodology as real Draft IQ using current rating
function evaluateMockDraftIQ() {
  const slots = generateSnakeSlots(numCaptains, picksPerCaptain);
  const rated = mockDraftPool.filter(
    (p) => p.conservativeRating !== null && p.conservativeRating !== undefined,
  );
  const rankedByRating = [...rated].sort(
    (a, b) => b.conservativeRating - a.conservativeRating,
  );
  const entryRankByKey = new Map(
    rankedByRating.map((p, i) => [p.identityKey || p.group, i]),
  );

  const picks = [];
  draftPicks.forEach((pick, key) => {
    if (!pick) return;
    const [round, captainIndex] = key.split("::").map(Number);
    const slot = slots.find(
      (s) => s.round === round && s.captainIndex === captainIndex,
    );
    if (!slot) return;
    const poolKey = pick.identityKey || pick.group;
    const entryRank = entryRankByKey.get(poolKey) ?? null;
    picks.push({
      captainIndex,
      captainName:
        mockCaptains[captainIndex]?.group || `Captain ${captainIndex + 1}`,
      captainIdentityKey: mockCaptains[captainIndex]?.identityKey || null,
      displayName: pick.group,
      identityKey: pick.identityKey || null, // needed for the profile link -- manual/unmatched picks stay null
      pickOrder: slot.overall,
      entryRank,
      value: entryRank !== null ? slot.overall - entryRank : null,
    });
  });

  const byCaptain = new Map();
  picks.forEach((p) => {
    if (!byCaptain.has(p.captainIndex)) byCaptain.set(p.captainIndex, []);
    byCaptain.get(p.captainIndex).push(p);
  });

  const captainResults = [...byCaptain.entries()].map(
    ([captainIndex, captainPicks]) => {
      const valued = captainPicks.filter((p) => p.value !== null);
      const avgDraftValue = valued.length
        ? round1(valued.reduce((s, p) => s + p.value, 0) / valued.length)
        : null;
      return {
        captainName: captainPicks[0]?.captainName,
        captainIdentityKey: captainPicks[0]?.captainIdentityKey,
        avgDraftValue,
        picks: [...captainPicks].sort((a, b) => a.pickOrder - b.pickOrder),
      };
    },
  );
  captainResults.sort(
    (a, b) => (b.avgDraftValue ?? -Infinity) - (a.avgDraftValue ?? -Infinity),
  );
  return captainResults;
}

function renderMockDraftIQResults(captainResults) {
  if (captainResults.length === 0) {
    return '<p class="mock-draftiq-empty">No picks made yet -- fill in the board first.</p>';
  }
  return captainResults
    .map((team) => {
      const rows = team.picks
        .map((p) => {
          const nameHtml = p.identityKey
            ? `<a href="#" class="player-link" data-player-key="${escapeHtml(p.identityKey)}">${renderNameWithTag(p.displayName)}</a>`
            : renderNameWithTag(p.displayName);
          return `
        <tr>
          <td>#${p.pickOrder}</td>
          <td>${nameHtml}</td>
          <td>${p.entryRank !== null ? "#" + p.entryRank : "–"}</td>
          <td class="${p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}">${p.value !== null ? (p.value > 0 ? "+" : "") + p.value : "–"}</td>
        </tr>`;
        })
        .join("");

      const captainNameHtml = team.captainIdentityKey
        ? `<a href="#" class="player-link" data-player-key="${escapeHtml(team.captainIdentityKey)}">${escapeHtml(team.captainName)}</a>`
        : escapeHtml(team.captainName);

      return `
      <div class="fun-facts-box" style="margin-bottom:12px;">
        <div class="collapsible-body" style="padding:14px 18px;">
          <h4 class="mock-draftiq-team-header">${captainNameHtml}
            <span class="stat-formula">(avg value ${team.avgDraftValue !== null ? (team.avgDraftValue > 0 ? "+" : "") + team.avgDraftValue : "–"})</span>
          </h4>
          <table class="profile-history-table">
            <thead><tr><th>Pick #</th><th>Player</th><th>Entering Rank</th><th>Value</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
}

document
  .getElementById("mockEvaluateDraftIQBtn")
  .addEventListener("click", () => {
    const results = evaluateMockDraftIQ();
    document.getElementById("mockDraftIQResults").innerHTML =
      renderMockDraftIQResults(results);
  });

async function initMockDraftTab() {
  await loadtrueskillData(false);
  buildPastDraftOptions(document.getElementById("mockPastDraftsOptgroup"));
  buildAdminPresetOptions(document.getElementById("mockAdminPresetsOptgroup"));
  if (
    mockDraftPool.length === 0 &&
    !document.getElementById("mockDraftFilterInput").value
  ) {
    applyMockDraftPoolFilter("");
  }
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === "mockdraft") {
    btn.addEventListener("click", () => initMockDraftTab());
  }
});

// ==================== Upcoming Roster tab ====================
async function loadUpcomingRoster() {
  if (upcomingRosterLoaded) return;
  try {
    const res = await fetch("/api/upcoming-roster");
    if (res.status === 404) return; // no file present -- tab stays hidden, this is expected/normal
    const data = await res.json();
    if (!data.exists) return;

    document.getElementById("upcomingRosterTabBtn").textContent = data.title;
    document.getElementById("upcomingRosterTabBtn").style.display = "";
    document.getElementById("upcomingRosterContent").innerHTML =
      renderUpcomingRoster(data);
    upcomingRosterLoaded = true;
  } catch (err) {
    // silently do nothing -- absence of this feature should never surface as an error to the user
  }
}

function renderUpcomingRoster(data) {
  return data.teams
    .map((team) => {
      const rosterRows = team.roster
        .map((p) => {
          const nameHtml = renderClickableName(p.displayName, p.identityKey, p.identified);
          const ratingHtml =
            p.conservativeRating !== null
              ? renderTrueSkillValue(p.conservativeRating, p.mu)
              : '<span class="stat-formula">Unrated (No games yet)</span>';
          return `<tr>
        <td>#${p.pickOrder}</td>
        <td>${nameHtml}</td>
        <td>${ratingHtml}</td>
        <td>${p.entryRank !== null ? "#" + p.entryRank : "–"}</td>
        <td class="${p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}">${p.value !== null ? (p.value > 0 ? "+" : "") + p.value : "–"}</td>
      </tr>`;
        })
        .join("");

      return `
      <div class="fun-facts-box" style="margin-bottom:16px;">
        <div class="collapsible-body" style="padding:16px 18px;">
          <h4>${renderNameWithTag(team.captain.displayName)}</h4>
          <div class="profile-summary">
            <span>Avg Entry TrueSkill: ${team.avgEntryRating !== null ? renderTrueSkillValue(team.avgEntryRating) : "–"} (${team.ratedCount}/${team.totalCount} rated)</span>
            <span>Draft IQ: ${team.draftIQ !== null ? (team.draftIQ > 0 ? "+" : "") + team.draftIQ : "–"}</span>
          </div>
          <table class="profile-history-table">
            <thead><tr><th>Pick #</th><th>Player</th><th>TrueSkill</th><th>Rank</th><th>Value</th></tr></thead>
            <tbody>${rosterRows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
}

tabButtons.forEach((btn) => {
  if (btn.dataset.tab === "upcomingroster") {
    btn.addEventListener("click", () => loadUpcomingRoster());
  }
});

// ==================== Draft Data tab ====================
const DRAFT_DATA_COLUMNS = [
  {
    key: "Tournament",
    label: "Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "Year",
    label: "Year",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "Captain",
    label: "Captain",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "Player",
    label: "Player",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    playerLink: true,
    className: "group-name",
  },
  {
    key: "Pick Order",
    label: "Pick Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "Rank",
    label: "Rank",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 1,
  },
];

const draftDataTable = createTabTable({
  columns: DRAFT_DATA_COLUMNS,
  headerRowEl: document.getElementById("draftHeaderRow"),
  bodyEl: document.getElementById("draftBody"),
  columnsBtnEl: document.getElementById("draftColumnsBtn"),
  columnsPanelEl: document.getElementById("draftColumnsPanel"),
  ownerKey: "draftdata",
  defaultSortColumn: "Year",
  emptyMessage: "No rows match the active filters",
});

async function loadDraftData() {
  if (draftDataLoaded) return;
  const res = await fetch("/api/raw");
  const data = await res.json();
  // Raw DB values arrive as strings (SQLite/CSV-sourced) -- coerceNumericColumns
  // is the same helper the old single Raw Data tab used, just called here
  // against this tab's own column list instead of a dynamically-discovered one.
  coerceNumericColumns(
    DRAFT_DATA_COLUMNS.map((c) => c.key),
    data.rows,
  );
  draftDataTable.setData(data.rows);
  draftDataLoaded = true;
}

document.getElementById("downloadDraftCsvBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = "/api/raw.csv";
  a.download = "draft-data.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ==================== Match Data tab ====================
function renderMatchRosterDetail(row) {
  const rosterList = (team) =>
    (team?.roster || [])
      .map(
        (m) =>
          `<li>${escapeHtml(m.displayName)} <span class="roster-rating">${renderTrueSkillValue ? renderTrueSkillValue(m.conservativeRating, m.mu) : m.conservativeRating}</span></li>`,
      )
      .join("");
  return `
    <div class="roster-detail">
      <div><strong>${escapeHtml(row._team1Roster?.name || row.team1)}</strong> - avg TrueSkill: ${renderTrueSkillValue(row._team1Roster?.avgConservativeRating, row._team1Roster?.avgMu)}
        <ul>${rosterList(row._team1Roster)}</ul></div>
      <div><strong>${escapeHtml(row._team2Roster?.name || row.team2)}</strong> - avg TrueSkill: ${renderTrueSkillValue(row._team2Roster?.avgConservativeRating, row._team2Roster?.avgMu)}
        <ul>${rosterList(row._team2Roster)}</ul></div>
    </div>`;
}

const MATCH_DATA_COLUMNS = [
  {
    key: "year",
    label: "Year",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "tournament",
    label: "Tournament",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
    filterType: "checkbox",
  },
  {
    key: "team1",
    label: "Team 1",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "team2",
    label: "Team 2",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "result",
    label: "Result",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "match_order",
    label: "Match Order",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
  },
  {
    key: "match_stage",
    label: "Match Stage",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "string",
  },
  {
    key: "csv_row_index",
    label: "CSV Row",
    sortable: true,
    hideable: true,
    filterable: true,
    type: "number",
    decimals: 0,
    defaultHidden: true,
  },
];

const matchDataTable = createTabTable({
  columns: MATCH_DATA_COLUMNS,
  headerRowEl: document.getElementById("matchHeaderRow"),
  bodyEl: document.getElementById("matchBody"),
  columnsBtnEl: document.getElementById("matchColumnsBtn"),
  columnsPanelEl: document.getElementById("matchColumnsPanel"),
  ownerKey: "matchdata",
  defaultSortColumn: "year",
  emptyMessage: "No rows match the active filters",
  expandable: { getDetailHtml: renderMatchRosterDetail },
});

async function loadMatchData() {
  if (matchDataLoaded) return;
  const res = await fetch("/api/raw-matches");
  const data = await res.json();
  coerceNumericColumns(
    MATCH_DATA_COLUMNS.map((c) => c.key),
    data.rows,
  );
  matchDataTable.setData(data.rows);
  matchDataLoaded = true;
}

document.getElementById("downloadMatchCsvBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = "/api/raw-matches.csv";
  a.download = "match-data.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ==================== Tab Buttons ====================
tabButtons.forEach((btn) => {
  if (btn.dataset.tab === "trueskill") {
    btn.addEventListener("click", () => loadtrueskillData(false));
  }
  if (btn.dataset.tab === "matchdata") {
    btn.addEventListener("click", () => loadMatchData(false));
  }
  if (btn.dataset.tab === "draftdata") {
    btn.addEventListener("click", () => loadDraftData(false));
  }
  if (btn.dataset.tab === "draftiq" || btn.dataset.tab === "teambalance") {
    btn.addEventListener("click", () => loadDraftAnalysis());
  }
});

// ==================== URL query param state ====================

function readStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab") || "trueskill";
  setActiveTab(tab);
  if (tab === "draftdata") loadDraftData();
  if (tab === "matchdata") loadMatchData();
  if (tab === "draftiq" || tab === "teambalance") loadDraftAnalysis();
  if (tab === "mockdraft") initMockDraftTab();
}

function writeStateToURL() {
  const params = new URLSearchParams();
  const activeTab =
    document.querySelector(".tab-btn.active")?.dataset.tab || "trueskill";
  params.set("tab", activeTab);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", newUrl);
}

let fetchDebounceTimer = null;
let urlDebounceTimer = null;

function scheduleUrlUpdate() {
  clearTimeout(urlDebounceTimer);
  urlDebounceTimer = setTimeout(writeStateToURL, 150);
}

// ==================== Init ====================

async function loadMeta() {
  const res = await fetch("/api/meta");
  const meta = await res.json();
  groupColName = meta.groupCol;
}

(async function init() {
  initTheme();
  initPlayerProfile();
  readStateFromURL();
  await loadMeta();
  await fetchStats(RANKINGS_RISK, RANKINGS_HALF_LIFE);
  loadtrueskillData();
  loadUpcomingRoster();
  writeStateToURL();
})();
