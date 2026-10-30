// Reads the match summary out of a League of Legends replay (.rofl) file, in
// the browser. Only the last bytes of the file are read -- the metadata block
// that ROFL2 replays (patch 14.11 and later) append -- so a 20 MB replay is
// never uploaded anywhere and the server needs no new endpoint.
//
// ROFL2 layout, as far as this reader cares:
//   bytes 0-5     "RIOT" 02 00            magic (02 = ROFL2)
//   byte  14      length N, then N bytes  game version, e.g. "14.16.609.8277"
//   ...           zstd-compressed game data (ignored: binary network packets)
//   end - 4 - M   M bytes of JSON         {gameLength, ..., statsJson}
//   last 4 bytes  M, little-endian
// `statsJson` is itself a JSON string: one object per player, every value a
// string.

export class ReplayError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReplayError";
  }
}

const MAGIC_PREFIX = [0x52, 0x49, 0x4f, 0x54]; // "RIOT"
const ROFL2_VERSION_BYTES = [0x02, 0x00];
const MAX_METADATA_BYTES = 8 * 1024 * 1024; // real ones are ~60-100 KB

const POSITION_TO_ROLE = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  UTILITY: "Supp",
};
const ROLE_ORDER = ["Top", "Jungle", "Mid", "Bot", "Supp"];

function readBlobBytes(blob) {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const startsWith = (bytes, prefix) => prefix.every((byte, i) => bytes[i] === byte);

function readVersion(head) {
  const length = head[14];
  if (!length || length > 32 || 15 + length > head.length) return null;
  const chars = Array.from(head.slice(15, 15 + length));
  if (!chars.every((c) => c >= 0x20 && c <= 0x7e)) return null;
  return String.fromCharCode(...chars);
}

const toInt = (value) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
};

const text = (value) => (typeof value === "string" ? value.trim() : "");

// Turns the decoded metadata object into the summary the app uses. Exported
// separately so it can be tested without building a binary file.
export function parseReplayMetadata(metadata, { version = null, fileName = "" } = {}) {
  let stats;
  try {
    stats = JSON.parse(metadata?.statsJson);
  } catch {
    throw new ReplayError("This replay has no readable player stats.");
  }
  if (!Array.isArray(stats) || stats.length === 0) {
    throw new ReplayError("This replay has no readable player stats.");
  }

  const players = stats.map((raw, index) => {
    // Newer replays (15.x+) blank NAME and carry the full Riot ID instead;
    // older ones only have NAME, with no tag line.
    const gameName = text(raw.RIOT_ID_GAME_NAME) || text(raw.NAME);
    const tagLine = text(raw.RIOT_ID_GAME_NAME) ? text(raw.RIOT_ID_TAG_LINE) : "";
    const position = POSITION_TO_ROLE[text(raw.INDIVIDUAL_POSITION)] || POSITION_TO_ROLE[text(raw.TEAM_POSITION)];
    return {
      index,
      team: toInt(raw.TEAM),
      gameName,
      tagLine,
      riotId: gameName && tagLine ? `${gameName}#${tagLine}` : gameName,
      champion: text(raw.SKIN),
      role: position || null,
      kills: toInt(raw.CHAMPIONS_KILLED),
      deaths: toInt(raw.NUM_DEATHS),
      assists: toInt(raw.ASSISTS),
      win: text(raw.WIN) === "Win",
    };
  });

  const teams = [...new Set(players.map((p) => p.team))];
  if (teams.length !== 2 || teams.some((t) => t === null)) {
    throw new ReplayError("Only standard two-team games are supported (this one has a different team layout).");
  }
  if (players.some((p) => !p.champion)) {
    throw new ReplayError("This replay is missing champion data for some players.");
  }

  teams.sort((a, b) => a - b);
  const roleRank = (p) => (p.role ? ROLE_ORDER.indexOf(p.role) : ROLE_ORDER.length);
  players.sort((a, b) => teams.indexOf(a.team) - teams.indexOf(b.team) || roleRank(a) - roleRank(b) || a.index - b.index);

  const winner = players.find((p) => p.win);
  const patch = version ? version.split(".").slice(0, 2).join(".") : null;
  return {
    fileName,
    version,
    patch,
    durationMs: Number.isFinite(metadata.gameLength) ? metadata.gameLength : null,
    teams, // e.g. [100, 200]
    winnerTeam: winner ? winner.team : null,
    players,
    hasRoles: players.some((p) => p.role),
    hasNames: players.some((p) => p.gameName),
  };
}

// Reads a File/Blob. Throws ReplayError with a message fit to show the user.
export async function readReplayFile(file) {
  if (!file || typeof file.size !== "number" || typeof file.slice !== "function") {
    throw new ReplayError("No replay file was selected.");
  }
  if (file.size < 64) throw new ReplayError("That file is too small to be a replay.");

  const head = await readBlobBytes(file.slice(0, 64));
  if (!startsWith(head, MAGIC_PREFIX)) {
    throw new ReplayError("That doesn't look like a League of Legends replay (.rofl) file.");
  }
  if (!startsWith(head.slice(4), ROFL2_VERSION_BYTES)) {
    throw new ReplayError("This is an older replay format (before patch 14.9). Only newer .rofl files can be read.");
  }

  const tail = await readBlobBytes(file.slice(file.size - 4));
  const length = new DataView(tail.buffer, tail.byteOffset, 4).getUint32(0, true);
  if (length < 2 || length > MAX_METADATA_BYTES || length > file.size - 4 - 6) {
    throw new ReplayError(
      "This replay has no match summary at the end of the file. Replays from patches 14.9 and 14.10 don't, and a damaged download won't either.",
    );
  }

  const bytes = await readBlobBytes(file.slice(file.size - 4 - length, file.size - 4));
  let metadata;
  try {
    metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ReplayError("The replay's match summary is damaged and couldn't be read.");
  }
  return parseReplayMetadata(metadata, { version: readVersion(head), fileName: file.name || "" });
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "";
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
