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

export function renderNameWithTag(fullName) {
  const idx = fullName.lastIndexOf("#");
  if (idx === -1) {
    return `<span class="player-name">${escapeHtml(fullName)}</span>`;
  }
  const name = fullName.slice(0, idx);
  const tag = fullName.slice(idx);
  return `<span class="player-name">${escapeHtml(name)}</span><span class="player-tag">${escapeHtml(tag)}</span>`;
}

export function renderPlayerCell(row) {
  const fullName = row.group || row.displayName || "";
  const identityKey = row.identityKey || row._playerIdentityKey || null;
  const nameHtml = renderNameWithTag(fullName);
  if (identityKey) {
    return `<a href="#" class="player-link" data-player-key="${escapeHtml(identityKey)}" title="View profile">${nameHtml}</a>`;
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
