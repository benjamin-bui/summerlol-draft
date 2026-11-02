// Reads a screenshot of the League client's post-game Scoreboard tab into the
// same kind of match summary the replay importer produces (teams, players,
// champions, K/D/A, winner, duration), plus what the editor needs to review it.
//
// How it works, cheapest first:
//   1. Decode once to raw pixels (sharp), refusing anything huge.
//   2. Find the two "TEAM" headings: their text is a known teal / red, so mask
//      those colours and OCR the mask. Everything else is then geometry
//      (screenshot-layout.js), so cropped or differently sized screenshots work.
//   3. Read the cells: all ten names stacked into one image, all thirty K/D/A
//      numbers into another, the team totals and title strip into others. A
//      handful of tesseract runs in all, not one per cell.
//   4. Match portraits against the shipped champion icons.
//   5. Cross-check: kills must add up to the team totals, and one team's kills
//      are the other's deaths. Anything that doesn't is flagged, not guessed.
//
// Reading is never trusted blindly: every uncertain value is marked so the UI
// can ask the editor to confirm it.

const sharp = require("sharp");
const { layoutFromHeaders, LayoutError } = require("./screenshot-layout");
const { ChampionMatcher, assignDistinct } = require("./screenshot-champions");
const { OcrError, runTesseract, wordsToLines } = require("./screenshot-ocr");

// Decode and resize one image at a time, without libvips keeping a cache.
sharp.cache(false);
sharp.concurrency(1);

const MAX_PIXELS = 24_000_000; // ~6000 x 4000
const TEAM_IDS = [100, 200]; // blue / red side, as in replays

class ScreenshotError extends Error {
  constructor(message, code = "unreadable", status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ---- pixels -------------------------------------------------------------------

async function decode(buffer) {
  let decoded;
  try {
    decoded = await sharp(buffer, { limitInputPixels: MAX_PIXELS })
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ScreenshotError("That file couldn't be read as an image (or it's too large).", "bad-image");
  }
  const { data, info } = decoded;
  let pixels = data;
  if (info.channels !== 3) {
    // Greyscale or leftover alpha: rebuild as plain RGB.
    pixels = Buffer.alloc(info.width * info.height * 3);
    for (let i = 0; i < info.width * info.height; i += 1) {
      for (let c = 0; c < 3; c += 1) pixels[i * 3 + c] = data[i * info.channels + (info.channels < 3 ? 0 : c)];
    }
  }
  return { data: pixels, width: info.width, height: info.height };
}

function clampBox(rgb, box) {
  const left = Math.min(Math.max(0, Math.round(box.left)), rgb.width - 1);
  const top = Math.min(Math.max(0, Math.round(box.top)), rgb.height - 1);
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(box.width), rgb.width - left)),
    height: Math.max(1, Math.min(Math.round(box.height), rgb.height - top)),
  };
}

// Crops several boxes and stacks them as lines of one tall black-on-white
// image, so a single OCR run reads them all. Brightness is the strongest colour
// channel, which keeps coloured text (teal, red, gold) as legible as white.
// Returns the PNG and each line's vertical centre.
async function stackLines(rgb, boxes, { lineHeight = 56, pad = 18, width = 400 } = {}) {
  // A box may carry its own `ink(r, g, b)` (0-255 brightness) to pick out one
  // colour of text instead of the brightest channel.
  const tiles = [];
  for (const box of boxes) {
    const crop = clampBox(rgb, box);
    const { data, info } = await sharp(rgb.data, { raw: { width: rgb.width, height: rgb.height, channels: 3 } })
      .extract(crop)
      .resize({
        height: lineHeight,
        width: Math.max(1, Math.round((crop.width * lineHeight) / crop.height)),
        fit: "fill",
        kernel: "lanczos3",
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const gray = Buffer.alloc(info.width * info.height);
    let min = 255;
    let max = 0;
    for (let i = 0; i < gray.length; i += 1) {
      const value = box.ink
        ? box.ink(data[i * 3], data[i * 3 + 1], data[i * 3 + 2])
        : Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
      gray[i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < gray.length; i += 1) gray[i] = 255 - Math.round(((gray[i] - min) * 255) / range);
    tiles.push({ gray, width: info.width, height: info.height });
  }
  const height = tiles.length * (lineHeight + pad) + pad;
  const canvas = Buffer.alloc(width * height, 255);
  const centers = [];
  tiles.forEach((tile, index) => {
    const top = pad + index * (lineHeight + pad);
    centers.push(top + lineHeight / 2);
    const copyWidth = Math.min(tile.width, width - 2 * pad);
    for (let y = 0; y < tile.height; y += 1) {
      tile.gray.copy(canvas, (top + y) * width + pad, y * tile.width, y * tile.width + copyWidth);
    }
  });
  const png = await sharp(canvas, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return { png, centers };
}

// ---- finding the scoreboard ---------------------------------------------------

// How teal / how red a pixel is, 0 when it isn't. These score the colour rather
// than test it, so the anti-aliased edges of resized or recompressed text keep
// their weight (a hard yes/no mask leaves thin, jagged text OCR can't read).
// The guards keep the dark-blue background and white text from scoring.
const tealScore = (r, g, b) => (g < 0.7 * b ? 0 : Math.min(g, b) - r);
const redScore = (r, g, b) => (g > 0.6 * r && b > 0.75 * r ? 0 : r - Math.max(g, b));
const isGold = (r, g, b) => r >= 140 && b <= 0.6 * r && g >= 0.55 * r && g <= 0.95 * r;
const SCORE_FLOOR = 35;
const SCORE_FULL = 110;
const HEADING_CAP_TO_PITCH = 0.285; // text height / row pitch, about 0.27-0.30

// A black-on-white picture of one colour's text in a region: ink is darker the
// more strongly a pixel scores, then enlarged by `scale` for the OCR.
async function colourInk(rgb, score, region, scale) {
  const width = region.width;
  const ink = Buffer.alloc(width * region.height, 255);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = ((region.top + y) * rgb.width + region.left + x) * 3;
      const value = score(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2]);
      if (value > SCORE_FLOOR) ink[y * width + x] = 255 - Math.round(255 * Math.min(1, (value - SCORE_FLOOR) / (SCORE_FULL - SCORE_FLOOR)));
    }
  }
  return sharp(ink, { raw: { width, height: region.height, channels: 1 } })
    .resize(Math.round(width * scale), Math.round(region.height * scale), { kernel: "lanczos3" })
    .png()
    .toBuffer();
}

const isTeam = (word) => /^T[EF]A[MN]/i.test(word.text) && word.conf >= 40;

// Finds one colour's "TEAM" heading by OCR-ing the colour's ink over the left 70%
// of the picture (where the headings are). `targetWidth` sets how far the
// picture is enlarged: Tesseract wants letters about 25-30px tall, and a
// shrunken screenshot needs more enlarging than a native one.
async function findHeading(rgb, score, ocr, targetWidth) {
  const region = { left: 0, top: 0, width: Math.floor(rgb.width * 0.7), height: rgb.height };
  const scale = Math.min(8, Math.max(1, Math.round(targetWidth / rgb.width)));
  if (region.width * region.height * scale * scale > 60_000_000) return null; // refuse absurd enlargement
  const words = (await ocr(await colourInk(rgb, score, region, scale), { psm: 11 })).filter(isTeam);
  if (!words.length) return null;
  const best = words.sort((a, b) => b.h - a.h)[0];
  return { x: best.x / scale, y: (best.y + best.h / 2) / scale, h: best.h / scale };
}

// Having found one heading, the other is a known distance away (6.17 row
// pitches, and the pitch follows from the text height), so look only there,
// as a single line of text. Catches headings that were too faint to find on
// the whole picture.
async function findHeadingNear(rgb, score, known, direction, ocr) {
  const pitch = known.h / HEADING_CAP_TO_PITCH;
  const centre = known.y + direction * 6.17 * pitch;
  const left = Math.max(0, Math.floor(known.x - 1.5 * pitch));
  const top = Math.max(0, Math.floor(centre - 0.9 * pitch));
  const region = {
    left,
    top,
    width: Math.max(1, Math.min(Math.ceil(7 * pitch), rgb.width - left)),
    height: Math.max(1, Math.min(Math.ceil(1.8 * pitch), rgb.height - top)),
  };
  if (region.top >= rgb.height || region.left >= rgb.width) return null;
  const scale = Math.min(8, Math.max(1, 60 / known.h));
  const words = (await ocr(await colourInk(rgb, score, region, scale), { psm: 7 })).filter((word) => /^T[EF]A/i.test(word.text) && word.conf >= 30);
  if (!words.length) return null;
  const best = words.sort((a, b) => b.h - a.h)[0];
  return { x: region.left + best.x / scale, y: region.top + (best.y + best.h / 2) / scale, h: best.h / scale };
}

// Last resort when colour fails (JPEG throws away colour detail in thin text,
// and small shrunken screenshots lose it entirely): read the brightness of the
// left strip and look for two "TEAM" words that fit a scoreboard, i.e. the same
// left edge and 21-22 text-heights apart (6.17 pitches over 0.285-pitch text).
async function findHeadingsByText(rgb, ocr, targetWidth = 3200) {
  const width = Math.floor(rgb.width * 0.7);
  const scale = Math.min(8, Math.max(1, Math.round(targetWidth / rgb.width)));
  if (width * rgb.height * scale * scale > 60_000_000) return [null, null];
  const ink = Buffer.alloc(width * rgb.height);
  for (let y = 0; y < rgb.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * rgb.width + x) * 3;
      const value = Math.max(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2]);
      ink[y * width + x] = 255 - Math.round(255 * Math.min(1, Math.max(0, (value - 40) / 160)));
    }
  }
  const png = await sharp(ink, { raw: { width, height: rgb.height, channels: 1 } })
    .resize(width * scale, rgb.height * scale, { kernel: "lanczos3" })
    .png()
    .toBuffer();
  const words = (await ocr(png, { psm: 11 }))
    .filter(isTeam)
    .map((word) => ({ x: word.x / scale, y: (word.y + word.h / 2) / scale, h: word.h / scale }));
  let best = null;
  for (const upper of words) {
    for (const lower of words) {
      const height = (upper.h + lower.h) / 2;
      const ratio = (lower.y - upper.y) / height;
      if (lower.y <= upper.y || Math.abs(upper.x - lower.x) > height * 2 || Math.abs(upper.h - lower.h) > height * 0.4) continue;
      const error = Math.abs(ratio - 6.17 / HEADING_CAP_TO_PITCH);
      if (error < 3.5 && (!best || error < best.error)) best = { upper, lower, error };
    }
  }
  return best ? [best.upper, best.lower] : [null, null];
}

// Both headings, trying progressively harder: the whole picture at a normal
// enlargement, again at a larger one, then a targeted look for whichever one
// is still missing.
async function findHeadings(rgb, ocr) {
  const found = { teal: null, red: null };
  const scores = { teal: tealScore, red: redScore };
  for (const targetWidth of [3200, 4500]) {
    for (const key of ["teal", "red"]) {
      if (!found[key]) found[key] = await findHeading(rgb, scores[key], ocr, targetWidth);
    }
    if (found.teal && found.red) break;
  }
  if (found.teal && !found.red) found.red = await findHeadingNear(rgb, redScore, found.teal, 1, ocr);
  if (found.red && !found.teal) found.teal = await findHeadingNear(rgb, tealScore, found.red, -1, ocr);
  if (found.teal && found.red) return [found.teal, found.red];
  return findHeadingsByText(rgb, ocr);
}

// ---- reading values -----------------------------------------------------------

// Names are kept as read. Strips the stray bars and brackets OCR invents at the
// edges of a crop, and collapses runs of spaces.
function cleanName(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

// One cell is one integer; anything else is unreadable rather than guessed.
// Tesseract's own confidence is deliberately not used: on crops this small it
// gives right answers a score near 0, so it would throw good readings away. The
// team totals check (checkTotals) is what catches wrong ones.
function parseCount(text) {
  const digits = String(text ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 3) return null;
  return Number(digits);
}

// "29 / 24 / 72" -> [29, 24, 72]. JPEG compression often eats or garbles the
// slashes, so three separate numbers also count; anything else is null.
function parseTotals(text) {
  const value = String(text ?? "");
  const slashed = /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/.exec(value);
  if (slashed) return [Number(slashed[1]), Number(slashed[2]), Number(slashed[3])];
  const numbers = value.match(/\d+/g);
  return numbers && numbers.length === 3 ? numbers.map(Number) : null;
}

function parseDuration(text) {
  const match = /(\d{1,3}):(\d{2})/.exec(String(text ?? ""));
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59 || minutes === 0 || minutes > 180) return null;
  return (minutes * 60 + seconds) * 1000;
}

// The big "VICTORY" / "DEFEAT" word is read from the viewer's side.
function parseBanner(text) {
  const value = String(text ?? "");
  if (/V[I1l|]CT/i.test(value)) return "victory";
  if (/DEFE|EFEAT/i.test(value)) return "defeat";
  return null;
}

// The player whose screenshot it is has their name in gold. Returns the row
// index, or null when no row stands out clearly.
function findViewerRow(rgb, layout) {
  const fractions = layout.rows.map((row) => {
    const box = clampBox(rgb, layout.nameBox(row));
    let gold = 0;
    for (let y = box.top; y < box.top + box.height; y += 1) {
      for (let x = box.left; x < box.left + box.width; x += 1) {
        const i = (y * rgb.width + x) * 3;
        if (isGold(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2])) gold += 1;
      }
    }
    return gold / (box.width * box.height);
  });
  const sorted = [...fractions].sort((a, b) => b - a);
  if (sorted[0] < 0.004 || sorted[0] < sorted[1] * 3) return null;
  return fractions.indexOf(sorted[0]);
}

// viewerTeam: 0 / 1 (index of the team the screenshot's owner was on).
function decideWinner(banner, viewerTeam) {
  if (!banner || viewerTeam === null) return null;
  return banner === "victory" ? viewerTeam : 1 - viewerTeam;
}

// Cross-checks the K/D/A numbers against the team totals printed above each
// team. players: [{ team, kills, deaths, assists }]. readings: per team, the raw
// text of each attempt at reading the totals (possibly none: any single reading
// of JPEG-damaged text is unreliable).
//
// A team is verified when some reading agrees with the players' sums, either as
// three numbers or as the same string of digits with the slashes ignored (they
// are the first thing compression destroys). Three numbers agreeing by chance
// is very unlikely. A mismatch is only reported when at least two readings
// agree with each other, so one garbled read can't raise a false alarm.
// Returns per-team verdicts (true = adds up, false = doesn't, null = couldn't
// tell) and the messages to show.
function checkTotals(players, readings) {
  const labels = ["kills", "deaths", "assists"];
  const checks = [];
  const verdicts = [null, null];
  const known = [null, null]; // the totals we trust for each team, if any
  const sums = [0, 1].map((team) => {
    const own = players.filter((player) => player.team === team);
    const sum = (field) =>
      own.every((player) => player[field] !== null) ? own.reduce((total, player) => total + player[field], 0) : null;
    return labels.map(sum);
  });

  [0, 1].forEach((team) => {
    const texts = readings[team] || [];
    const triples = texts.map(parseTotals).filter(Boolean);
    const complete = sums[team].every((value) => value !== null);
    const expectedDigits = complete ? sums[team].join("") : null;
    const agrees = (triple) => triple.every((value, index) => sums[team][index] === null || value === sums[team][index]);
    // A stray digit from the icon beside the totals can trail the reading.
    const sameDigits = (text) => {
      if (!expectedDigits) return false;
      const digits = text.replace(/\D/g, "");
      return digits.startsWith(expectedDigits) && digits.length - expectedDigits.length <= 1;
    };
    if (complete && (triples.some(agrees) || texts.some(sameDigits))) {
      verdicts[team] = true;
      known[team] = sums[team];
      return;
    }
    const consistent = triples.length >= 2 && triples.every((triple) => triple.join() === triples[0].join());
    if (consistent) {
      known[team] = triples[0];
      const wrong = labels.filter((label, index) => sums[team][index] !== null && sums[team][index] !== triples[0][index]);
      if (wrong.length) {
        verdicts[team] = false;
        checks.push({
          level: "alert",
          text: `Team ${team + 1}'s ${wrong.join(", ")} don't add up to the scoreboard's totals (${triples[0].join("/")}). Check that team's numbers.`,
        });
      }
    }
  });

  // One team's kills are the other's deaths: from the trusted totals where we
  // have them, else from the players' own numbers.
  const value = (team, index) => (known[team] ? known[team][index] : sums[team][index]);
  const crossChecks = [
    [0, 1, 1, "Team 1's kills", "Team 2's deaths"],
    [1, 0, 1, "Team 2's kills", "Team 1's deaths"],
  ];
  for (const [killer, other, , killsLabel, deathsLabel] of crossChecks) {
    const kills = value(killer, 0);
    const deaths = value(other, 1);
    if (kills !== null && deaths !== null && kills !== deaths) {
      checks.push({ level: "alert", text: `${killsLabel} (${kills}) should equal ${deathsLabel} (${deaths}). Something was misread.` });
      verdicts.forEach((verdict, team) => {
        if (verdict === true) verdicts[team] = null;
      });
    }
  }
  return { verdicts, checks };
}

// ---- the whole read -----------------------------------------------------------

const boxOut = (rgb, box) => clampBox(rgb, box);

async function parseScoreboardScreenshot(buffer, { matcher, ocr = runTesseract }) {
  const rgb = await decode(buffer);
  if (rgb.width < 400 || rgb.height < 250) {
    throw new ScreenshotError("That image is too small to read. Use a larger screenshot.", "too-small");
  }

  const [teamOne, teamTwo] = await findHeadings(rgb, ocr);
  if (!teamOne || !teamTwo) {
    throw new ScreenshotError(
      "Couldn't find the scoreboard. Use a screenshot of the post-game Scoreboard tab (English client) showing both teams.",
      "no-scoreboard",
    );
  }
  let layout;
  try {
    layout = layoutFromHeaders(teamOne, teamTwo, { width: rgb.width, height: rgb.height });
  } catch (error) {
    if (error instanceof LayoutError) throw new ScreenshotError(error.message, "bad-layout");
    throw error;
  }

  // Names: one line per player, in row order.
  const nameStack = await stackLines(rgb, layout.rows.map((row) => layout.nameBox(row)), { lineHeight: 64, width: 700 });
  const nameLines = wordsToLines(await ocr(nameStack.png, { psm: 6 }), nameStack.centers);

  // K/D/A: three integers per player, digits only.
  const kdaStack = await stackLines(
    rgb,
    layout.rows.flatMap((row) => layout.kdaBoxes(row)),
    { lineHeight: 56, width: 300 },
  );
  const kdaLines = wordsToLines(await ocr(kdaStack.png, { psm: 6, whitelist: "0123456789" }), kdaStack.centers);

  // Team totals: read twice (in each team's colour, and as plain brightness)
  // since either alone is unreliable on compressed images; checkTotals uses
  // whichever reading agrees with the players' numbers.
  const inkOf = (score) => (r, g, b) => Math.min(255, Math.round((score(r, g, b) * 255) / SCORE_FULL));
  const totalsReadings = [[], []];
  for (const coloured of [true, false]) {
    const boxes = [0, 1].map((team) => ({
      ...layout.totalsBox(team),
      ...(coloured ? { ink: inkOf(team === 0 ? tealScore : redScore) } : {}),
    }));
    const totalsStack = await stackLines(rgb, boxes, { lineHeight: 60, width: 500 });
    const lines = wordsToLines(await ocr(totalsStack.png, { psm: 6, whitelist: "0123456789/ " }), totalsStack.centers);
    lines.forEach((line, team) => {
      if (line.text) totalsReadings[team].push(line.text);
    });
  }

  const titleStack = await stackLines(rgb, [layout.titleBox(), layout.bannerBox()], { lineHeight: 70, width: 1100 });
  const [titleLine, bannerLine] = wordsToLines(await ocr(titleStack.png, { psm: 6 }), titleStack.centers);
  const durationMs = parseDuration(titleLine.text);
  const banner = parseBanner(bannerLine.text);

  const viewerRow = findViewerRow(rgb, layout);
  const viewerTeam = viewerRow === null ? null : layout.rows[viewerRow].team;
  const winnerSide = decideWinner(banner, viewerTeam);

  // Champions: rank every portrait, then make the ten choices distinct.
  const rankings = [];
  for (const row of layout.rows) rankings.push(await matcher.rank(rgb, layout.portrait(row)));
  const champions = assignDistinct(rankings);

  const players = layout.rows.map((row, index) => {
    const name = cleanName(nameLines[index].text);
    const counts = [0, 1, 2].map((k) => parseCount(kdaLines[index * 3 + k].text));
    const portrait = layout.portrait(row);
    return {
      index,
      team: TEAM_IDS[row.team],
      teamSide: row.team,
      riotId: name || null,
      gameName: name || null,
      tagLine: null,
      champion: champions[index].key,
      role: null,
      kills: counts[0],
      deaths: counts[1],
      assists: counts[2],
      win: winnerSide === null ? null : winnerSide === row.team,
      ocr: true, // names are OCR text: match them to rosters loosely
      review: {
        championConfident: champions[index].confident,
        championChoices: champions[index].choices,
        kdaOk: null,
        boxes: {
          portrait: boxOut(rgb, {
            left: portrait.cx - portrait.radius,
            top: portrait.cy - portrait.radius,
            width: portrait.radius * 2,
            height: portrait.radius * 2,
          }),
          name: boxOut(rgb, layout.nameBox(row)),
          kda: boxOut(rgb, layout.kdaStrip(row)),
        },
      },
    };
  });

  const { verdicts, checks } = checkTotals(
    players.map((player) => ({ team: player.teamSide, kills: player.kills, deaths: player.deaths, assists: player.assists })),
    totalsReadings,
  );
  for (const player of players) {
    player.review.kdaOk = verdicts[player.teamSide];
    delete player.teamSide;
  }

  if (layout.lowResolution) {
    checks.unshift({ level: "notice", text: "This screenshot is small, so readings are less reliable. Check every value." });
  }
  const unreadable = players.filter((p) => p.kills === null || p.deaths === null || p.assists === null).length;
  if (unreadable) {
    checks.push({ level: "alert", text: `${unreadable} player(s) have a K/D/A number that couldn't be read. Fill them in.` });
  }
  if (winnerSide === null) {
    checks.push({ level: "notice", text: "Couldn't tell which team won from this screenshot." });
  }

  return {
    source: "screenshot",
    version: null,
    patch: null,
    durationMs,
    teams: TEAM_IDS,
    winnerTeam: winnerSide === null ? null : TEAM_IDS[winnerSide],
    players,
    hasRoles: false,
    hasNames: players.some((player) => player.gameName),
    image: { width: rgb.width, height: rgb.height },
    checks,
  };
}

// ---- the service --------------------------------------------------------------

// Wraps the parser for the web server: one screenshot is read at a time, at most
// `maxPending` (running + waiting) are accepted, and the rest are turned away,
// so a burst of uploads can't pile CPU and memory onto a small shared host.
function createScreenshotService({ iconsDir, ocr = runTesseract, maxPending = 2, logger = console } = {}) {
  const matcher = new ChampionMatcher({ iconsDir });
  let tail = Promise.resolve();
  let pending = 0;
  return {
    parse(buffer) {
      if (pending >= maxPending) {
        return Promise.reject(new ScreenshotError("Another screenshot is being read. Try again in a few seconds.", "busy", 429));
      }
      pending += 1;
      const started = Date.now();
      const run = tail.then(() => parseScoreboardScreenshot(buffer, { matcher, ocr }));
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run.then(
        (summary) => {
          pending -= 1;
          logger.log(`[screenshot] read in ${Date.now() - started}ms`);
          return summary;
        },
        (error) => {
          pending -= 1;
          throw translateError(error);
        },
      );
    },
  };
}

function translateError(error) {
  if (error instanceof ScreenshotError) return error;
  if (error instanceof OcrError) {
    const status = error.code === "unavailable" ? 503 : error.code === "timeout" ? 504 : 500;
    return new ScreenshotError(error.message, `ocr-${error.code}`, status);
  }
  return error;
}

module.exports = {
  ScreenshotError,
  checkTotals,
  cleanName,
  createScreenshotService,
  decideWinner,
  parseBanner,
  parseCount,
  parseDuration,
  parseScoreboardScreenshot,
  parseTotals,
};
