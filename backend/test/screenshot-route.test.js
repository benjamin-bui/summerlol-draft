const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createEditorRouter } = require("../src/lib/editor-routes");
const { ScreenshotError } = require("../src/lib/screenshot-import");

// Starts the editor router on a random port with a fake editor check and a
// stand-in screenshot service; returns { url, calls, close }.
async function start({ screenshots, allow = true } = {}) {
  const calls = { editorChecks: 0 };
  const app = express();
  app.use(
    createEditorRouter({
      db: {},
      loadIdentityMap: () => new Map(),
      screenshots,
      requireEditor: (req, res, next) => {
        calls.editorChecks += 1;
        if (!allow) return res.status(401).json({ error: "Sign in required" });
        req.editor = { sub: "tester", email: "tester@example.com" };
        return next();
      },
    }),
  );
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/api/editor/screenshot-parse`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const png = Buffer.from("89504e470d0a1a0a", "hex"); // content is irrelevant: the service is stubbed

test("a screenshot is passed to the service as raw bytes and its result is returned", async () => {
  const seen = [];
  const summary = { source: "screenshot", players: [] };
  const harness = await start({ screenshots: { parse: async (buffer) => (seen.push(buffer), summary) } });
  try {
    const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), summary);
    assert.equal(seen.length, 1);
    assert.ok(Buffer.isBuffer(seen[0]));
    assert.deepEqual(seen[0], png);
    assert.equal(harness.calls.editorChecks, 1);
  } finally {
    await harness.close();
  }
});

test("JPEG and WebP are accepted too", async () => {
  const harness = await start({ screenshots: { parse: async () => ({ ok: true }) } });
  try {
    for (const type of ["image/jpeg", "image/webp"]) {
      const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": type }, body: png });
      assert.equal(response.status, 200, type);
    }
  } finally {
    await harness.close();
  }
});

test("only editors can use it, and the check runs before anything is read", async () => {
  let parsed = false;
  const harness = await start({ allow: false, screenshots: { parse: async () => ((parsed = true), {}) } });
  try {
    const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(response.status, 401);
    assert.equal(parsed, false);
  } finally {
    await harness.close();
  }
});

test("a body that isn't an image (or is empty) is refused with 415", async () => {
  let parsed = false;
  const harness = await start({ screenshots: { parse: async () => ((parsed = true), {}) } });
  try {
    for (const [type, body] of [["application/json", JSON.stringify({ image: "x" })], ["text/plain", "hello"], ["image/png", ""], ["image/gif", png]]) {
      const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": type }, body });
      assert.equal(response.status, 415, type);
      assert.match((await response.json()).error, /PNG, JPEG or WebP/);
    }
    assert.equal(parsed, false);
  } finally {
    await harness.close();
  }
});

test("an image over 8 MB is refused before it is read", async () => {
  let parsed = false;
  const harness = await start({ screenshots: { parse: async () => ((parsed = true), {}) } });
  try {
    const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.alloc(9 * 1024 * 1024) });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /8 MB/);
    assert.equal(parsed, false);
  } finally {
    await harness.close();
  }
});

test("no more than two screenshot requests can be read or queued at once", async () => {
  let entered = 0;
  let release;
  let bothEntered;
  const secondRequestStarted = new Promise((resolve) => {
    bothEntered = resolve;
  });
  const serviceResult = new Promise((resolve) => {
    release = resolve;
  });
  const harness = await start({
    screenshots: {
      parse: () => {
        entered += 1;
        if (entered === 2) bothEntered();
        return serviceResult;
      },
    },
  });
  try {
    const request = () => fetch(harness.url, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    const first = request();
    const second = request();
    await secondRequestStarted;

    const third = await request();
    assert.equal(third.status, 429);
    assert.deepEqual(await third.json(), {
      error: "Another screenshot is being read. Try again in a few seconds.",
      code: "busy",
    });
    assert.equal(entered, 2);

    release({ ok: true });
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
  } finally {
    release({ ok: true });
    await harness.close();
  }
});

test("reading problems come back as a status and message the editor can act on", async () => {
  const cases = [
    [new ScreenshotError("Couldn't find the scoreboard.", "no-scoreboard", 422), 422, "no-scoreboard"],
    [new ScreenshotError("Another screenshot is being read.", "busy", 429), 429, "busy"],
    [new ScreenshotError("Not set up.", "ocr-unavailable", 503), 503, "ocr-unavailable"],
  ];
  for (const [error, status, code] of cases) {
    const harness = await start({ screenshots: { parse: async () => Promise.reject(error) } });
    try {
      const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: error.message, code });
    } finally {
      await harness.close();
    }
  }
});

test("an unexpected failure is a plain 500 that doesn't leak internals", async () => {
  const log = console.error;
  console.error = () => {};
  const harness = await start({ screenshots: { parse: async () => Promise.reject(new Error("secret path /srv/app/db.sqlite exploded")) } });
  try {
    const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Could not read that screenshot.");
    assert.ok(!JSON.stringify(body).includes("secret"));
  } finally {
    console.error = log;
    await harness.close();
  }
});

test("without a screenshot service the route says so (503) instead of failing", async () => {
  const harness = await start({ screenshots: undefined });
  try {
    const response = await fetch(harness.url, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(response.status, 503);
  } finally {
    await harness.close();
  }
});
