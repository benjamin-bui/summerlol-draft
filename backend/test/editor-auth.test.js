// End-to-end tests for OIDC login and the match editor, against a real
// openid-client talking to a small in-process identity provider. The point of
// most of these is the negative case: who must be kept OUT.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const Database = require("better-sqlite3");
const { loadAuthConfig, isAuthorizedEditor } = require("../src/lib/auth/config");
const { createAuth, safeReturnTo } = require("../src/lib/auth/oidc-auth");
const { createEditorRouter } = require("../src/lib/editor-routes");
const { ensureMatchDetailsSchema } = require("../src/lib/match-details-schema");

const CLIENT_ID = "summerlol";
const CLIENT_SECRET = "shh";
const MATCH_KEY = "match-2026-summer-groups-1-cap1-cap2";

const silentLogger = { log() {}, warn() {}, error() {} };
const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(resolve));

// ---- a tiny OIDC provider -------------------------------------------------------
async function startIdp() {
  const jose = await import("jose");
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const jwk = { ...(await jose.exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map(); // code -> { claims, nonce, challenge, userinfo }
  const tokens = new Map(); // access token -> { claims, userinfo }
  const server = http.createServer(async (req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, base);
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
        userinfo_endpoint: `${base}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.pathname === "/jwks") return send(200, { keys: [jwk] });
    if (url.pathname === "/userinfo") {
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      const entry = tokens.get(token);
      return entry ? send(200, { sub: entry.claims.sub, ...entry.userinfo }) : send(401, {});
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const entry = codes.get(form.get("code"));
      const verifier = form.get("code_verifier") || "";
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      if (!entry || form.get("client_secret") !== CLIENT_SECRET || challenge !== entry.challenge) {
        return send(400, { error: "invalid_grant" });
      }
      codes.delete(form.get("code"));
      tokens.set(entry.accessToken, entry);
      const idToken = await new jose.SignJWT({ ...entry.claims, nonce: entry.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(base)
        .setAudience(CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return send(200, { access_token: entry.accessToken, token_type: "Bearer", id_token: idToken, expires_in: 300 });
    }
    return send(404, {});
  });
  const port = await listen(server);
  return {
    issuer: `http://127.0.0.1:${port}`,
    close: () => close(server),
    // What the provider does when the browser lands on /authorize and the
    // person approves: remember who they are and hand back a code.
    approve(authorizeUrl, claims, userinfo = {}) {
      const params = new URL(authorizeUrl).searchParams;
      const code = crypto.randomBytes(8).toString("hex");
      codes.set(code, {
        claims,
        userinfo,
        nonce: params.get("nonce"),
        challenge: params.get("code_challenge"),
        accessToken: `at-${code}`,
      });
      return { code, state: params.get("state") };
    },
  };
}

// ---- the app under test -----------------------------------------------------------
function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE rows ("Tournament" TEXT, "Year" TEXT, "Captain" TEXT, "Player" TEXT, "Pick Order" TEXT, "Rank" TEXT);
    CREATE TABLE matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, tournament TEXT,
      team1 TEXT NOT NULL, team2 TEXT NOT NULL, result TEXT NOT NULL,
      csv_row_index INTEGER NOT NULL, match_order INTEGER NOT NULL, match_stage TEXT,
      match_key TEXT NOT NULL UNIQUE
    );
  `);
  ensureMatchDetailsSchema(db);
  const addRow = db.prepare(`INSERT INTO rows VALUES ('Summer', '2026', ?, ?, '1', '1')`);
  addRow.run("Cap1", "A1");
  addRow.run("Cap1", "A2");
  addRow.run("Cap2", "B1");
  addRow.run("Cap2", "B2");
  db.prepare(
    `INSERT INTO matches (year, tournament, team1, team2, result, csv_row_index, match_order, match_stage, match_key)
     VALUES (2026, 'Summer', 'Cap1', 'Cap2', 'Cap1', 0, 1, 'Groups', ?)`,
  ).run(MATCH_KEY);
  db.prepare(
    `INSERT INTO match_details (match_key, player, champion, kills, deaths, assists, role)
     VALUES (?, 'A1', 'Ahri', 1, 2, 3, 'Mid')`,
  ).run(MATCH_KEY);
  db.prepare("INSERT INTO match_bans (match_key, side, champion) VALUES (?, 2, 'Zed')").run(MATCH_KEY);
  return db;
}

async function startApp(idp, envOverrides = {}, { now } = {}) {
  const db = makeDb();
  const server = http.createServer();
  const port = await listen(server);
  const publicUrl = `http://127.0.0.1:${port}`;
  const config = loadAuthConfig({
    PUBLIC_URL: publicUrl,
    OIDC_ISSUER: idp.issuer,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_ALLOW_INSECURE_HTTP: "true",
    OIDC_EDITOR_EMAILS: "editor@example.com",
    ...envOverrides,
  });
  const auth = createAuth({ config, db, logger: silentLogger, now });
  const app = express();
  app.use(auth.router);
  app.use(createEditorRouter({ db, requireEditor: auth.requireEditor, loadIdentityMap: () => new Map() }));
  // Stand-in for the SPA fallback / static site: anything else is public.
  app.get("*", (req, res) => res.send("public"));
  server.on("request", app);
  return { db, publicUrl, config, close: () => close(server) };
}

// A minimal browser: keeps cookies, never follows redirects on its own.
function makeBrowser(publicUrl) {
  const jar = new Map();
  const absorb = (response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  return {
    jar,
    async request(path, { method = "GET", headers = {}, body } = {}) {
      const response = await fetch(new URL(path, publicUrl), {
        method,
        redirect: "manual",
        headers: { ...(jar.size ? { Cookie: cookieHeader() } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      absorb(response);
      return response;
    },
    // Full sign-in: our /auth/login -> provider -> our /auth/callback.
    async signIn(idp, claims, userinfo) {
      const start = await this.request("/auth/login");
      assert.equal(start.status, 302);
      const { code, state } = idp.approve(start.headers.get("location"), claims, userinfo);
      return this.request(`/auth/callback?code=${code}&state=${state}`);
    },
    async me() {
      return (await this.request("/api/auth/me")).json();
    },
  };
}

const editorClaims = { sub: "user-1", name: "Eddie", email: "editor@example.com", email_verified: true };
const validBody = (rev, extra = {}) => ({
  baseRev: rev,
  players: [
    { player: "A1", champion: "Ahri", kills: 5, deaths: 1, assists: 7, role: "Mid" },
    { player: "B1", champion: "Zed", kills: 2, deaths: 3, assists: 4, role: "mid" },
  ],
  bans: { team1: ["Yasuo"], team2: ["Zed", "zed", "Lux"] },
  ...extra,
});
const sameOriginHeaders = (app, csrf) => ({
  "Content-Type": "application/json",
  Origin: app.publicUrl,
  "X-CSRF-Token": csrf,
});
const dump = (db) =>
  JSON.stringify([
    db.prepare("SELECT player, champion, kills, deaths, assists, role FROM match_details ORDER BY id").all(),
    db.prepare("SELECT side, champion FROM match_bans ORDER BY id").all(),
    db.prepare("SELECT COUNT(*) AS n FROM match_detail_audit").get(),
  ]);

// ---- tests ---------------------------------------------------------------------
test("anonymous visitors are refused by every editing route and nothing changes", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  const browser = makeBrowser(app.publicUrl);
  const before = dump(app.db);

  for (const [method, body] of [["GET"], ["PUT", validBody("x")], ["DELETE"], ["POST", {}]]) {
    const res = await browser.request(`/api/editor/matches/${MATCH_KEY}`, {
      method,
      body,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(res.status, 401, `${method} must be 401`);
    assert.deepEqual(await res.json(), { error: "Sign in required" });
  }
  assert.equal((await browser.request("/api/editor/anything-else")).status, 401);
  assert.equal(dump(app.db), before);
  assert.deepEqual(await browser.me(), {
    enabled: true, authenticated: false, canEdit: false, user: null, csrfToken: null,
  });
});

test("forged or junk session cookies do not authenticate", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  for (const cookie of ["sl_session=abc", `sl_session=${"a".repeat(43)}`, "sl_session=", "sl_session=' OR 1=1 --"]) {
    const res = await fetch(`${app.publicUrl}/api/editor/matches/${MATCH_KEY}`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 401, cookie);
  }
});

test("with no OIDC settings, or no editor allowlist, editing is off for everyone", async (t) => {
  const idp = await startIdp();
  const noOidc = await startApp(idp, { OIDC_ISSUER: "", OIDC_CLIENT_ID: "" });
  const noRules = await startApp(idp, { OIDC_EDITOR_EMAILS: "" });
  t.after(async () => { await noOidc.close(); await noRules.close(); await idp.close(); });

  for (const app of [noOidc, noRules]) {
    const browser = makeBrowser(app.publicUrl);
    const res = await browser.request(`/api/editor/matches/${MATCH_KEY}`);
    assert.equal(res.status, 403);
    assert.equal((await browser.request("/auth/login")).status, 404);
    assert.equal((await browser.me()).enabled, false);
  }
  // Even an otherwise-valid sign-in cannot create a session without rules.
  const browser = makeBrowser(noRules.publicUrl);
  assert.equal((await browser.request("/auth/login")).status, 404);
  assert.equal(browser.jar.size, 0);
});

test("an authorized editor can sign in, load a match, and save changes", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  const browser = makeBrowser(app.publicUrl);

  const done = await browser.signIn(idp, editorClaims);
  assert.equal(done.status, 302);
  assert.equal(done.headers.get("location"), "/");
  const cookie = done.headers.getSetCookie().find((c) => c.startsWith("sl_session="));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  const me = await browser.me();
  assert.equal(me.authenticated, true);
  assert.equal(me.canEdit, true);
  assert.equal(me.user.email, "editor@example.com");

  const state = await (await browser.request(`/api/editor/matches/${MATCH_KEY}`)).json();
  assert.deepEqual(state.teams.map((t) => t.players.map((p) => p.displayName)), [["Cap1", "A1", "A2"], ["Cap2", "B1", "B2"]]);
  assert.equal(state.winnerSide, 1, "the recorded winner (Cap1) is team 1");
  assert.equal(state.teams[0].players[1].champion, "Ahri");
  assert.deepEqual(state.bans.team2.map((b) => b.champion), ["Zed"]);

  const save = await browser.request(`/api/editor/matches/${MATCH_KEY}`, {
    method: "PUT",
    headers: sameOriginHeaders(app, me.csrfToken),
    body: validBody(state.rev),
  });
  assert.equal(save.status, 200, JSON.stringify(await save.clone().json()));
  const saved = await save.json();
  assert.notEqual(saved.rev, state.rev);
  assert.deepEqual(saved.bans.team2.map((b) => b.champion), ["Zed", "Lux"], "duplicate ban collapsed");

  assert.deepEqual(
    app.db.prepare("SELECT player, champion, kills, role FROM match_details ORDER BY id").all(),
    [
      { player: "A1", champion: "Ahri", kills: 5, role: "Mid" },
      { player: "B1", champion: "Zed", kills: 2, role: "Mid" },
    ],
  );
  const audit = app.db.prepare("SELECT * FROM match_detail_audit").get();
  assert.equal(audit.edited_by_sub, "user-1");
  assert.match(audit.before_json, /"kills":1/);
  assert.match(audit.after_json, /"kills":5/);
  assert.equal(app.db.prepare("SELECT edited_by_sub FROM match_detail_edits WHERE match_key = ?").get(MATCH_KEY).edited_by_sub, "user-1");
});

test("signing in successfully is not enough: people off the allowlist get no session", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });

  const attempts = [
    { sub: "x1", email: "stranger@example.com", email_verified: true },
    // Right email, but the provider hasn't verified it -- must not count.
    { sub: "x2", email: "editor@example.com", email_verified: false },
    { sub: "x3", email: "editor@example.com" },
    // Right email in the wrong case/with spaces is the SAME address, though.
  ];
  for (const claims of attempts) {
    const browser = makeBrowser(app.publicUrl);
    const done = await browser.signIn(idp, claims);
    assert.equal(done.headers.get("location"), "/?login=denied", JSON.stringify(claims));
    assert.equal([...browser.jar.keys()].filter((k) => k.includes("session")).length, 0);
    assert.equal((await browser.request(`/api/editor/matches/${MATCH_KEY}`)).status, 401);
    assert.equal((await browser.me()).authenticated, false);
  }
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM auth_sessions").get().n, 0);
});

test("allowlists by subject and by group work, and a missing claim fetched from userinfo is honored", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp, {
    OIDC_EDITOR_EMAILS: "",
    OIDC_EDITOR_SUBS: "sub-allowed",
    OIDC_EDITOR_GROUPS: "match-editors",
  });
  t.after(async () => { await app.close(); await idp.close(); });

  const bySub = makeBrowser(app.publicUrl);
  await bySub.signIn(idp, { sub: "sub-allowed" });
  assert.equal((await bySub.me()).canEdit, true);

  const byGroup = makeBrowser(app.publicUrl);
  await byGroup.signIn(idp, { sub: "g1", groups: ["players", "match-editors"] });
  assert.equal((await byGroup.me()).canEdit, true);

  const byUserinfo = makeBrowser(app.publicUrl);
  await byUserinfo.signIn(idp, { sub: "g2" }, { groups: ["match-editors"] });
  assert.equal((await byUserinfo.me()).canEdit, true);

  const wrongGroup = makeBrowser(app.publicUrl);
  const refused = await wrongGroup.signIn(idp, { sub: "g3", groups: ["players"] }, { groups: ["players"] });
  assert.equal(refused.headers.get("location"), "/?login=denied");
  assert.equal((await wrongGroup.me()).authenticated, false);
});

test("a login callback with a wrong state, a replayed code, or no login cookie is rejected", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });

  // Wrong state (CSRF / mix-up): the browser holds a real login cookie.
  const a = makeBrowser(app.publicUrl);
  const start = await a.request("/auth/login");
  const { code } = idp.approve(start.headers.get("location"), editorClaims);
  const bad = await a.request(`/auth/callback?code=${code}&state=not-the-state`);
  assert.equal(bad.headers.get("location"), "/?login=failed");
  assert.equal((await a.me()).authenticated, false);

  // No login cookie at all (the attacker's link opened in the victim's browser).
  const b = makeBrowser(app.publicUrl);
  const start2 = await makeBrowser(app.publicUrl).request("/auth/login");
  const approved = idp.approve(start2.headers.get("location"), editorClaims);
  const stolen = await b.request(`/auth/callback?code=${approved.code}&state=${approved.state}`);
  assert.equal(stolen.headers.get("location"), "/?login=failed");
  assert.equal((await b.me()).authenticated, false);

  // A login attempt can be completed once only.
  const c = makeBrowser(app.publicUrl);
  const start3 = await c.request("/auth/login");
  const cookieCopy = new Map(c.jar);
  const ok = idp.approve(start3.headers.get("location"), editorClaims);
  assert.equal((await c.request(`/auth/callback?code=${ok.code}&state=${ok.state}`)).headers.get("location"), "/");
  for (const [k, v] of cookieCopy) c.jar.set(k, v); // replay the old login cookie
  const replay = await c.request(`/auth/callback?code=${ok.code}&state=${ok.state}`);
  assert.equal(replay.headers.get("location"), "/?login=failed");
});

test("writes need a valid CSRF token and a same-origin request", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  const browser = makeBrowser(app.publicUrl);
  await browser.signIn(idp, editorClaims);
  const { csrfToken } = await browser.me();
  const { rev } = await (await browser.request(`/api/editor/matches/${MATCH_KEY}`)).json();
  const before = dump(app.db);
  const put = (headers) =>
    browser.request(`/api/editor/matches/${MATCH_KEY}`, { method: "PUT", headers, body: validBody(rev) });

  assert.equal((await put({ "Content-Type": "application/json", Origin: app.publicUrl })).status, 403, "no token");
  assert.equal((await put({ ...sameOriginHeaders(app, "wrong"), })).status, 403, "wrong token");
  assert.equal((await put({ ...sameOriginHeaders(app, csrfToken), Origin: "https://evil.example" })).status, 403, "foreign origin");
  assert.equal((await put({ ...sameOriginHeaders(app, csrfToken), "Sec-Fetch-Site": "cross-site" })).status, 403, "cross-site fetch");
  assert.equal((await put({ ...sameOriginHeaders(app, csrfToken), "Content-Type": "text/plain" })).status, 400, "not JSON");
  assert.equal(dump(app.db), before, "nothing was written");
  assert.equal((await put(sameOriginHeaders(app, csrfToken))).status, 200);
});

test("saving without changing anything does not lock the match or write an audit entry", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  const browser = makeBrowser(app.publicUrl);
  await browser.signIn(idp, editorClaims);
  const { csrfToken } = await browser.me();
  const state = await (await browser.request(`/api/editor/matches/${MATCH_KEY}`)).json();
  const body = {
    baseRev: state.rev,
    players: state.teams.flatMap((team) => team.players).map(({ player, champion, kills, deaths, assists, role }) => ({ player, champion, kills, deaths, assists, role })),
    bans: { team1: state.bans.team1.map((b) => b.champion), team2: state.bans.team2.map((b) => b.champion) },
  };
  const res = await browser.request(`/api/editor/matches/${MATCH_KEY}`, { method: "PUT", headers: sameOriginHeaders(app, csrfToken), body });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rev, state.rev);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM match_detail_audit").get().n, 0);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM match_detail_edits").get().n, 0);
});

test("invalid edits are rejected with specific problems and change nothing", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  const browser = makeBrowser(app.publicUrl);
  await browser.signIn(idp, editorClaims);
  const { csrfToken } = await browser.me();
  const { rev } = await (await browser.request(`/api/editor/matches/${MATCH_KEY}`)).json();
  const before = dump(app.db);
  const send = (body) =>
    browser.request(`/api/editor/matches/${MATCH_KEY}`, { method: "PUT", headers: sameOriginHeaders(app, csrfToken), body });

  const cases = [
    ["a player from another match", { players: [{ player: "Stranger", champion: "Ahri" }] }, "not on either team"],
    ["the same player twice", { players: [{ player: "A1", champion: "Ahri" }, { player: "a1", champion: "Lux" }] }, "listed twice"],
    ["a bad role", { players: [{ player: "A1", role: "Carry" }] }, "Role must be one of"],
    ["two players in one role", { players: [{ player: "A1", role: "Top" }, { player: "A2", role: "top" }] }, "same team"],
    ["a negative stat", { players: [{ player: "A1", kills: -1 }] }, "whole number"],
    ["a huge stat", { players: [{ player: "A1", deaths: 1000 }] }, "whole number"],
    ["a fractional stat", { players: [{ player: "A1", assists: 1.5 }] }, "whole number"],
    ["markup in a champion", { players: [{ player: "A1", champion: "<img src=x onerror=1>" }] }, "not a valid champion"],
    ["six bans", { bans: { team1: ["A", "B", "C", "D", "E", "F"] } }, "at most 5"],
    ["bans that aren't a list", { bans: { team1: "Zed" } }, "must be a list"],
  ];
  for (const [label, partial, expected] of cases) {
    const res = await send({ ...validBody(rev), ...partial });
    assert.equal(res.status, 400, label);
    assert.match(JSON.stringify((await res.json()).problems), new RegExp(expected), label);
  }
  assert.equal((await send({ players: [] })).status, 400, "missing baseRev");
  assert.equal((await send("[]")).status, 400);
  assert.equal(dump(app.db), before, "nothing was written by any rejected edit");
  assert.equal((await browser.request(`/api/editor/matches/no-such-match`)).status, 404);
});

test("saving over someone else's newer edit is a conflict that returns the current state", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  const browser = makeBrowser(app.publicUrl);
  await browser.signIn(idp, editorClaims);
  const { csrfToken } = await browser.me();
  const { rev } = await (await browser.request(`/api/editor/matches/${MATCH_KEY}`)).json();
  const put = (baseRev) =>
    browser.request(`/api/editor/matches/${MATCH_KEY}`, { method: "PUT", headers: sameOriginHeaders(app, csrfToken), body: validBody(baseRev) });

  assert.equal((await put(rev)).status, 200);
  const stale = await put(rev); // second editor still holding the old rev
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.ok(body.current.rev && body.current.rev !== rev);
  assert.equal((await put(body.current.rev)).status, 200);
});

test("logout ends the session, and expired sessions stop working", async (t) => {
  const idp = await startIdp();
  let clock = Date.now();
  const app = await startApp(idp, { SESSION_TTL_HOURS: "1" }, { now: () => clock });
  t.after(async () => { await app.close(); await idp.close(); });

  const browser = makeBrowser(app.publicUrl);
  await browser.signIn(idp, editorClaims);
  const { csrfToken } = await browser.me();
  const noToken = await browser.request("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
  assert.equal(noToken.status, 403, "logout needs the CSRF token too");
  assert.equal((await browser.me()).authenticated, true);

  const stolenCookie = browser.jar.get("sl_session");
  const out = await browser.request("/auth/logout", { method: "POST", headers: sameOriginHeaders(app, csrfToken) });
  assert.equal(out.status, 200);
  assert.equal((await browser.me()).authenticated, false);
  const reuse = await fetch(`${app.publicUrl}/api/editor/matches/${MATCH_KEY}`, { headers: { Cookie: `sl_session=${stolenCookie}` } });
  assert.equal(reuse.status, 401, "a copied cookie is dead after logout");

  const other = makeBrowser(app.publicUrl);
  await other.signIn(idp, editorClaims);
  assert.equal((await other.me()).canEdit, true);
  clock += 61 * 60 * 1000;
  assert.equal((await other.me()).authenticated, false, "session expired after its TTL");
  assert.equal((await other.request(`/api/editor/matches/${MATCH_KEY}`)).status, 401);
});

test("removing someone from the allowlist locks out their still-live session", async (t) => {
  const idp = await startIdp();
  const first = await startApp(idp);
  t.after(async () => { await first.close(); await idp.close(); });
  const browser = makeBrowser(first.publicUrl);
  await browser.signIn(idp, editorClaims);
  assert.equal((await browser.me()).canEdit, true);

  // Same database, restarted with a different allowlist.
  const sessions = first.db.prepare("SELECT * FROM auth_sessions").all();
  const second = await startApp(idp, { OIDC_EDITOR_EMAILS: "someone-else@example.com" });
  t.after(() => second.close());
  const insert = second.db.prepare("INSERT INTO auth_sessions VALUES (@id_hash, @sub, @claims_json, @csrf_token, @created_at, @expires_at)");
  sessions.forEach((s) => insert.run(s));
  const reused = makeBrowser(second.publicUrl);
  reused.jar.set("sl_session", browser.jar.get("sl_session"));
  assert.equal((await reused.request(`/api/editor/matches/${MATCH_KEY}`)).status, 401);
});

test("read-only parts of the site stay public", async (t) => {
  const idp = await startIdp();
  const app = await startApp(idp);
  t.after(async () => { await app.close(); await idp.close(); });
  const res = await fetch(`${app.publicUrl}/api/raw-matches`);
  assert.equal(await res.text(), "public");
});

test("config: allowlist rules and defaults", () => {
  const config = loadAuthConfig({
    PUBLIC_URL: "https://draft.example.com/",
    OIDC_ISSUER: "https://id.example.com",
    OIDC_CLIENT_ID: "x",
    OIDC_EDITOR_EMAILS: " A@Example.com , b@example.com ",
    OIDC_EDITOR_GROUPS: "editors",
    OIDC_GROUPS_CLAIM: "roles",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.redirectUri, "https://draft.example.com/auth/callback");
  assert.equal(config.secureCookies, true);
  assert.equal(config.sessionTtlSeconds, 8 * 3600);

  assert.equal(isAuthorizedEditor({ sub: "1", email: "a@example.com", email_verified: true }, config), true);
  assert.equal(isAuthorizedEditor({ sub: "1", email: "a@example.com", email_verified: "true" }, config), false);
  assert.equal(isAuthorizedEditor({ sub: "1", roles: ["editors"] }, config), true);
  assert.equal(isAuthorizedEditor({ sub: "1", roles: "editors" }, config), true);
  assert.equal(isAuthorizedEditor({ sub: "1", groups: ["editors"] }, config), false, "wrong claim name");
  assert.equal(isAuthorizedEditor({ email: "a@example.com", email_verified: true }, config), false, "no subject");
  assert.equal(isAuthorizedEditor(null, config), false);

  const none = loadAuthConfig({ PUBLIC_URL: "https://x.example", OIDC_ISSUER: "https://i.example", OIDC_CLIENT_ID: "x" });
  assert.equal(none.hasEditorRules, false);
  assert.equal(isAuthorizedEditor({ sub: "1", email: "a@example.com", email_verified: true }, none), false);

  assert.equal(loadAuthConfig({}).enabled, false);
  const plainHttp = loadAuthConfig({ PUBLIC_URL: "https://x.example", OIDC_ISSUER: "http://i.example", OIDC_CLIENT_ID: "x" });
  assert.equal(plainHttp.enabled, false, "http issuer refused unless explicitly allowed");
});

test("safeReturnTo only allows paths on this site", () => {
  assert.equal(safeReturnTo("/?tab=matchdata"), "/?tab=matchdata");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined, ["/a"], "/a\r\nSet-Cookie: x=1", "/" + "a".repeat(600)]) {
    assert.equal(safeReturnTo(bad), "/", String(bad));
  }
});
