// Champion release years, used by the Tournaments tab to work out which
// champions COULD have been picked in a given tournament ("released in
// that year or before") -- the denominator for the champion-diversity
// (Gini) measure.
//
// Keys are the same normalized ids the champion icons use (lowercase,
// alphanumeric only -- see championKey()), so this table and
// public/icons/champions/*.png line up one-to-one. Year granularity is
// deliberate: tournaments are recorded per year + season, not per date.
//
// Source: League of Legends Wiki "List of champions" (A-R) and Dot Esports'
// "All 173 League of Legends champions by release date" (full list),
// checked against each other. Current through Locke (June 2026), 173
// champions -- exactly the set in public/icons/champions.
//
// MAINTENANCE: when Riot ships a new champion, add its icon key under the
// release year below. If you forget, nothing breaks -- a champion that
// shows up in match data but isn't listed here is still counted (and
// flagged as "unrecognized" in the UI), it just isn't part of the
// available-champion pool until it's added.
const CHAMPION_KEYS_BY_RELEASE_YEAR = {
  2009: [
    "alistar", "annie", "ashe", "fiddlesticks", "jax", "kayle", "masteryi",
    "morgana", "nunu", "ryze", "sion", "sivir", "soraka", "teemo", "tristana",
    "twistedfate", "warwick", "singed", "zilean", "evelynn", "tryndamere",
    "twitch", "karthus", "amumu", "chogath", "anivia", "rammus", "veigar",
    "kassadin", "gangplank", "taric", "blitzcrank", "drmundo", "janna",
    "malphite", "corki", "katarina", "nasus", "heimerdinger", "shaco", "udyr",
    "nidalee",
  ],
  2010: [
    "poppy", "gragas", "pantheon", "mordekaiser", "ezreal", "shen", "kennen",
    "garen", "akali", "malzahar", "olaf", "kogmaw", "xinzhao", "vladimir",
    "galio", "urgot", "missfortune", "sona", "swain", "lux", "leblanc",
    "irelia", "trundle", "cassiopeia",
  ],
  2011: [
    "caitlyn", "renekton", "karma", "maokai", "jarvaniv", "nocturne",
    "leesin", "brand", "rumble", "vayne", "orianna", "yorick", "leona",
    "monkeyking", "skarner", "talon", "riven", "xerath", "graves", "shyvana",
    "fizz", "volibear", "ahri", "viktor",
  ],
  2012: [
    "sejuani", "ziggs", "nautilus", "fiora", "lulu", "hecarim", "varus",
    "darius", "draven", "jayce", "zyra", "diana", "rengar", "syndra",
    "khazix", "elise", "zed", "nami", "vi",
  ],
  2013: [
    "thresh", "quinn", "zac", "lissandra", "aatrox", "lucian", "jinx",
    "yasuo",
  ],
  2014: [
    "velkoz", "braum", "gnar", "azir", "kalista", "reksai",
  ],
  2015: [
    "bard", "ekko", "tahmkench", "kindred", "illaoi",
  ],
  2016: [
    "jhin", "aurelionsol", "taliyah", "kled", "ivern", "camille",
  ],
  2017: [
    "rakan", "xayah", "kayn", "ornn", "zoe",
  ],
  2018: [
    "kaisa", "pyke", "neeko",
  ],
  2019: [
    "sylas", "yuumi", "qiyana", "senna", "aphelios",
  ],
  2020: [
    "sett", "lillia", "yone", "samira", "seraphine", "rell",
  ],
  2021: [
    "viego", "gwen", "akshan", "vex",
  ],
  2022: [
    "zeri", "renata", "belveth", "nilah", "ksante",
  ],
  2023: [
    "milio", "naafiri", "briar", "hwei",
  ],
  2024: [
    "smolder", "aurora", "ambessa",
  ],
  2025: [
    "mel", "yunara", "zaahen",
  ],
  2026: [
    "locke",
  ],
};

// Normalizes a champion display name the same way the client's
// renderChampionIcon does, so "Kai'Sa", "Kaisa" and "kai sa" all agree.
// Wukong's internal id is MonkeyKing; Nunu & Willump is "nunu".
function championKey(name) {
  const key = String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  if (key === "wukong") return "monkeyking";
  if (key === "nunuwillump") return "nunu";
  if (key === "renataglasc") return "renata";
  return key;
}

const RELEASE_YEAR_BY_KEY = new Map();
for (const [year, keys] of Object.entries(CHAMPION_KEYS_BY_RELEASE_YEAR)) {
  for (const key of keys) RELEASE_YEAR_BY_KEY.set(key, Number(year));
}

function releaseYearOf(key) {
  return RELEASE_YEAR_BY_KEY.has(key) ? RELEASE_YEAR_BY_KEY.get(key) : null;
}

// Every champion key that existed by the end of `year`.
function championKeysAvailableIn(year) {
  const keys = [];
  for (const [key, releaseYear] of RELEASE_YEAR_BY_KEY) {
    if (releaseYear <= year) keys.push(key);
  }
  return keys;
}

module.exports = {
  championKey,
  releaseYearOf,
  championKeysAvailableIn,
  CHAMPION_KEYS_BY_RELEASE_YEAR,
};
