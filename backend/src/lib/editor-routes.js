// The editing API. Every route lives under /api/editor, and the very first
// thing mounted on that prefix is requireEditor -- so a route added here later
// is protected by default, and an anonymous request never reaches a handler
// (or even a body parser).

const express = require("express");
const {
  ConflictError,
  NotFoundError,
  ValidationError,
  readMatchState,
  saveMatchEdit,
} = require("./match-detail-editor");

function createEditorRouter({ db, requireEditor, loadIdentityMap }) {
  const router = express.Router();
  const prefix = "/api/editor";

  router.use(prefix, requireEditor);
  router.use(prefix, express.json({ limit: "64kb" }));

  const identities = () => loadIdentityMap(db);

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

module.exports = { createEditorRouter };
