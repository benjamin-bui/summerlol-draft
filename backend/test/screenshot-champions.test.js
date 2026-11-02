const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { ChampionMatcher, assignDistinct } = require("../src/lib/screenshot-champions");

const ICONS = path.join(__dirname, "..", "public", "icons", "champions");
const hasIcons = fs.existsSync(ICONS) && fs.readdirSync(ICONS).some((file) => file.endsWith(".png"));

test("assignDistinct keeps confident matches and gives each player a different champion", () => {
  const picks = assignDistinct([
    [{ key: "ashe", score: 0.95 }, { key: "janna", score: 0.5 }],
    [{ key: "ashe", score: 0.8 }, { key: "janna", score: 0.7 }, { key: "lulu", score: 0.4 }],
    [{ key: "kled", score: 0.9 }, { key: "ahri", score: 0.4 }],
  ]);
  assert.deepEqual(picks.map((pick) => pick.key), ["ashe", "janna", "kled"]);
  // Player 1 lost "ashe" to a stronger match, so it isn't trusted even though its score was high.
  assert.deepEqual(picks.map((pick) => pick.confident), [true, false, true]);
  // Choices lead with the pick and never repeat a champion.
  assert.equal(picks[1].choices[0].key, "janna");
  assert.deepEqual(picks[1].choices.map((choice) => choice.key), ["janna", "ashe", "lulu"]);
});

test("a close runner-up or a weak score is not confident", () => {
  const [close, weak, clear] = assignDistinct([
    [{ key: "a", score: 0.9 }, { key: "b", score: 0.85 }],
    [{ key: "c", score: 0.6 }, { key: "d", score: 0.2 }],
    [{ key: "e", score: 0.8 }, { key: "f", score: 0.5 }],
  ]);
  assert.equal(close.confident, false);
  assert.equal(weak.confident, false);
  assert.equal(clear.confident, true);
});

test("when every candidate is taken a player keeps their own best guess, unconfident", () => {
  const picks = assignDistinct([
    [{ key: "ashe", score: 0.99 }],
    [{ key: "ashe", score: 0.6 }],
  ]);
  assert.equal(picks[1].key, "ashe");
  assert.equal(picks[1].confident, false);
});

// A synthetic scoreboard: dark background with one icon drawn as a ringed circle.
async function portraitImage(iconFile, { diameter = 60, width = 300, height = 200 } = {}) {
  const mask = Buffer.from(`<svg width="${diameter}" height="${diameter}"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2}"/></svg>`);
  const inner = Math.round(diameter * 0.9);
  // The client shows the artwork filling the circle, so the icon's own dark
  // border is cropped away (as in a real scoreboard).
  const icon = await sharp(path.join(ICONS, iconFile))
    .extract({ left: 14, top: 14, width: 100, height: 100 })
    .resize(inner, inner)
    .composite([{ input: await sharp(mask).resize(inner, inner).png().toBuffer(), blend: "dest-in" }])
    .png()
    .toBuffer();
  const ring = Buffer.from(`<svg width="${diameter}" height="${diameter}"><circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2 - 1.5}" fill="none" stroke="#c8aa6e" stroke-width="3"/></svg>`);
  const png = await sharp({ create: { width, height, channels: 3, background: { r: 8, g: 14, b: 24 } } })
    .composite([
      { input: icon, left: 100 + Math.round((diameter - inner) / 2), top: 70 + Math.round((diameter - inner) / 2) },
      { input: ring, left: 100, top: 70 },
    ])
    .png()
    .toBuffer();
  // The matcher takes plain 3-channel RGB (decode() in screenshot-import.js guarantees it).
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  return { data, width: info.width, height: info.height, circle: { cx: 100 + diameter / 2, cy: 70 + diameter / 2, radius: diameter / 2 } };
}

test("the matcher finds an icon drawn into a circle, at several sizes", { skip: !hasIcons }, async () => {
  const matcher = new ChampionMatcher({ iconsDir: ICONS });
  for (const [file, diameter] of [["ashe.png", 64], ["kayn.png", 32], ["jinx.png", 90]]) {
    const image = await portraitImage(file, { diameter });
    const ranking = await matcher.rank(image, image.circle);
    assert.equal(ranking[0].key, file.replace(".png", ""), `${file} at ${diameter}px`);
    assert.ok(ranking[0].score > 0.75, `${file} score ${ranking[0].score}`);
    assert.ok(ranking[0].score - ranking[1].score > 0.1, `${file} margin`);
  }
});

test("a portrait is still found when it is a few pixels off-centre", { skip: !hasIcons }, async () => {
  const matcher = new ChampionMatcher({ iconsDir: ICONS });
  const image = await portraitImage("seraphine.png", { diameter: 60 });
  const ranking = await matcher.rank(image, { ...image.circle, cx: image.circle.cx + 1, cy: image.circle.cy - 1 });
  assert.equal(ranking[0].key, "seraphine");
});

test("the matcher reports a missing icon folder instead of hanging, and can retry", async () => {
  const matcher = new ChampionMatcher({ iconsDir: path.join(__dirname, "no-such-folder") });
  await assert.rejects(() => matcher.ready());
  await assert.rejects(() => matcher.ready()); // not cached as a success
});
