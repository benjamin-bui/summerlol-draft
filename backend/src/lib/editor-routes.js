// The editing API. Every route lives under /api/editor, and the very first
// thing mounted on that prefix is requireEditor -- so a route added here later
// is protected by default, and an anonymous request never reaches a handler
// (or even a body parser).

const express = require("express");
const { ScreenshotError } = require("./screenshot-import");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
  readMatchState,
  saveMatchEdit,
} = require("./match-detail-editor");
const {
  StructureNotFoundError,
  StructureValidationError,
  addGameToSeries,
  createSeries,
  readTournamentStructure,
  saveStages,
  updateGameRounds,
  updateGameStructure,
} = require("./tournament-structure");

// A screenshot is sent as the raw image body, not JSON.
const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const SCREENSHOT_LIMIT = "8mb";
const MAX_SCREENSHOT_REQUESTS = 2;

// `screenshots` (optional) reads a scoreboard screenshot; see
// screenshot-import.js. Without it the screenshot route answers 503.
function createEditorRouter({ db, requireEditor, loadIdentityMap, screenshots }) {
  const router = express.Router();
  const prefix = "/api/editor";

  router.use(prefix, requireEditor);
  router.use(prefix, express.json({ limit: "64kb" }));

  const identities = () => loadIdentityMap(db);
  let screenshotRequests = 0;

  router.get(`${prefix}/matches/:matchKey`, (req, res) => {
    try {
      res.json(readMatchState(db, req.params.matchKey, identities()));
    } catch (error) {
      sendError(res, error, db, req.params.matchKey, identities);
    }
  });

  router.put(`${prefix}/matches/:matchKey`, (req, res) => {
    try {
      const state = saveMatchEdit(db, req.params.matchKey, req.body, req.editor, identities());
      console.log(`[editor] ${req.editor.sub} updated ${req.params.matchKey}`);
      res.json(state);
    } catch (error) {
      sendError(res, error, db, req.params.matchKey, identities);
    }
  });

  // Reads a screenshot of the post-game scoreboard into a match summary (the
  // same shape as a parsed replay). Processing happens in memory and the image
  // is never stored.
  const readScreenshotBody = express.raw({ type: SCREENSHOT_TYPES, limit: SCREENSHOT_LIMIT });
  function admitScreenshotRequest(req, res, next) {
    if (!screenshots) {
      return res.status(503).json({ error: "Screenshot reading isn't enabled on this server." });
    }
    if (screenshotRequests >= MAX_SCREENSHOT_REQUESTS) {
      return res.status(429).json({ error: "Another screenshot is being read. Try again in a few seconds.", code: "busy" });
    }

    screenshotRequests += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      screenshotRequests -= 1;
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  }

  router.post(
    `${prefix}/screenshot-parse`,
    admitScreenshotRequest,
    (req, res, next) =>
      readScreenshotBody(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.type === "entity.too.large";
        return res.status(tooLarge ? 413 : 400).json({
          error: tooLarge ? "That image is larger than 8 MB." : "Could not read the upload.",
        });
      }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(415).json({ error: "Send the screenshot as a PNG, JPEG or WebP image." });
      }
      try {
        return res.json(await screenshots.parse(req.body));
      } catch (error) {
        if (error instanceof ScreenshotError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("[screenshot]", error);
        return res.status(500).json({ error: "Could not read that screenshot." });
      }
    },
  );

  router.get(`${prefix}/tournaments/:year/:tournament/structure`, (req, res) => {
    try {
      res.json(
        readTournamentStructure(
          db,
          Number(req.params.year),
          req.params.tournament,
        ),
      );
    } catch (error) {
      sendStructureError(res, error);
    }
  });

  router.put(`${prefix}/tournaments/:year/:tournament/stages`, (req, res) => {
    try {
      res.json(
        saveStages(
          db,
          Number(req.params.year),
          req.params.tournament,
          req.body,
          req.editor,
        ),
      );
    } catch (error) {
      sendStructureError(res, error);
    }
  });

  router.post(`${prefix}/tournaments/:year/:tournament/series`, (req, res) => {
    try {
      res.status(201).json(
        createSeries(
          db,
          Number(req.params.year),
          req.params.tournament,
          req.body,
          req.editor,
        ),
      );
    } catch (error) {
      sendStructureError(res, error);
    }
  });

  router.put(`${prefix}/tournaments/:year/:tournament/games`, (req, res) => {
    try {
      res.json(
        updateGameStructure(
          db,
          Number(req.params.year),
          req.params.tournament,
          req.body,
          req.editor,
        ),
      );
    } catch (error) {
      sendStructureError(res, error);
    }
  });

  router.put(`${prefix}/tournaments/:year/:tournament/rounds`, (req, res) => {
    try {
      res.json(
        updateGameRounds(
          db,
          Number(req.params.year),
          req.params.tournament,
          req.body,
          req.editor,
        ),
      );
    } catch (error) {
      sendStructureError(res, error);
    }
  });

  router.post(`${prefix}/tournaments/:year/:tournament/series/:seriesId/games`, (req, res) => {
    try {
      res.status(201).json(
        addGameToSeries(
          db,
          Number(req.params.year),
          req.params.tournament,
          req.params.seriesId,
          req.body,
          req.editor,
        ),
      );
    } catch (error) {
      sendStructureError(res, error);
    }
  });

  // Anything else under the prefix: an authenticated 404, never the SPA shell.
  router.use(prefix, (req, res) => res.status(404).json({ error: "Not found" }));

  // Malformed JSON and the like -- still JSON, still no stack traces.
  // eslint-disable-next-line no-unused-vars
  router.use(prefix, (error, req, res, next) => {
    const status = error.status === 413 ? 413 : 400;
    res.status(status).json({ error: status === 413 ? "Request too large" : "Invalid request" });
  });

  return router;
}

function sendError(res, error, db, matchKey, identities) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message, problems: error.problems });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  if (error instanceof ConflictError) {
    // Include the current state so the UI can reload it in one round trip.
    return res.status(409).json({
      error: error.message,
      current: readMatchState(db, matchKey, identities()),
    });
  }
  console.error("[editor] unexpected error:", error);
  return res.status(500).json({ error: "Could not save match details" });
}

function sendStructureError(res, error) {
  if (error instanceof StructureValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof StructureNotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  console.error("[editor] unexpected tournament structure error:", error);
  return res.status(500).json({ error: "Could not update tournament structure" });
}

module.exports = { createEditorRouter };
