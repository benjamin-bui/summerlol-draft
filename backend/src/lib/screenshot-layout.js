// Geometry of the League client's post-game "Scoreboard" tab, for reading a
// screenshot of it.
//
// The tab is drawn at whatever size the player's client window happens to be
// (and the screenshot may be cropped), but its proportions never change. So
// the only things measured from the image are the two "TEAM 1" / "TEAM 2"
// headings; the vertical distance between them gives the row pitch `p`, and
// every other cell is a fixed multiple of `p` from the left edge of the
// headings. Measured on a 1029px-wide and a 2092px-wide screenshot, the same
// multiples land on the same cells in both.
//
// All functions here are pure: numbers in, boxes out.

const PLAYERS_PER_TEAM = 5;

// (TEAM 2 heading y - TEAM 1 heading y) / row pitch.
const HEADER_GAP_IN_PITCHES = 6.17;

// A heading's text is about 0.27-0.30 pitches tall; far outside this means
// the "TEAM" we found is something else.
const HEADER_HEIGHT_RANGE = [0.15, 0.45];

// Pitch (px) bounds. Below MIN the cells are too small to read at all; the
// warning threshold just tells the editor to double-check everything.
const MIN_PITCH = 16;
const MAX_PITCH = 160;
const LOW_RES_PITCH = 26;

// Cell positions, in pitches. x is from the left edge of the "TEAM" heading,
// y from a row's (or heading's) vertical centre.
const GRID = {
  firstRowOffset: 1.06, // heading -> first row of that team
  portrait: { cx: 2.56, radius: 0.46 },
  name: { left: 3.15, width: 5.15, halfHeight: 0.36 },
  // Kills, deaths and assists are separate cells either side of the two "/"
  // glyphs (which sit at about 14.96 and 15.94), so each is a plain integer.
  kda: [
    { left: 13.65, width: 1.1 },
    { left: 15.12, width: 0.7 },
    { left: 16.1, width: 1.4 },
  ],
  kdaHalfHeight: 0.34,
  totals: { left: 3.2, width: 3.7, halfHeight: 0.3 },
  title: { left: 3.1, width: 10, up: 3.29, halfHeight: 0.35 },
  banner: { left: 1.5, width: 4.2, up: 3.87, halfHeight: 0.5 },
  rightEdge: 17.5, // right end of the K/D/A cells; the image must reach this
};

class LayoutError extends Error {}

// teamOne / teamTwo: { x, y, h } of each "TEAM" heading's text (left edge,
// vertical centre, height) in pixels. image: { width, height }.
function layoutFromHeaders(teamOne, teamTwo, image) {
  const pitch = (teamTwo.y - teamOne.y) / HEADER_GAP_IN_PITCHES;
  if (!(pitch > 0)) throw new LayoutError("The TEAM 1 heading should be above TEAM 2.");
  if (pitch < MIN_PITCH) throw new LayoutError("The screenshot is too small to read. Try a larger one.");
  if (pitch > MAX_PITCH) throw new LayoutError("The headings are further apart than a scoreboard's.");
  if (Math.abs(teamOne.x - teamTwo.x) > pitch * 0.5) {
    throw new LayoutError("The TEAM headings aren't lined up, so this doesn't look like the scoreboard.");
  }
  for (const header of [teamOne, teamTwo]) {
    const ratio = header.h / pitch;
    if (ratio < HEADER_HEIGHT_RANGE[0] || ratio > HEADER_HEIGHT_RANGE[1]) {
      throw new LayoutError("The TEAM headings are the wrong size, so this doesn't look like the scoreboard.");
    }
  }

  const x0 = (teamOne.x + teamTwo.x) / 2;
  const rows = [];
  [teamOne, teamTwo].forEach((header, team) => {
    for (let slot = 0; slot < PLAYERS_PER_TEAM; slot += 1) {
      rows.push({ team, slot, cy: header.y + (GRID.firstRowOffset + slot) * pitch });
    }
  });

  const lastBottom = rows[rows.length - 1].cy + 0.5 * pitch;
  if (lastBottom > image.height || x0 + GRID.rightEdge * pitch > image.width || x0 < 0) {
    throw new LayoutError("The scoreboard is cut off. Include all ten players and the K/D/A column.");
  }

  const centred = (cy, left, width, halfHeight) => ({
    left: x0 + left * pitch,
    top: cy - halfHeight * pitch,
    width: width * pitch,
    height: halfHeight * 2 * pitch,
  });
  const header = (team) => (team === 0 ? teamOne : teamTwo);

  return {
    pitch,
    x0,
    lowResolution: pitch < LOW_RES_PITCH,
    rows,
    portrait: (row) => ({
      cx: x0 + GRID.portrait.cx * pitch,
      cy: row.cy,
      radius: GRID.portrait.radius * pitch,
    }),
    nameBox: (row) => centred(row.cy, GRID.name.left, GRID.name.width, GRID.name.halfHeight),
    kdaBoxes: (row) => GRID.kda.map((cell) => centred(row.cy, cell.left, cell.width, GRID.kdaHalfHeight)),
    // The whole K/D/A strip, for showing the editor what was read.
    kdaStrip: (row) => centred(row.cy, GRID.kda[0].left - 0.1, GRID.rightEdge - GRID.kda[0].left, GRID.kdaHalfHeight + 0.04),
    totalsBox: (team) => centred(header(team).y, GRID.totals.left, GRID.totals.width, GRID.totals.halfHeight),
    titleBox: () => centred(teamOne.y - GRID.title.up * pitch, GRID.title.left, GRID.title.width, GRID.title.halfHeight),
    bannerBox: () => centred(teamOne.y - GRID.banner.up * pitch, GRID.banner.left, GRID.banner.width, GRID.banner.halfHeight),
  };
}

module.exports = { GRID, LayoutError, PLAYERS_PER_TEAM, layoutFromHeaders };
