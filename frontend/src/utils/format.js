// Pure, presentation-agnostic helpers ported from the old public/js/utils.js.
// Anything that used to return an HTML string now either returns a plain
// value/JSX component (see ../components/shared) or stays as a pure
// calculation here.

export function round3(x) {
  return Math.round(x * 1000) / 1000;
}

export function round1(x) {
  return Math.round(x * 10) / 10;
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

// Canonical role names in lane order, matching what the ingest stores.
export const ROLES = ["Top", "Jungle", "Mid", "Bot", "Supp"];
export const ROLE_LABELS = { Top: "Top", Jungle: "Jungle", Mid: "Mid", Bot: "Bot", Supp: "Support" };

const CHAMPION_ICON_ALIASES = { wukong: "monkeyking", nunuwillump: "nunu", renataglasc: "renata" };

export function championIconKey(champion) {
  const normalizedKey = String(champion || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "");
  const key = normalizedKey.toLowerCase();
  return CHAMPION_ICON_ALIASES[key] || key;
}

// Orders a team's roster Top / Jungle / Mid / Bot / Supp when roles are known.
// `roleOf(member)` returns that member's role or a falsy value. Anyone
// without a recorded role goes after those with one, in original order.
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

let rankTiers = null;
export function setRankTiers(tiers) {
  rankTiers = tiers;
}
export function getRankTier(rating) {
  if (rating === null || rating === undefined || Number.isNaN(rating)) return null;
  if (!rankTiers || rankTiers.length === 0) return null;
  const tier = rankTiers.find((t) => rating >= t.ratingCutoff);
  return tier || { name: "Iron", ratingCutoff: 0 };
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
  return (RANK_TIER_ORDER.length - tierIdx) * 10000 - divIdx * 100 + (rank.leaguePoints || 0);
}

export function parseNameList(text) {
  return text
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function seasonRankLocal(tournament) {
  const t = String(tournament || "").trim().toLowerCase();
  if (t === "winter") return 0;
  if (t === "summer") return 1;
  return 2;
}

export function tournamentSortValue(raw) {
  const s = String(raw || "").trim();
  const match = s.match(/^(winter|summer)\s*(\d{4})?$/i);
  if (!match) return 2_000_000;
  const seasonRank = match[1].toLowerCase() === "summer" ? 0 : 1;
  const year = parseInt(match[2] || "0", 10);
  return seasonRank * 1_000_000 + year;
}

export function ordinal(n) {
  if (!Number.isInteger(n)) return `#${n}`;
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

export function pct(x) {
  return `${Math.round(x * 100)}%`;
}

// Win probability as a whole-number percent, but never "0%" for something
// that merely rounds to it.
export function pctOrLessThanOne(x) {
  const rounded = Math.round(x * 100);
  return rounded === 0 && x > 0 ? "<1%" : `${rounded}%`;
}
