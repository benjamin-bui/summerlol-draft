import championKeys from "virtual:champion-icon-keys";

const SIZE = 12;
const ICON_ZOOMS = [0.5, 0.58, 0.66, 0.74, 0.82, 0.9];
const QUERY_FRACTION = 0.62;
const RING_INSET = 0.9;
const OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const CONFIDENT_SCORE = 0.75;
const CONFIDENT_MARGIN = 0.1;
const KEEP = 8;

function descriptor(rgba) {
  const count = rgba.length / 4;
  const mean = [0, 0, 0];
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < 3; c += 1) mean[c] += rgba[i * 4 + c];
  }
  for (let c = 0; c < 3; c += 1) mean[c] /= count;
  const out = new Float32Array(count * 3);
  let norm = 0;
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      const value = rgba[i * 4 + c] - mean[c];
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

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function thumbnail(source, box) {
  const canvas = createCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, box.left, box.top, box.width, box.height, 0, 0, SIZE, SIZE);
  return descriptor(context.getImageData(0, 0, SIZE, SIZE).data);
}

function loadIcon(key) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load champion icon "${key}".`));
    image.src = `/icons/champions/${key}.png`;
  });
}

class ChampionMatcher {
  constructor() {
    this.loading = null;
    this.keys = [];
    this.refs = [];
  }

  ready() {
    if (!this.loading) {
      this.loading = this.load().catch((error) => {
        this.loading = null;
        throw error;
      });
    }
    return this.loading;
  }

  async load() {
    if (!championKeys.length) throw new Error("No champion portraits are available for screenshot matching.");
    const refs = await Promise.all(championKeys.map(async (key) => {
      const image = await loadIcon(key);
      const thumbs = [];
      for (const zoom of ICON_ZOOMS) {
        const margin = Math.round((image.naturalWidth * (1 - zoom)) / 2);
        const side = image.naturalWidth - 2 * margin;
        thumbs.push(thumbnail(image, { left: margin, top: margin, width: side, height: side }));
      }
      return thumbs;
    }));
    this.keys = championKeys;
    this.refs = refs;
  }

  async rank(raw, circle) {
    await this.ready();
    const source = raw.canvas;

    const half = (2 * circle.radius * RING_INSET * QUERY_FRACTION) / 2;
    const side = Math.max(4, Math.round(2 * half));
    const best = new Float32Array(this.keys.length).fill(-1);
    for (const [ox, oy] of OFFSETS) {
      if (side > raw.width || side > raw.height) continue;
      const left = Math.min(Math.max(0, Math.round(circle.cx + ox - half)), raw.width - side);
      const top = Math.min(Math.max(0, Math.round(circle.cy + oy - half)), raw.height - side);
      const query = thumbnail(source, { left, top, width: side, height: side });
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

export function assignDistinct(rankings, { minScore = CONFIDENT_SCORE, minMargin = CONFIDENT_MARGIN } = {}) {
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

export const championMatcher = new ChampionMatcher();
