const test = require("node:test");
const assert = require("node:assert/strict");
const { GRID, LayoutError, layoutFromHeaders } = require("../src/lib/screenshot-layout");

// Heading positions measured on the two real screenshots (see the fixtures).
const HIRES = { one: { x: 56, y: 325.5, h: 19 }, two: { x: 56, y: 757.5, h: 19 }, image: { width: 2092, height: 1258 } };
const LOWRES = { one: { x: 12, y: 168.25, h: 10.5 }, two: { x: 12, y: 384.25, h: 10.5 }, image: { width: 1029, height: 606 } };

test("layout derives the row pitch and ten rows from the two headings", () => {
  const hi = layoutFromHeaders(HIRES.one, HIRES.two, HIRES.image);
  assert.ok(Math.abs(hi.pitch - 70) < 0.5);
  assert.equal(hi.rows.length, 10);
  assert.deepEqual(hi.rows.map((row) => row.team), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  // First row of each team sits ~1.06 pitches under its heading.
  assert.ok(Math.abs(hi.rows[0].cy - 400) < 1.5);
  assert.ok(Math.abs(hi.rows[5].cy - 832) < 1.5);
  assert.equal(hi.lowResolution, false);

  const lo = layoutFromHeaders(LOWRES.one, LOWRES.two, LOWRES.image);
  assert.ok(Math.abs(lo.pitch - 35) < 0.5);
  assert.ok(Math.abs(lo.rows[0].cy - 205) < 1.5);
});

test("the same grid lands on the same cells at both resolutions", () => {
  const hi = layoutFromHeaders(HIRES.one, HIRES.two, HIRES.image);
  const lo = layoutFromHeaders(LOWRES.one, LOWRES.two, LOWRES.image);
  // Portrait centres measured by hand: x 235 / 102 (hi / lo).
  assert.ok(Math.abs(hi.portrait(hi.rows[0]).cx - 235) < 2);
  assert.ok(Math.abs(lo.portrait(lo.rows[0]).cx - 102) < 1.5);
  // Relative to the pitch, every box has the same shape in both.
  for (const layout of [hi, lo]) {
    const name = layout.nameBox(layout.rows[0]);
    assert.ok(Math.abs(name.width / layout.pitch - GRID.name.width) < 1e-9);
    const [kills, deaths, assists] = layout.kdaBoxes(layout.rows[0]);
    assert.ok(kills.left < deaths.left && deaths.left < assists.left);
  }
});

test("the totals, title and banner boxes sit where the heading and title text are", () => {
  const hi = layoutFromHeaders(HIRES.one, HIRES.two, HIRES.image);
  const totals = hi.totalsBox(0);
  assert.ok(totals.top < 325.5 && totals.top + totals.height > 325.5);
  const title = hi.titleBox();
  assert.ok(title.top < 96 && title.top + title.height > 96); // "Summoner's Rift - Custom - 42:09" is at y~96
  const banner = hi.bannerBox();
  assert.ok(banner.top < 55 && banner.top + banner.height > 55); // "VICTORY" at y~55
});

test("headings that can't be a scoreboard are rejected with a reason", () => {
  const image = HIRES.image;
  assert.throws(() => layoutFromHeaders(HIRES.two, HIRES.one, image), LayoutError); // upside down
  assert.throws(() => layoutFromHeaders({ x: 5, y: 10, h: 4 }, { x: 5, y: 30, h: 4 }, image), /too small/);
  assert.throws(() => layoutFromHeaders(HIRES.one, { ...HIRES.two, x: 400 }, image), /lined up/);
  assert.throws(() => layoutFromHeaders({ ...HIRES.one, h: 80 }, { ...HIRES.two, h: 80 }, image), /wrong size/);
  assert.throws(() => layoutFromHeaders(HIRES.one, HIRES.two, { width: 2092, height: 700 }), /cut off/);
  assert.throws(() => layoutFromHeaders(HIRES.one, HIRES.two, { width: 900, height: 1258 }), /cut off/);
});

test("a small screenshot is accepted but marked low resolution", () => {
  const layout = layoutFromHeaders({ x: 6, y: 100, h: 6 }, { x: 6, y: 100 + 6.17 * 20, h: 6 }, { width: 500, height: 400 });
  assert.equal(layout.lowResolution, true);
});
