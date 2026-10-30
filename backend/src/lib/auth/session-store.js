// Server-side sessions in SQLite. The browser only ever holds an opaque random
// id; the database stores a SHA-256 of it, so a leaked database file can't be
// replayed as live sessions. Nothing about the user is trusted from the cookie.

const crypto = require("crypto");

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

const MAX_PENDING_LOGINS = 500;

function ensureAuthSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id_hash TEXT PRIMARY KEY,
      sub TEXT NOT NULL,
      claims_json TEXT NOT NULL,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_login_states (
      id_hash TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      nonce TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      return_to TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

function createSessionStore(db, { now = () => Date.now() } = {}) {
  ensureAuthSchema(db);
  const nowSec = () => Math.floor(now() / 1000);

  const purgeExpired = () => {
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(nowSec());
    db.prepare("DELETE FROM auth_login_states WHERE expires_at <= ?").run(nowSec());
  };

  return {
    purgeExpired,

    createSession(claims, ttlSeconds) {
      const id = randomToken();
      const csrfToken = randomToken();
      const created = nowSec();
      db.prepare(
        `INSERT INTO auth_sessions (id_hash, sub, claims_json, csrf_token, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(sha256(id), claims.sub, JSON.stringify(claims), csrfToken, created, created + ttlSeconds);
      return { id, csrfToken };
    },

    getSession(id) {
      if (typeof id !== "string" || id.length < 20 || id.length > 200) return null;
      const row = db
        .prepare("SELECT * FROM auth_sessions WHERE id_hash = ?")
        .get(sha256(id));
      if (!row) return null;
      if (row.expires_at <= nowSec()) {
        db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(row.id_hash);
        return null;
      }
      return {
        claims: JSON.parse(row.claims_json),
        csrfToken: row.csrf_token,
        expiresAt: row.expires_at,
      };
    },

    destroySession(id) {
      if (typeof id !== "string") return;
      db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(sha256(id));
    },

    // Login state is single-use: it is deleted the moment it is read.
    createLoginState({ state, nonce, codeVerifier, returnTo }, ttlSeconds = 600) {
      const id = randomToken();
      db.transaction(() => {
        purgeExpiredLoginStates();
        const { n } = db.prepare("SELECT COUNT(*) AS n FROM auth_login_states").get();
        if (n >= MAX_PENDING_LOGINS) {
          db.prepare(
            `DELETE FROM auth_login_states WHERE id_hash IN
               (SELECT id_hash FROM auth_login_states ORDER BY expires_at LIMIT ?)`,
          ).run(n - MAX_PENDING_LOGINS + 1);
        }
        db.prepare(
          `INSERT INTO auth_login_states (id_hash, state, nonce, code_verifier, return_to, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(sha256(id), state, nonce, codeVerifier, returnTo, nowSec() + ttlSeconds);
      })();
      return id;
    },

    consumeLoginState(id) {
      if (typeof id !== "string" || id.length < 20 || id.length > 200) return null;
      const hash = sha256(id);
      const row = db.prepare("SELECT * FROM auth_login_states WHERE id_hash = ?").get(hash);
      if (!row) return null;
      db.prepare("DELETE FROM auth_login_states WHERE id_hash = ?").run(hash);
      if (row.expires_at <= nowSec()) return null;
      return {
        state: row.state,
        nonce: row.nonce,
        codeVerifier: row.code_verifier,
        returnTo: row.return_to,
      };
    },
  };

  function purgeExpiredLoginStates() {
    db.prepare("DELETE FROM auth_login_states WHERE expires_at <= ?").run(nowSec());
  }
}

module.exports = { createSessionStore, ensureAuthSchema, randomToken };
