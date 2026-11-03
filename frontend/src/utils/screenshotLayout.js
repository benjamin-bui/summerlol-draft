const PLAYERS_PER_TEAM = 5;
const HEADER_GAP_IN_PITCHES = 6.17;
const HEADER_HEIGHT_RANGE = [0.15, 0.45];
const MIN_PITCH = 16;
const MAX_PITCH = 160;
const LOW_RES_PITCH = 26;
const GRID = {
  firstRowOffset: 1.06,
  portrait: { cx: 2.56, radius: 0.46 },
  name: { left: 3.15, width: 5.15, halfHeight: 0.36 },
  kda: [
    { left: 13.65, width: 1.1 },
    { left: 15.12, width: 0.7 },
    { left: 16.1, width: 1.4 },
  ],
  kdaHalfHeight: 0.34,
  totals: { left: 3.2, width: 3.7, halfHeight: 0.3 },
  title: { left: 3.1, width: 10, up: 3.29, halfHeight: 0.35 },
  banner: { left: 1.5, width: 4.2, up: 3.87, halfHeight: 0.5 },
  rightEdge: 17.5,
};

export class LayoutError extends Error {}

export function layoutFromHeaders(teamOne, teamTwo, image) {
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
    kdaStrip: (row) => centred(row.cy, GRID.kda[0].left - 0.1, GRID.rightEdge - GRID.kda[0].left, GRID.kdaHalfHeight + 0.04),
    totalsBox: (team) => centred(header(team).y, GRID.totals.left, GRID.totals.width, GRID.totals.halfHeight),
    titleBox: () => centred(teamOne.y - GRID.title.up * pitch, GRID.title.left, GRID.title.width, GRID.title.halfHeight),
    bannerBox: () => centred(teamOne.y - GRID.banner.up * pitch, GRID.banner.left, GRID.banner.width, GRID.banner.halfHeight),
  };
}
