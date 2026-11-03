import { championMatcher, assignDistinct } from "./screenshotChampions";
import { LayoutError, layoutFromHeaders } from "./screenshotLayout";

const TEAM_IDS = [100, 200];
const MAX_PIXELS = 24_000_000;
const SCORE_FLOOR = 35;
const SCORE_FULL = 110;
const HEADING_CAP_TO_PITCH = 0.285;

export class ScreenshotReadError extends Error {
  constructor(message, code = "unreadable") {
    super(message);
    this.code = code;
  }
}

function canvasOf(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function decode(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new ScreenshotReadError("That image is too large to read. Crop it to the scoreboard.", "too-large");
    }
    const canvas = canvasOf(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return {
      canvas,
      data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch (error) {
    if (error instanceof ScreenshotReadError) throw error;
    throw new ScreenshotReadError("That file couldn't be read as an image.", "bad-image");
  } finally {
    bitmap?.close();
  }
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

function grayCanvas(data, width, height) {
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.createImageData(width, height);
  for (let i = 0; i < width * height; i += 1) {
    image.data[i * 4] = data[i];
    image.data[i * 4 + 1] = data[i];
    image.data[i * 4 + 2] = data[i];
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function scaleCanvas(source, width, height) {
  const canvas = canvasOf(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function stackLines(rgb, boxes, { lineHeight = 56, pad = 18, width = 400 } = {}) {
  const tiles = boxes.map((box) => {
    const crop = clampBox(rgb, box);
    const tileWidth = Math.max(1, Math.round((crop.width * lineHeight) / crop.height));
    const cropCanvas = canvasOf(crop.width, crop.height);
    cropCanvas.getContext("2d").drawImage(rgb.canvas, crop.left, crop.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const resized = scaleCanvas(cropCanvas, tileWidth, lineHeight);
    const pixels = resized.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, tileWidth, lineHeight).data;
    const gray = new Uint8Array(tileWidth * lineHeight);
    let min = 255;
    let max = 0;
    for (let i = 0; i < gray.length; i += 1) {
      const value = box.ink
        ? box.ink(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2])
        : Math.max(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]);
      gray[i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < gray.length; i += 1) gray[i] = 255 - Math.round(((gray[i] - min) * 255) / range);
    return { gray, width: tileWidth, height: lineHeight };
  });

  const height = tiles.length * (lineHeight + pad) + pad;
  const data = new Uint8Array(width * height).fill(255);
  const centers = [];
  tiles.forEach((tile, index) => {
    const top = pad + index * (lineHeight + pad);
    centers.push(top + lineHeight / 2);
    const copyWidth = Math.min(tile.width, width - 2 * pad);
    for (let y = 0; y < tile.height; y += 1) {
      data.set(tile.gray.subarray(y * tile.width, y * tile.width + copyWidth), (top + y) * width + pad);
    }
  });
  return { image: grayCanvas(data, width, height), centers };
}

const tealScore = (r, g, b) => (g < 0.7 * b ? 0 : Math.min(g, b) - r);
const redScore = (r, g, b) => (g > 0.6 * r && b > 0.75 * r ? 0 : r - Math.max(g, b));
const isGold = (r, g, b) => r >= 140 && b <= 0.6 * r && g >= 0.55 * r && g <= 0.95 * r;

function colourInk(rgb, score, region, scale) {
  const width = region.width;
  const height = region.height;
  const ink = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = ((region.top + y) * rgb.width + region.left + x) * 4;
      const value = score(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2]);
      if (value > SCORE_FLOOR) ink[y * width + x] = 255 - Math.round(255 * Math.min(1, (value - SCORE_FLOOR) / (SCORE_FULL - SCORE_FLOOR)));
    }
  }
  return scaleCanvas(grayCanvas(ink, width, height), Math.round(width * scale), Math.round(height * scale));
}

function parseTsv(text) {
  const words = [];
  for (const line of String(text || "").split("\n").slice(1)) {
    const cells = line.split("\t");
    if (cells.length < 12 || cells[0] !== "5") continue;
    const word = cells[11].trim();
    if (!word) continue;
    words.push({
      text: word,
      x: Number(cells[6]),
      y: Number(cells[7]),
      w: Number(cells[8]),
      h: Number(cells[9]),
      conf: Number(cells[10]),
    });
  }
  return words;
}

function wordsToLines(words, centers) {
  const lines = centers.map(() => []);
  for (const word of words) {
    const middle = word.y + word.h / 2;
    let nearest = 0;
    let best = Infinity;
    centers.forEach((center, index) => {
      const distance = Math.abs(center - middle);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    lines[nearest].push(word);
  }
  return lines.map((group) => {
    group.sort((a, b) => a.x - b.x);
    return {
      text: group.map((word) => word.text).join(" "),
      conf: group.length ? group.reduce((sum, word) => sum + word.conf, 0) / group.length : null,
    };
  });
}

function createOcr(worker) {
  return async (image, { psm = 6, whitelist = null } = {}) => {
    const options = { tessedit_pageseg_mode: String(psm) };
    if (whitelist) options.tessedit_char_whitelist = whitelist;
    const { data } = await worker.recognize(image, options, { tsv: true });
    return parseTsv(data.tsv);
  };
}

const isTeam = (word) => /^T[EF]A[MN]/i.test(word.text) && word.conf >= 40;

async function findHeading(rgb, score, ocr, targetWidth) {
  const region = { left: 0, top: 0, width: Math.floor(rgb.width * 0.7), height: rgb.height };
  const scale = Math.min(8, Math.max(1, Math.round(targetWidth / rgb.width)));
  if (region.width * region.height * scale * scale > 18_000_000) return null;
  const words = (await ocr(colourInk(rgb, score, region, scale), { psm: 11 })).filter(isTeam);
  if (!words.length) return null;
  const best = words.sort((a, b) => b.h - a.h)[0];
  return { x: best.x / scale, y: (best.y + best.h / 2) / scale, h: best.h / scale };
}

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
  const words = (await ocr(colourInk(rgb, score, region, scale), { psm: 7 }))
    .filter((word) => /^T[EF]A/i.test(word.text) && word.conf >= 30);
  if (!words.length) return null;
  const best = words.sort((a, b) => b.h - a.h)[0];
  return { x: region.left + best.x / scale, y: region.top + (best.y + best.h / 2) / scale, h: best.h / scale };
}

async function findHeadingsByText(rgb, ocr, targetWidth = 3200) {
  const width = Math.floor(rgb.width * 0.7);
  const scale = Math.min(8, Math.max(1, Math.round(targetWidth / rgb.width)));
  if (width * rgb.height * scale * scale > 18_000_000) return [null, null];
  const ink = new Uint8Array(width * rgb.height);
  for (let y = 0; y < rgb.height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * rgb.width + x) * 4;
      const value = Math.max(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2]);
      ink[y * width + x] = 255 - Math.round(255 * Math.min(1, Math.max(0, (value - 40) / 160)));
    }
  }
  const image = scaleCanvas(grayCanvas(ink, width, rgb.height), width * scale, rgb.height * scale);
  const words = (await ocr(image, { psm: 11 }))
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

function cleanName(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

function parseCount(text) {
  const digits = String(text ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 3) return null;
  return Number(digits);
}

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

function parseBanner(text) {
  const value = String(text ?? "");
  if (/V[I1l|]CT/i.test(value)) return "victory";
  if (/DEFE|EFEAT/i.test(value)) return "defeat";
  return null;
}

function findViewerRow(rgb, layout) {
  const fractions = layout.rows.map((row) => {
    const box = clampBox(rgb, layout.nameBox(row));
    let gold = 0;
    for (let y = box.top; y < box.top + box.height; y += 1) {
      for (let x = box.left; x < box.left + box.width; x += 1) {
        const i = (y * rgb.width + x) * 4;
        if (isGold(rgb.data[i], rgb.data[i + 1], rgb.data[i + 2])) gold += 1;
      }
    }
    return gold / (box.width * box.height);
  });
  const sorted = [...fractions].sort((a, b) => b - a);
  if (sorted[0] < 0.004 || sorted[0] < sorted[1] * 3) return null;
  return fractions.indexOf(sorted[0]);
}

function decideWinner(banner, viewerTeam) {
  if (!banner || viewerTeam === null) return null;
  return banner === "victory" ? viewerTeam : 1 - viewerTeam;
}

export function checkTotals(players, readings) {
  const labels = ["kills", "deaths", "assists"];
  const checks = [];
  const verdicts = [null, null];
  const known = [null, null];
  const sums = [0, 1].map((team) => {
    const own = players.filter((player) => player.team === team);
    const sum = (field) => (own.every((player) => player[field] !== null) ? own.reduce((total, player) => total + player[field], 0) : null);
    return labels.map(sum);
  });

  [0, 1].forEach((team) => {
    const texts = readings[team] || [];
    const triples = texts.map(parseTotals).filter(Boolean);
    const complete = sums[team].every((value) => value !== null);
    const expectedDigits = complete ? sums[team].join("") : null;
    const agrees = (triple) => triple.every((value, index) => sums[team][index] === null || value === sums[team][index]);
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
  const value = (team, index) => (known[team] ? known[team][index] : sums[team][index]);
  const crossChecks = [
    [0, 1, "Team 1's kills", "Team 2's deaths"],
    [1, 0, "Team 2's kills", "Team 1's deaths"],
  ];
  for (const [killer, other, killsLabel, deathsLabel] of crossChecks) {
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

async function parseScoreboardScreenshot(rgb, { worker, onProgress }) {
  const ocr = createOcr(worker);
  const [teamOne, teamTwo] = await findHeadings(rgb, ocr);
  if (!teamOne || !teamTwo) {
    throw new ScreenshotReadError(
      "Couldn't find the scoreboard. Use a screenshot of the post-game Scoreboard tab (English client) showing both teams.",
      "no-scoreboard",
    );
  }

  let layout;
  try {
    layout = layoutFromHeaders(teamOne, teamTwo, { width: rgb.width, height: rgb.height });
  } catch (error) {
    if (error instanceof LayoutError) throw new ScreenshotReadError(error.message, "bad-layout");
    throw error;
  }

  onProgress?.("Reading player names");
  const nameStack = stackLines(rgb, layout.rows.map((row) => layout.nameBox(row)), { lineHeight: 64, width: 700 });
  const nameLines = wordsToLines(await ocr(nameStack.image, { psm: 6 }), nameStack.centers);
  const kdaStack = stackLines(rgb, layout.rows.flatMap((row) => layout.kdaBoxes(row)), { lineHeight: 56, width: 300 });
  const kdaLines = wordsToLines(await ocr(kdaStack.image, { psm: 6, whitelist: "0123456789" }), kdaStack.centers);

  onProgress?.("Checking scoreboard totals");
  const inkOf = (score) => (r, g, b) => Math.min(255, Math.round((score(r, g, b) * 255) / SCORE_FULL));
  const totalsReadings = [[], []];
  for (const colored of [true, false]) {
    const boxes = [0, 1].map((team) => ({
      ...layout.totalsBox(team),
      ...(colored ? { ink: inkOf(team === 0 ? tealScore : redScore) } : {}),
    }));
    const totalsStack = stackLines(rgb, boxes, { lineHeight: 60, width: 500 });
    const lines = wordsToLines(await ocr(totalsStack.image, { psm: 6, whitelist: "0123456789/ " }), totalsStack.centers);
    lines.forEach((line, team) => {
      if (line.text) totalsReadings[team].push(line.text);
    });
  }

  const titleStack = stackLines(rgb, [layout.titleBox(), layout.bannerBox()], { lineHeight: 70, width: 1100 });
  const [titleLine, bannerLine] = wordsToLines(await ocr(titleStack.image, { psm: 6 }), titleStack.centers);
  const durationMs = parseDuration(titleLine.text);
  const banner = parseBanner(bannerLine.text);
  const viewerRow = findViewerRow(rgb, layout);
  const viewerTeam = viewerRow === null ? null : layout.rows[viewerRow].team;
  const winnerSide = decideWinner(banner, viewerTeam);

  onProgress?.("Matching champion portraits");
  const rankings = [];
  for (const row of layout.rows) rankings.push(await championMatcher.rank(rgb, layout.portrait(row)));
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
      ocr: true,
      review: {
        championConfident: champions[index].confident,
        championChoices: champions[index].choices,
        kdaOk: null,
        boxes: {
          portrait: clampBox(rgb, {
            left: portrait.cx - portrait.radius,
            top: portrait.cy - portrait.radius,
            width: portrait.radius * 2,
            height: portrait.radius * 2,
          }),
          name: clampBox(rgb, layout.nameBox(row)),
          kda: clampBox(rgb, layout.kdaStrip(row)),
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
  if (layout.lowResolution) checks.unshift({ level: "notice", text: "This screenshot is small, so readings are less reliable. Check every value." });
  const unreadable = players.filter((player) => player.kills === null || player.deaths === null || player.assists === null).length;
  if (unreadable) checks.push({ level: "alert", text: `${unreadable} player(s) have a K/D/A number that couldn't be read. Fill them in.` });
  if (winnerSide === null) checks.push({ level: "notice", text: "Couldn't tell which team won from this screenshot." });
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

let workerPromise = null;

async function readScreenshotFileNow(file, { onProgress }) {
  let worker;
  try {
    onProgress?.("Preparing screenshot");
    const rgb = await decode(file);
    if (rgb.width < 400 || rgb.height < 250) {
      throw new ScreenshotReadError("That image is too small to read. Use a larger screenshot.", "too-small");
    }
    onProgress?.("Loading local OCR engine");
    workerPromise ||= import("tesseract.js").then(({ createWorker, OEM }) =>
      createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr",
        langPath: "/ocr/lang",
        gzip: true,
        cacheMethod: "write",
        logger: ({ status }) => {
          if (status === "loading tesseract core") onProgress?.("Loading local OCR engine");
        },
      }),
    );
    worker = await workerPromise;
    return await parseScoreboardScreenshot(rgb, { worker, onProgress });
  } catch (error) {
    if (!worker) workerPromise = null;
    if (error instanceof ScreenshotReadError) throw error;
    throw new ScreenshotReadError(
      error instanceof Error ? `Could not read that screenshot. ${error.message}` : "Could not read that screenshot.",
      "ocr-failed",
    );
  } finally {
    if (worker) {
      await worker.terminate();
      workerPromise = null;
    }
  }
}

let screenshotQueue = Promise.resolve();

export function readScreenshotFile(file, options = {}) {
  const task = screenshotQueue.then(() => readScreenshotFileNow(file, options));
  screenshotQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
