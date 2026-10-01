// Parsing for the optional "Role" and "Ban" columns of the match-details CSV.
// Pure functions, no DB -- ingest-match-details.js does the persisting.

// Canonical role names, in the order the UI lists them.
const ROLES = ["Top", "Jungle", "Mid", "Bot", "Supp"];

// Everything a person might reasonably type for each role, lowercased with
// punctuation stripped (so "Jng.", "JNG" and "jng" all land on one entry).
const ROLE_ALIASES = {
  top: "Top",
  toplane: "Top",
  jungle: "Jungle",
  jng: "Jungle",
  jg: "Jungle",
  jgl: "Jungle",
  jungler: "Jungle",
  mid: "Mid",
  middle: "Mid",
  midlane: "Mid",
  bot: "Bot",
  bottom: "Bot",
  botlane: "Bot",
  adc: "Bot",
  adcarry: "Bot",
  marksman: "Bot",
  supp: "Supp",
  sup: "Supp",
  support: "Supp",
  utility: "Supp",
};

// Returns the canonical role for a CSV cell, null for an empty cell, and
// throws for anything else -- a typo'd role silently becoming "no role" would
// quietly skew every percentage computed from it.
function normalizeRole(value, rowNumber) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  const role = ROLE_ALIASES[trimmed.toLowerCase().replace(/[^a-z]/g, "")];
  if (!role) {
    throw new Error(
      `Row ${rowNumber}: "Role" value "${trimmed}" is not recognized (expected one of ${ROLES.join(", ")})`,
    );
  }
  return role;
}

// A team with no ban is a real thing in League, and people write it down a
// few different ways. None of these are champions.
const NO_BAN_PLACEHOLDERS = new Set([
  "none",
  "noban",
  "nobans",
  "n/a",
  "na",
  "-",
  "–",
  "—",
]);

const isNoBanPlaceholder = (text) =>
  NO_BAN_PLACEHOLDERS.has(text.toLowerCase().replace(/\s+/g, ""));

// A "Ban" cell may hold one champion or several. Champion names never contain
// a comma, semicolon, slash, pipe or newline ("Nunu & Willump", "Dr. Mundo"
// and "Kai'Sa" are the awkward ones, and none of those are separators here),
// so those are safe list separators. The placeholder check runs on the whole
// cell first because "N/A" would otherwise be split apart by the slash.
function parseBanList(value) {
  const cell = String(value ?? "").trim();
  if (cell === "" || isNoBanPlaceholder(cell)) return [];
  return cell
    .split(/[,;/|\n\r]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && !isNoBanPlaceholder(part));
}

module.exports = { ROLES, normalizeRole, parseBanList };
