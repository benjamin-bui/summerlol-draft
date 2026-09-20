let rankTiers = null;

export function setRankTiers(tiers) {
  rankTiers = tiers;
}

export function round3(x) {
  return Math.round(x * 1000) / 1000;
}

export function round1(x) {
  return Math.round(x * 10) / 10;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Same last-# split + hyphen-join op.gg uses for its own profile URLs
// (server-side twin: slugFromDisplayName in src/lib/player-identity.js) --
// used as the player-profile page's own URL segment so a profile link
// reads like an op.gg URL. Falls back to the encoded raw name for legacy
// aliases with no tag on record.
export function buildPlayerSlug(fullName) {
  if (!fullName) return null;
  const idx = fullName.lastIndexOf("#");
  if (idx === -1) return encodeURIComponent(fullName);
  const gameName = fullName.slice(0, idx).trim();
  const tagLine = fullName.slice(idx + 1).trim();
  if (!gameName || !tagLine) return encodeURIComponent(fullName);
  return `${encodeURIComponent(gameName)}-${encodeURIComponent(tagLine)}`;
}

export function renderNameWithTag(fullName) {
  const idx = fullName.lastIndexOf("#");
  if (idx === -1) {
    return `<span class="player-name">${escapeHtml(fullName)}</span>`;
  }
  const name = fullName.slice(0, idx);
  const tag = fullName.slice(idx);
  return `<span class="player-name">${escapeHtml(name)}</span><span class="player-tag">${escapeHtml(tag)}</span>`;
}

export function renderChampionIcon(champion) {
  const label = champion || "Unknown champion";
  const normalizedKey = String(champion || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "");
  // Same aliases as championKey() in src/lib/champion-releases.js -- the icon
  // files are named by Riot's internal ids, not the display names.
  const ICON_ALIASES = { wukong: "monkeyking", nunuwillump: "nunu", renataglasc: "renata" };
  let iconKey = normalizedKey.toLowerCase();
  iconKey = ICON_ALIASES[iconKey] || iconKey;
  return `<span class="champion-cell"><img src="/icons/champions/${escapeHtml(iconKey)}.png" alt="${escapeHtml(label)}" class="champion-icon" onerror="this.hidden=true" /><span>${escapeHtml(label)}</span></span>`;
}

// A team's bans for one game, as a labeled row of champion chips. Used by every
// place that shows a match (player history, Match History tab, Tournaments).
// `bans` is [{ champion, key | championKey }]; an empty list renders "–" so a
// team with no ban recorded still lines up next to one that has some.
// `highlightKey` marks the chip for one champion (the Tournaments champion
// filter uses it).
export function renderBanList(bans, { highlightKey = null } = {}) {
  const chips = (bans || [])
    .map((b) => {
      const key = b.key ?? b.championKey ?? null;
      const cls = highlightKey && key === highlightKey ? " is-highlighted" : "";
      return `<span class="ban-chip${cls}">${renderChampionIcon(b.champion)}</span>`;
    })
    .join("");
  return `<div class="ban-list"><span class="ban-list-label">Bans</span>${chips || '<span class="ban-list-none">–</span>'}</div>`;
}

// Canonical role names in lane order, matching what the ingest stores (ROLES in
// src/lib/match-detail-fields.js).
export const ROLES = ["Top", "Jungle", "Mid", "Bot", "Supp"];

// Orders a team's roster Top / Jungle / Mid / Bot / Supp when roles are known.
// `roleOf(member)` returns that member's role or a falsy value. Anyone without
// a recorded role goes after those with one, in their original order, so a
// game with partial role data still reads sensibly and a game with none is left
// exactly as it was. Stable: two players recorded in the same role (a data
// slip) also keep their original relative order. Returns a new array.
export function sortByRole(members, roleOf) {
  const rank = (member) => {
    const i = ROLES.indexOf(roleOf(member));
    return i === -1 ? ROLES.length : i;
  };
  return members
    .map((member, index) => ({ member, index, rank: rank(member) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.member);
}

export function renderPlayerCell(row) {
  const fullName = row.group || row.displayName || "";
  const identityKey = row.identityKey || row._playerIdentityKey || null;
  const nameHtml = renderNameWithTag(fullName);
  if (identityKey) {
    const slug = buildPlayerSlug(fullName) || encodeURIComponent(identityKey);
    return `<a href="/player/${slug}" class="player-link" data-player-key="${escapeHtml(slug)}" title="View profile">${nameHtml}</a>`;
  }
  if (row.profileUrl) {
    return `<a href="${escapeHtml(row.profileUrl)}" target="_blank" rel="noopener noreferrer" class="player-link" title="View on op.gg">${nameHtml}</a>`;
  }
  return nameHtml;
}

export function getRankTier(rating) {
  if (rating === null || rating === undefined || Number.isNaN(rating)) {
    return null;
  }
  if (!rankTiers || rankTiers.length === 0) {
    return null;
  }

  const tier = rankTiers.find((t) => rating >= t.ratingCutoff);
  return tier || { name: "Iron", ratingCutoff: 0 };
}

export function renderRankBadge(input) {
  let tierName = "unranked";
  let displayName = "Unranked";

  if (typeof input === "string") {
    tierName = input.toLowerCase();
    displayName = input;
  } else if (typeof input === "object" && input?.name) {
    tierName = input.name.toLowerCase();
    displayName = input.name;
  } else if (typeof input === "number" && !Number.isNaN(input)) {
    const tier = getRankTier(input);
    tierName = tier?.name?.toLowerCase() || "unranked";
    displayName = tier?.name || "Unranked";
  }

  return `<img src="/icons/${tierName}.webp" alt="${escapeHtml(displayName)} rank badge" class="rank-badge" />`;
}

export function renderTrueSkillValue(rating, mu) {
  if (rating === null || rating === undefined) {
    return "–";
  }

  const formatRating = (n) =>
    `<span class="rating-number">${Math.round(n)}</span>`;

  if (mu === null || mu === undefined || Number.isNaN(mu)) {
    return `<span class="trueskill-cell">${renderRankBadge(rating)}${formatRating(rating)}</span>`;
  }
  return `<span class="trueskill-cell">${renderRankBadge(rating)}${formatRating(rating)} (${formatRating(mu)})</span>`;
}

export function renderSoloQueueRank(rank) {
  if (!rank || !rank.tier || rank.tier === "UNRANKED") return "";
  const tierName = rank.tier.toLowerCase();
  const isApex = ["CHALLENGER", "GRANDMASTER", "MASTER"].includes(
    rank.tier.toUpperCase(),
  );
  const divisionPart = isApex ? " " : ` ${rank.division}`;

  return `<span class="trueskill-cell">${renderRankBadge(tierName)} ${divisionPart} · ${rank.leaguePoints} LP</span>`;
}

const RANK_TIER_ORDER = [
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON",
];
const DIVISION_ORDER = { I: 0, II: 1, III: 2, IV: 3 };

export function soloQueueSortValueClient(rank) {
  if (!rank || !rank.tier || rank.tier === "UNRANKED") return -1;
  const tierIdx = RANK_TIER_ORDER.indexOf(rank.tier.toUpperCase());
  const divIdx = DIVISION_ORDER[rank.division] ?? 4;
  return (
    (RANK_TIER_ORDER.length - tierIdx) * 10000 -
    divIdx * 100 +
    (rank.leaguePoints || 0)
  );
}

export function parseNameList(text) {
  return text
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function seasonRankLocal(tournament) {
  const t = String(tournament || "")
    .trim()
    .toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}
