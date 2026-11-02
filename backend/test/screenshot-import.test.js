const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const sharp = require("sharp");
const {
  ScreenshotError,
  checkTotals,
  cleanName,
  createScreenshotService,
  decideWinner,
  parseBanner,
  parseCount,
  parseDuration,
  parseTotals,
} = require("../src/lib/screenshot-import");
const { parseTsv, wordsToLines } = require("../src/lib/screenshot-ocr");

const ICONS = path.join(__dirname, "..", "public", "icons", "champions");
const FIXTURES = path.join(__dirname, "fixtures");
const hasTesseract = !spawnSync(process.env.TESSERACT_BIN || "tesseract", ["--version"]).error;
const hasIcons = fs.existsSync(ICONS) && fs.readdirSync(ICONS).some((file) => file.endsWith(".png"));
const silent = { log() {}, warn() {}, error() {} };

// ---- small parsers ------------------------------------------------------------

test("names keep their text but lose the junk OCR adds at the edges", () => {
  assert.equal(cleanName("  ILove2FuttBuck "), "ILove2FuttBuck");
  assert.equal(cleanName("| Fabulous   Yuma _"), "Fabulous Yuma");
  assert.equal(cleanName("[Kalesvol]"), "Kalesvol");
  assert.equal(cleanName("Ène"), "Ène");
  assert.equal(cleanName("..."), "");
  assert.equal(cleanName(null), "");
});

test("a K/D/A cell is one integer, or unreadable", () => {
  assert.equal(parseCount("17"), 17);
  assert.equal(parseCount(" 0 "), 0);
  assert.equal(parseCount(""), null);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount("1234"), null);
});

test("totals need all three numbers; stray trailing digits from a neighbouring icon are ignored", () => {
  assert.deepEqual(parseTotals("29 / 24 / 72"), [29, 24, 72]);
  assert.deepEqual(parseTotals("24/13/53 7"), [24, 13, 53]);
  assert.deepEqual(parseTotals("29 24 72"), [29, 24, 72]); // slashes lost to compression
  assert.equal(parseTotals("24 / 13"), null);
  assert.equal(parseTotals("2413 53"), null);
  assert.equal(parseTotals(""), null);
});

test("duration and the VICTORY/DEFEAT banner are read leniently but sanely", () => {
  assert.equal(parseDuration("Summoner's Rift - Custom - 42:09 - 08/26/2023"), (42 * 60 + 9) * 1000);
  assert.equal(parseDuration("er's Rift » Custom * 34:32 »* 08/26/2023"), (34 * 60 + 32) * 1000);
  assert.equal(parseDuration("no time here"), null);
  assert.equal(parseDuration("0:30"), null);
  assert.equal(parseDuration("12:75"), null);
  assert.equal(parseBanner("VICTORY"), "victory");
  assert.equal(parseBanner("V1CTORY"), "victory");
  assert.equal(parseBanner("DEFEAT"), "defeat");
  assert.equal(parseBanner("EFEAT"), "defeat");
  assert.equal(parseBanner("hello"), null);
});

test("the winner is the viewer's team on VICTORY and the other on DEFEAT", () => {
  assert.equal(decideWinner("victory", 0), 0);
  assert.equal(decideWinner("victory", 1), 1);
  assert.equal(decideWinner("defeat", 0), 1);
  assert.equal(decideWinner("defeat", 1), 0);
  assert.equal(decideWinner(null, 0), null);
  assert.equal(decideWinner("victory", null), null);
});

test("tesseract output is parsed to words, and stacked crops are shared out by line", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "4\t1\t1\t1\t1\t0\t0\t0\t10\t10\t-1\t",
    "5\t1\t1\t1\t1\t1\t30\t20\t40\t16\t91.5\tFabulous",
    "5\t1\t1\t1\t1\t2\t80\t20\t30\t16\t88\tYuma",
    "5\t1\t1\t1\t2\t1\t20\t90\t50\t16\t70\t7",
    "5\t1\t1\t1\t2\t2\t20\t91\t5\t5\t-1\t   ",
  ].join("\n");
  const words = parseTsv(tsv);
  assert.deepEqual(words.map((w) => w.text), ["Fabulous", "Yuma", "7"]);
  const lines = wordsToLines(words, [28, 98, 170]);
  assert.deepEqual(lines.map((l) => l.text), ["Fabulous Yuma", "7", ""]);
  assert.equal(lines[2].conf, null);
  assert.ok(Math.abs(lines[0].conf - 89.75) < 1e-9);
});

// ---- cross-checks -------------------------------------------------------------

const team = (side, rows) => rows.map(([kills, deaths, assists]) => ({ team: side, kills, deaths, assists }));
const ONE = [[4, 7, 18], [7, 4, 16], [14, 3, 8], [1, 5, 19], [3, 5, 11]]; // sums 29/24/72
const TWO = [[1, 8, 11], [6, 4, 10], [10, 5, 6], [2, 10, 6], [5, 2, 8]]; // sums 24/29/41
const both = (one = ONE, two = TWO) => [...team(0, one), ...team(1, two)];

test("K/D/A that add up to the printed totals are verified", () => {
  const result = checkTotals(both(), [["29 / 24 / 72"], ["24 / 29 / 41"]]);
  assert.deepEqual(result.verdicts, [true, true]);
  assert.deepEqual(result.checks, []);
});

test("totals still verify when compression ate the slashes or added a stray digit", () => {
  const result = checkTotals(both(), [["29 / 2472"], ["24 29 41 3"]]);
  assert.deepEqual(result.verdicts, [true, true]);
  // One good reading among bad ones is enough.
  assert.deepEqual(checkTotals(both(), [["9024 72 9", "29/24/72"], ["2/ 29", "24/29/41 7"]]).verdicts, [true, true]);
});

test("a misread number is reported only when the totals were read consistently", () => {
  const wrong = both(ONE, [...TWO.slice(0, 4), [6, 2, 8]]); // Team 2's last kills 5 -> 6
  const twice = checkTotals(wrong, [["29 / 24 / 72", "29/24/72"], ["24 / 29 / 41", "24/29/41"]]);
  assert.deepEqual(twice.verdicts, [true, false]);
  assert.equal(twice.checks.length, 1);
  assert.match(twice.checks[0].text, /Team 2's kills/);
  assert.equal(twice.checks[0].level, "alert");
  // A single reading, or readings that disagree, could just be the totals garbled,
  // so no "doesn't match the totals" alarm (the players' own numbers still
  // contradict each other here, and that check is independent of the totals).
  const single = checkTotals(wrong, [["29 / 24 / 72"], ["24 / 29 / 41"]]);
  assert.ok(single.checks.every((check) => !/scoreboard's totals/.test(check.text)));
  // When one team's kills no longer equal the other's deaths, neither team is vouched for.
  assert.deepEqual(single.verdicts, [null, null]);
  assert.deepEqual(checkTotals(wrong, [["29 / 24 / 72"], ["24 / 29 / 41", "24 / 28 / 41"]]).verdicts, [null, null]);
});

test("without readable totals, one team's kills must still equal the other's deaths", () => {
  const ok = checkTotals(both(), [[], []]);
  assert.deepEqual(ok.verdicts, [null, null]); // can't verify against totals...
  assert.deepEqual(ok.checks, []); // ...but nothing contradicts
  const broken = checkTotals(both(ONE.map((row, i) => (i === 0 ? [5, 7, 18] : row))), [[], []]);
  assert.match(broken.checks[0].text, /should equal/);
});

test("a totals reading that is itself inconsistent is flagged as a misread, not trusted", () => {
  // Both readings say Team 1 has 30 kills but Team 2 has only 24 deaths.
  const result = checkTotals(both(), [["30 / 24 / 72", "30/24/72"], ["24 / 29 / 41"]]);
  assert.equal(result.verdicts[0], false);
  assert.ok(result.checks.some((check) => /should equal/.test(check.text)));
});

test("unreadable cells never produce a false verdict", () => {
  const players = both(ONE.map((row, i) => (i === 0 ? [4, null, 18] : row)));
  const result = checkTotals(players, [["29 / 24 / 72"], ["24 / 29 / 41"]]);
  assert.equal(result.verdicts[0], null);
  assert.equal(result.verdicts[1], true);
});

// ---- the service --------------------------------------------------------------

async function blankImage(width = 1200, height = 800) {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
}

test("something that isn't an image, or is too small, is refused with a clear message", async () => {
  const service = createScreenshotService({ iconsDir: ICONS, ocr: async () => [], logger: silent });
  await assert.rejects(() => service.parse(Buffer.from("definitely not an image")), (error) => error instanceof ScreenshotError && error.code === "bad-image");
  const tiny = await blankImage(120, 80);
  await assert.rejects(() => service.parse(tiny), (error) => error.code === "too-small");
});

test("a picture with no scoreboard in it is reported as such", async () => {
  const service = createScreenshotService({ iconsDir: ICONS, ocr: async () => [], logger: silent });
  await assert.rejects(
    async () => service.parse(await blankImage()),
    (error) => error.code === "no-scoreboard" && error.status === 422 && /Scoreboard tab/.test(error.message),
  );
});

test("screenshots are read one at a time and extra ones are turned away", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = 0;
  const service = createScreenshotService({
    iconsDir: ICONS,
    maxPending: 2,
    logger: silent,
    ocr: async () => {
      started += 1;
      await gate;
      return [];
    },
  });
  const image = await blankImage();
  const first = service.parse(image).catch((error) => error);
  const second = service.parse(image).catch((error) => error);
  const third = await service.parse(image).catch((error) => error);
  assert.equal(third.code, "busy");
  assert.equal(third.status, 429);
  for (let waited = 0; started === 0 && waited < 5000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 150)); // give a (wrongly) parallel second job time to start too
  assert.equal(started, 1, "only one job is running while the other waits");
  release();
  assert.equal((await first).code, "no-scoreboard");
  assert.equal((await second).code, "no-scoreboard");
  // The queue drains: a new one is accepted again.
  assert.equal((await service.parse(image).catch((error) => error)).code, "no-scoreboard");
});

test("a missing tesseract program is reported as unavailable (503), not a crash", async () => {
  const { OcrError } = require("../src/lib/screenshot-ocr");
  const service = createScreenshotService({
    iconsDir: ICONS,
    logger: silent,
    ocr: async () => {
      throw new OcrError("Screenshot reading isn't set up on this server.", "unavailable");
    },
  });
  await assert.rejects(
    async () => service.parse(await blankImage()),
    (error) => error instanceof ScreenshotError && error.status === 503 && error.code === "ocr-unavailable",
  );
});

// ---- real screenshots ---------------------------------------------------------

const fold = (text) => String(text).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

async function readFixture(name) {
  const service = createScreenshotService({ iconsDir: ICONS, logger: silent });
  return service.parse(fs.readFileSync(path.join(FIXTURES, name)));
}

const skipReal = !hasTesseract || !hasIcons ? "needs tesseract and the champion icons" : false;

test("reads a high-resolution scoreboard (2092px wide)", { skip: skipReal, timeout: 60000 }, async () => {
  const result = await readFixture("scoreboard-hires.png");
  assert.equal(result.source, "screenshot");
  assert.deepEqual(result.teams, [100, 200]);
  assert.equal(result.winnerTeam, 100);
  assert.equal(result.durationMs, (42 * 60 + 9) * 1000);
  assert.deepEqual(result.image, { width: 2092, height: 1258 });
  assert.equal(result.players.length, 10);
  assert.deepEqual(result.players.map((p) => p.team), [100, 100, 100, 100, 100, 200, 200, 200, 200, 200]);
  assert.deepEqual(result.players.map((p) => [p.kills, p.deaths, p.assists]), [
    [4, 7, 18], [7, 4, 16], [14, 3, 8], [1, 5, 19], [3, 5, 11],
    [1, 8, 11], [6, 4, 10], [10, 5, 6], [2, 10, 6], [5, 2, 8],
  ]);
  assert.ok(result.players.every((p) => p.review.kdaOk === true), "all numbers add up to the team totals");
  assert.deepEqual(result.players.map((p) => p.win), [true, true, true, true, true, false, false, false, false, false]);
  // Names are OCR text: close to what's on screen, not necessarily exact.
  const names = result.players.map((p) => fold(p.gameName));
  for (const [i, expected] of [[0, "xemacs"], [1, "fabulous yuma"], [3, "ninjalabib"], [5, "ilove2futtbuck"], [7, "kingofconquestlv"], [8, "lightningfst"], [9, "kalesvol"]]) {
    assert.equal(names[i], expected);
  }
  assert.ok(result.players.every((p) => p.ocr === true && p.tagLine === null && p.role === null));
  // The champions it is sure of are right; the skin portraits are flagged for review.
  const confident = Object.fromEntries(result.players.filter((p) => p.review.championConfident).map((p) => [p.index, p.champion]));
  assert.deepEqual(confident, { 0: "kayn", 1: "seraphine", 2: "tristana", 3: "alistar", 5: "nautilus", 6: "ashe", 7: "nocturne", 8: "darius" });
  assert.equal(result.players[4].review.championConfident, false); // Teemo skin
  assert.equal(result.players[9].review.championConfident, false); // Morgana skin
  assert.ok(result.players[4].review.championChoices.length >= 3);
  assert.equal(new Set(result.players.map((p) => p.champion)).size, 10, "no champion appears twice");
  assert.deepEqual(result.checks, []);
});

test("reads a low-resolution scoreboard (1029px wide)", { skip: skipReal, timeout: 60000 }, async () => {
  const result = await readFixture("scoreboard-lowres.png");
  assert.equal(result.winnerTeam, 100);
  assert.equal(result.durationMs, (34 * 60 + 32) * 1000);
  assert.deepEqual(result.players.map((p) => [p.kills, p.deaths, p.assists]), [
    [1, 2, 17], [6, 3, 15], [1, 5, 0], [7, 2, 13], [9, 1, 8],
    [0, 5, 7], [11, 3, 0], [0, 6, 11], [1, 6, 4], [1, 4, 4],
  ]);
  assert.ok(result.players.every((p) => p.review.kdaOk === true));
  const names = result.players.map((p) => fold(p.gameName));
  for (const [i, expected] of [[0, "ilove2futtbuck"], [2, "lightningfst"], [3, "kingofconquestlv"], [4, "kalesvol"], [5, "ass fuk"], [6, "yeetor"], [7, "aangelil"], [8, "angusmcrib"], [9, "sk telecom t1"]]) {
    assert.equal(names[i], expected);
  }
  const confident = Object.fromEntries(result.players.filter((p) => p.review.championConfident).map((p) => [p.index, p.champion]));
  assert.deepEqual(confident, { 0: "janna", 1: "ashe", 2: "mordekaiser", 4: "kassadin", 5: "viego", 6: "jinx", 7: "lulu", 8: "kled", 9: "ahri" });
  assert.equal(result.players[3].review.championConfident, false);
});

const HIRES_KDA = [[4, 7, 18], [7, 4, 16], [14, 3, 8], [1, 5, 19], [3, 5, 11], [1, 8, 11], [6, 4, 10], [10, 5, 6], [2, 10, 6], [5, 2, 8]];
const LOWRES_KDA = [[1, 2, 17], [6, 3, 15], [1, 5, 0], [7, 2, 13], [9, 1, 8], [0, 5, 7], [11, 3, 0], [0, 6, 11], [1, 6, 4], [1, 4, 4]];
const kdaOf = (result) => result.players.map((p) => [p.kills, p.deaths, p.assists]);

test("a shrunken copy still reads, at several sizes", { skip: skipReal, timeout: 120000 }, async () => {
  const original = fs.readFileSync(path.join(FIXTURES, "scoreboard-hires.png"));
  const service = createScreenshotService({ iconsDir: ICONS, logger: silent });
  for (const width of [1400, 1000]) {
    const result = await service.parse(await sharp(original).resize({ width }).png().toBuffer());
    assert.deepEqual(kdaOf(result), HIRES_KDA, `${width}px`);
    assert.equal(result.winnerTeam, 100, `${width}px`);
    assert.ok(result.players.every((p) => p.review.kdaOk === true), `${width}px verified`);
    assert.equal(result.players[0].champion, "kayn");
    assert.equal(result.players[0].review.championConfident, true);
  }
});

test("a low-resolution JPEG (what a chat app leaves you with) still reads", { skip: skipReal, timeout: 120000 }, async () => {
  const original = fs.readFileSync(path.join(FIXTURES, "scoreboard-lowres.png"));
  const service = createScreenshotService({ iconsDir: ICONS, logger: silent });
  for (const quality of [80, 60]) {
    const result = await service.parse(await sharp(original).jpeg({ quality }).toBuffer());
    assert.deepEqual(kdaOf(result), LOWRES_KDA, `q${quality}`);
    assert.equal(result.winnerTeam, 100, `q${quality}`);
    assert.equal(result.durationMs, (34 * 60 + 32) * 1000, `q${quality}`);
    assert.ok(result.players.every((p) => p.review.kdaOk === true), `q${quality} verified`);
    assert.equal(result.players[6].champion, "jinx");
  }
});

test("a shrunken and heavily compressed copy never claims more than it can see", { skip: skipReal, timeout: 120000 }, async () => {
  const original = fs.readFileSync(path.join(FIXTURES, "scoreboard-hires.png"));
  const compressed = await sharp(original).resize({ width: 1400 }).jpeg({ quality: 70 }).toBuffer();
  const service = createScreenshotService({ iconsDir: ICONS, logger: silent });
  const result = await service.parse(compressed);
  assert.deepEqual(kdaOf(result), HIRES_KDA);
  // Whatever champions it is "confident" about must be right.
  const truth = { 0: "kayn", 1: "seraphine", 2: "tristana", 3: "alistar", 5: "nautilus", 6: "ashe", 7: "nocturne", 8: "darius" };
  for (const player of result.players) {
    if (player.review.championConfident && truth[player.index]) assert.equal(player.champion, truth[player.index]);
  }
});

test("a cropped screenshot (no title bar, no side panel) still reads, minus the title details", { skip: skipReal, timeout: 60000 }, async () => {
  // Keep only the two team tables: drop the title/banner at the top and the bans panel at the right.
  const cropped = await sharp(path.join(FIXTURES, "scoreboard-hires.png")).extract({ left: 20, top: 290, width: 1560, height: 880 }).png().toBuffer();
  const service = createScreenshotService({ iconsDir: ICONS, logger: silent });
  const result = await service.parse(cropped);
  assert.deepEqual(result.players.map((p) => [p.kills, p.deaths, p.assists]), [
    [4, 7, 18], [7, 4, 16], [14, 3, 8], [1, 5, 19], [3, 5, 11],
    [1, 8, 11], [6, 4, 10], [10, 5, 6], [2, 10, 6], [5, 2, 8],
  ]);
  assert.equal(result.durationMs, null);
  assert.equal(result.winnerTeam, null);
  assert.ok(result.checks.some((check) => /which team won/.test(check.text)));
});
