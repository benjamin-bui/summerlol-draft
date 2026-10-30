// OpenID Connect login (authorization-code flow + PKCE) and the middleware
// that keeps everyone but authorized editors out of the editing API.
//
// Security model, in one place:
//   1. Signing in proves identity only. After the provider redirects back we
//      check the person against the editor allowlists (config.js). If they are
//      not on it, NO session is created -- they stay exactly as anonymous as
//      before.
//   2. Every editing route sits behind requireEditor(), which re-checks the
//      session AND the allowlist on every request, so removing someone from
//      the allowlist locks them out on the next restart even with a live cookie.
//   3. Anything that changes data also needs a per-session CSRF token and a
//      same-origin request, on top of SameSite=Lax cookies.
//   4. If OIDC isn't configured, or no editor rules exist, editing is simply off.
//
// openid-client is ESM-only, so it is loaded with import() on first use.

const crypto = require("crypto");
const express = require("express");
const { isAuthorizedEditor } = require("./config");
const { createSessionStore } = require("./session-store");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let oidcModule = null;
async function loadOidc() {
  oidcModule ??= await import("openid-client");
  return oidcModule;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

function serializeCookie(name, value, { maxAge, secure }) {
  return (
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` +
    (secure ? "; Secure" : "")
  );
}

// Only ever redirect back to a path on this site: never a full URL, never
// "//host", never a backslash trick browsers treat as a slash.
function safeReturnTo(value) {
  if (typeof value !== "string") return "/";
  if (value.length > 500 || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  return value;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createAuth({ config, db, logger = console, now }) {
  const store = createSessionStore(db, now ? { now } : undefined);
  const sessionCookie = config.secureCookies ? "__Host-sl_session" : "sl_session";
  const loginCookie = config.secureCookies ? "__Host-sl_login" : "sl_login";
  const cookieOptions = (maxAge) => ({ maxAge, secure: config.secureCookies });

  // Editing can only ever be on if login works AND someone is allowed to edit.
  const editingEnabled = config.enabled && config.hasEditorRules;

  // ---- provider discovery (lazy, retried on failure) ----------------------
  let discovered = null;
  let discovering = null;
  async function getProviderConfig() {
    if (discovered) return discovered;
    discovering ??= (async () => {
      const oidc = await loadOidc();
      const options = config.allowInsecureHttp
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined;
      const issuer = new URL(config.issuer);
      discovered = config.clientSecret
        ? await oidc.discovery(issuer, config.clientId, config.clientSecret, undefined, options)
        : await oidc.discovery(issuer, config.clientId, undefined, oidc.None(), options);
      return discovered;
    })().finally(() => {
      discovering = null;
    });
    return discovering;
  }

  // ---- sessions ------------------------------------------------------------
  // Returns the live session for a request, or null. A session whose owner is
  // no longer on the allowlist is destroyed on the spot.
  function resolveSession(req) {
    if (!config.enabled) return null;
    const id = parseCookies(req.headers.cookie)[sessionCookie];
    if (!id) return null;
    const session = store.getSession(id);
    if (!session) return null;
    if (!isAuthorizedEditor(session.claims, config)) {
      store.destroySession(id);
      return null;
    }
    return { id, ...session };
  }

  const publicUser = (claims) => ({
    name: claims.name || claims.email || "Editor",
    email: claims.email || null,
  });

  function deny(res, status, error) {
    res.set("Cache-Control", "no-store");
    return res.status(status).json({ error });
  }

  // Gate for every editing route. Order matters: cheapest/safest checks first,
  // and any doubt means "no".
  function requireEditor(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!editingEnabled) return deny(res, 403, "Editing is not enabled on this server");
    const session = resolveSession(req);
    if (!session) return deny(res, 401, "Sign in required");

    if (!SAFE_METHODS.has(req.method)) {
      const fetchSite = req.get("Sec-Fetch-Site");
      if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
        return deny(res, 403, "Cross-site request refused");
      }
      const origin = req.get("Origin");
      if (origin && origin !== config.publicOrigin) {
        return deny(res, 403, "Cross-site request refused");
      }
      const sent = req.get("X-CSRF-Token");
      if (!sent || !timingSafeEqual(sent, session.csrfToken)) {
        return deny(res, 403, "Missing or invalid CSRF token");
      }
    }
    req.editor = {
      sub: session.claims.sub,
      email: session.claims.email || null,
      name: session.claims.name || null,
    };
    return next();
  }

  // ---- routes ----------------------------------------------------------------
  const router = express.Router();

  router.get("/api/auth/me", (req, res) => {
    res.set("Cache-Control", "no-store");
    const session = resolveSession(req);
    res.json({
      enabled: editingEnabled,
      authenticated: !!session,
      canEdit: !!session && editingEnabled,
      user: session ? publicUser(session.claims) : null,
      csrfToken: session ? session.csrfToken : null,
    });
  });

  router.get("/auth/login", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!editingEnabled) return res.status(404).type("text").send("Login is not enabled");
    const returnTo = safeReturnTo(req.query.returnTo);
    if (resolveSession(req)) return res.redirect(302, returnTo);
    try {
      const oidc = await loadOidc();
      const provider = await getProviderConfig();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const loginId = store.createLoginState({ state, nonce, codeVerifier, returnTo });
      const target = oidc.buildAuthorizationUrl(provider, {
        redirect_uri: config.redirectUri,
        scope: config.scope,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
        state,
        nonce,
      });
      res.append("Set-Cookie", serializeCookie(loginCookie, loginId, cookieOptions(600)));
      return res.redirect(302, target.href);
    } catch (error) {
      logger.error(`[auth] could not start login: ${error.message}`);
      return res.redirect(302, "/?login=failed");
    }
  });

  router.get("/auth/callback", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const clearLogin = () =>
      res.append("Set-Cookie", serializeCookie(loginCookie, "", cookieOptions(0)));
    const fail = (outcome, detail) => {
      logger.warn(`[auth] login ${outcome}${detail ? `: ${detail}` : ""}`);
      clearLogin();
      return res.redirect(302, `/?login=${outcome}`);
    };
    if (!editingEnabled) return res.status(404).type("text").send("Login is not enabled");

    const pending = store.consumeLoginState(parseCookies(req.headers.cookie)[loginCookie]);
    if (!pending) return fail("failed", "no matching login attempt (expired or cookie missing)");

    try {
      const oidc = await loadOidc();
      const provider = await getProviderConfig();
      // Rebuilt from our configured address rather than the Host header, which
      // a client or misconfigured proxy could set to anything.
      const currentUrl = new URL(config.redirectUri);
      currentUrl.search = new URL(req.originalUrl, "http://localhost").search;

      const tokens = await oidc.authorizationCodeGrant(provider, currentUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const idClaims = tokens.claims();
      if (!idClaims || !idClaims.sub) return fail("failed", "ID token had no subject");

      // Email / groups are sometimes only in the userinfo response. Fetch it
      // only when an allowlist rule needs a claim the ID token didn't carry.
      let claims = { ...idClaims };
      const needsEmail = config.editors.emails.size > 0 && claims.email_verified !== true;
      const needsGroups = config.editors.groups.size > 0 && claims[config.groupsClaim] === undefined;
      if (!config.editors.subs.has(claims.sub) && (needsEmail || needsGroups)) {
        try {
          const userinfo = await oidc.fetchUserInfo(provider, tokens.access_token, claims.sub);
          claims = { ...userinfo, ...claims };
          if (claims.email_verified === undefined && userinfo.email_verified !== undefined) {
            claims.email_verified = userinfo.email_verified;
          }
        } catch (error) {
          logger.warn(`[auth] userinfo lookup failed: ${error.message}`);
        }
      }

      if (!isAuthorizedEditor(claims, config)) {
        logger.warn(`[auth] sign-in refused: subject ${claims.sub} is not an authorized editor`);
        return fail("denied");
      }

      const groups = claims[config.groupsClaim];
      const { id } = store.createSession(
        {
          sub: claims.sub,
          name: claims.name || claims.preferred_username || claims.email || null,
          email: claims.email_verified === true ? claims.email || null : null,
          email_verified: claims.email_verified === true,
          ...(groups !== undefined ? { [config.groupsClaim]: groups } : {}),
        },
        config.sessionTtlSeconds,
      );
      store.purgeExpired();
      logger.log(`[auth] editor signed in: ${claims.sub}`);
      res.append("Set-Cookie", serializeCookie(sessionCookie, id, cookieOptions(config.sessionTtlSeconds)));
      clearLogin();
      return res.redirect(302, safeReturnTo(pending.returnTo));
    } catch (error) {
      return fail("failed", error.message);
    }
  });

  router.post("/auth/logout", (req, res) => {
    res.set("Cache-Control", "no-store");
    const session = resolveSession(req);
    if (session) {
      const sent = req.get("X-CSRF-Token");
      const origin = req.get("Origin");
      if ((origin && origin !== config.publicOrigin) || !sent || !timingSafeEqual(sent, session.csrfToken)) {
        return deny(res, 403, "Missing or invalid CSRF token");
      }
      store.destroySession(session.id);
    }
    res.append("Set-Cookie", serializeCookie(sessionCookie, "", cookieOptions(0)));
    return res.json({ ok: true });
  });

  if (config.enabled) {
    setInterval(() => store.purgeExpired(), 60 * 60 * 1000).unref();
  }

  const describe = () => {
    if (!config.enabled) return `login disabled (${config.disabledReason})`;
    if (!config.hasEditorRules) {
      return "login configured but NO editor allowlist set (OIDC_EDITOR_SUBS / OIDC_EDITOR_EMAILS / OIDC_EDITOR_GROUPS) -- editing stays off";
    }
    return `login enabled via ${config.issuer}; editors: ${config.editors.subs.size} subject(s), ${config.editors.emails.size} email(s), ${config.editors.groups.size} group(s)`;
  };

  return { router, requireEditor, resolveSession, describe, editingEnabled };
}

module.exports = { createAuth, safeReturnTo, parseCookies };
