// Runs the native `tesseract` program on an in-memory image.
//
// A fresh process per call (no daemon), the PNG piped to its stdin and the
// result read from stdout, so nothing is written to disk. OpenMP is limited to
// one thread so a read can't take every core of a small shared host; the
// caller serialises jobs (see screenshot-import.js). Set TESSERACT_BIN to use a
// binary that isn't on PATH.

const { spawn } = require("node:child_process");

class OcrError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// Resolves to an array of words: { text, x, y, w, h, conf } with pixel boxes in
// the coordinates of the image that was sent.
function runTesseract(png, { psm = 6, whitelist = null, timeoutMs = 20000, bin = process.env.TESSERACT_BIN || "tesseract" } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["stdin", "stdout", "--psm", String(psm)];
    if (whitelist) args.push("-c", `tessedit_char_whitelist=${whitelist}`);
    args.push("tsv");

    const child = spawn(bin, args, {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    });
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new OcrError("Reading the screenshot took too long.", "timeout"));
    }, timeoutMs);

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        finish(new OcrError("Screenshot reading isn't set up on this server (the tesseract program is missing).", "unavailable"));
      } else {
        finish(new OcrError("Could not run the text reader.", "failed"));
      }
    });
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new OcrError("The text reader produced too much output.", "failed"));
      } else {
        chunks.push(chunk);
      }
    });
    child.stdin.on("error", () => {}); // a killed process closes the pipe under us
    child.on("close", (code) => {
      if (code !== 0) finish(new OcrError("The text reader failed.", "failed"));
      else finish(null, parseTsv(Buffer.concat(chunks).toString("utf8")));
    });
    child.stdin.end(png);
  });
}

// Tesseract's TSV output: a header row, then one row per element. Level 5 rows
// are words.
function parseTsv(text) {
  const words = [];
  for (const line of text.split("\n").slice(1)) {
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

// When several crops are stacked into one tall image (one per "line"), share
// the words out to the line whose centre they're nearest, left to right.
// Returns one { text, conf } per centre; empty lines give { text: "", conf: null }.
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

module.exports = { OcrError, parseTsv, runTesseract, wordsToLines };
