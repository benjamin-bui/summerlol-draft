// Recognises champion portraits in a scoreboard screenshot by comparing each
// one with the champion icons the site already ships (public/icons/champions).
//
// Each portrait and each icon is reduced to a small colour thumbnail, brightness
// removed, and compared by correlation. The client draws the icon at an
// unknown zoom inside a circle, so every icon is compared at several crops of
// its centre and the best one counts. Tuned on two real screenshots (1029px and
// 2092px wide): every portrait it was confident about was right, including at
// low resolution. Skins are the weak spot, since only default-skin icons are
// stored; those come out with a low margin and are flagged for the editor to
// check, which is what the `confident` flag is for.

const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const SIZE = 12; // thumbnail side, px
const ICON_ZOOMS = [0.5, 0.58, 0.66, 0.74, 0.82, 0.9]; // fraction of the icon's width kept
const QUERY_FRACTION = 0.62; // share of the portrait's inner square compared
const RING_INSET = 0.9; // the portrait circle's border ring is outside this
const OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]; // px nudges to absorb layout rounding
const CONFIDENT_SCORE = 0.75;
const CONFIDENT_MARGIN = 0.1;
const KEEP = 8;

// Brightness and colour cast removed, scaled to unit length: two thumbnails
// then compare by a plain dot product (1 = same picture).
function descriptor(rgb) {
  const count = rgb.length / 3;
  const mean = [0, 0, 0];
  for (let i = 0; i < count; i += 1) for (let c = 0; c < 3; c += 1) mean[c] += rgb[i * 3 + c];
  for (let c = 0; c < 3; c += 1) mean[c] /= count;
  const out = new Float32Array(rgb.length);
  let norm = 0;
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgb[i * 3 + c] - mean[c];
      out[i * 3 + c] = value;
      norm += value * value;
    }
  }
  norm = Math.sqrt(norm) + 1e-6;
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

async function thumbnail(raw, box) {
  const { data } = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } })
    .extract(box)
    .resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return descriptor(data);
}

class ChampionMatcher {
  constructor({ iconsDir }) {
    this.iconsDir = iconsDir;
    this.loading = null;
    this.keys = [];
    this.refs = [];
  }

  // Reads and reduces the icons once; later calls reuse the result.
  ready() {
    if (!this.loading) {
      this.loading = this.load().catch((error) => {
        this.loading = null; // try again next time rather than caching a failure
        throw error;
      });
    }
    return this.loading;
  }

  async load() {
    const files = fs.readdirSync(this.iconsDir).filter((file) => file.toLowerCase().endsWith(".png")).sort();
    if (!files.length) throw new Error(`No champion icons found in ${this.iconsDir}`);
    const keys = [];
    const refs = [];
    for (const file of files) {
      const { data, info } = await sharp(path.join(this.iconsDir, file))
        .removeAlpha()
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
      const raw = { data, width: info.width, height: info.height };
      const thumbs = [];
      for (const zoom of ICON_ZOOMS) {
        const margin = Math.round((info.width * (1 - zoom)) / 2);
        const side = info.width - 2 * margin;
        thumbs.push(await thumbnail(raw, { left: margin, top: margin, width: side, height: side }));
      }
      keys.push(path.basename(file, path.extname(file)));
      refs.push(thumbs);
    }
    this.keys = keys;
    this.refs = refs;
  }

  // rgb: { data, width, height } with 3 channels. circle: { cx, cy, radius } of
  // one portrait. Returns the best matches, highest first: [{ key, score }].
  async rank(rgb, circle) {
    await this.ready();
    const half = (2 * circle.radius * RING_INSET * QUERY_FRACTION) / 2;
    const side = Math.max(4, Math.round(2 * half));
    const best = new Float32Array(this.keys.length).fill(-1);
    for (const [ox, oy] of OFFSETS) {
      const left = Math.min(Math.max(0, Math.round(circle.cx + ox - half)), rgb.width - side);
      const top = Math.min(Math.max(0, Math.round(circle.cy + oy - half)), rgb.height - side);
      if (side > rgb.width || side > rgb.height) continue;
      const query = await thumbnail(rgb, { left, top, width: side, height: side });
      for (let i = 0; i < this.keys.length; i += 1) {
        for (const ref of this.refs[i]) {
          const score = dot(ref, query);
          if (score > best[i]) best[i] = score;
        }
      }
    }
    return Array.from(best.keys())
      .sort((a, b) => best[b] - best[a])
      .slice(0, KEEP)
      .map((index) => ({ key: this.keys[index], score: Math.round(best[index] * 1000) / 1000 }));
  }
}

// rankings: one list per player (best first, as from rank()). Picks a champion
// for each so that no two players share one (a draft never repeats a champion):
// the strongest matches choose first, and a player whose best is taken falls to
// their next. `confident` is only true for a player's own top match that is both
// strong and clear of the runner-up.
function assignDistinct(rankings, { minScore = CONFIDENT_SCORE, minMargin = CONFIDENT_MARGIN } = {}) {
  const candidates = [];
  rankings.forEach((list, player) => {
    list.slice(0, 6).forEach((entry, rank) => candidates.push({ player, rank, ...entry }));
  });
  candidates.sort((a, b) => b.score - a.score || a.rank - b.rank);
  const chosen = new Array(rankings.length).fill(null);
  const taken = new Set();
  for (const candidate of candidates) {
    if (chosen[candidate.player] || taken.has(candidate.key)) continue;
    chosen[candidate.player] = candidate;
    taken.add(candidate.key);
  }
  return rankings.map((list, player) => {
    const pick = chosen[player] || { ...list[0], rank: 0 };
    const margin = list.length > 1 ? list[0].score - list[1].score : list[0].score;
    const confident = pick.rank === 0 && list[0].score >= minScore && margin >= minMargin;
    const choices = [pick, ...list.filter((entry) => entry.key !== pick.key)]
      .slice(0, 5)
      .map(({ key, score }) => ({ key, score }));
    return { key: pick.key, score: pick.score, confident, choices };
  });
}

module.exports = { CONFIDENT_MARGIN, CONFIDENT_SCORE, ChampionMatcher, assignDistinct, descriptor };
