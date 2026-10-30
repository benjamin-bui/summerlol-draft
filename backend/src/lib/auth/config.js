// Reads the OIDC / editor-authorization settings from the environment.
//
// Two separate questions are answered here and they must not be confused:
//   * authentication  -- "who is this?"          (the OIDC provider answers it)
//   * authorization   -- "may they edit matches?" (ONLY the allowlists below)
// Signing in with the provider is never enough on its own: if none of the
// EDITOR allowlists match, the person gets no session at all.

function splitList(value) {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadAuthConfig(env = process.env) {
  const issuer = (env.OIDC_ISSUER || "").trim();
  const clientId = (env.OIDC_CLIENT_ID || "").trim();
  const publicUrl = (env.PUBLIC_URL || "").trim().replace(/\/+$/, "");

  const editors = {
    // Provider-issued subject ids: the most robust rule (they never change
    // and can't be claimed by someone else).
    subs: new Set(splitList(env.OIDC_EDITOR_SUBS)),
    // Only honored when the provider says the address is verified.
    emails: new Set(splitList(env.OIDC_EDITOR_EMAILS).map((e) => e.toLowerCase())),
    // Membership in any one of these groups (read from OIDC_GROUPS_CLAIM).
    groups: new Set(splitList(env.OIDC_EDITOR_GROUPS)),
  };

  const missing = [];
  if (!issuer) missing.push("OIDC_ISSUER");
  if (!clientId) missing.push("OIDC_CLIENT_ID");
  if (!publicUrl) missing.push("PUBLIC_URL");

  let publicOrigin = null;
  let problem = null;
  if (!missing.length) {
    try {
      const parsed = new URL(publicUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("not http(s)");
      }
      publicOrigin = parsed.origin;
    } catch {
      problem = "PUBLIC_URL is not a valid http(s) URL";
    }
  }

  const allowInsecureHttp = env.OIDC_ALLOW_INSECURE_HTTP === "true";
  if (!problem && issuer && !allowInsecureHttp && !issuer.startsWith("https://")) {
    problem =
      "OIDC_ISSUER must be an https:// URL (set OIDC_ALLOW_INSECURE_HTTP=true for local development only)";
  }

  const ttlHours = Number(env.SESSION_TTL_HOURS);
  return {
    enabled: missing.length === 0 && !problem,
    // Why login is off, for the startup log. Never sent to clients.
    disabledReason: missing.length
      ? `missing ${missing.join(", ")}`
      : problem,
    issuer,
    clientId,
    clientSecret: env.OIDC_CLIENT_SECRET || "",
    scope: (env.OIDC_SCOPES || "openid profile email").trim(),
    groupsClaim: (env.OIDC_GROUPS_CLAIM || "groups").trim(),
    publicUrl,
    publicOrigin,
    redirectUri: publicUrl ? `${publicUrl}/auth/callback` : "",
    secureCookies: publicUrl.startsWith("https://"),
    allowInsecureHttp,
    sessionTtlSeconds:
      Number.isFinite(ttlHours) && ttlHours > 0
        ? Math.round(ttlHours * 3600)
        : 8 * 3600,
    editors,
    hasEditorRules:
      editors.subs.size + editors.emails.size + editors.groups.size > 0,
  };
}

// The authorization decision. `claims` is { sub, email, email_verified,
// <groups claim> } from the provider. Default deny: every rule has to be
// positively satisfied, and with no rules configured the answer is always no.
function isAuthorizedEditor(claims, config) {
  if (!claims || typeof claims.sub !== "string" || claims.sub === "") return false;
  const { subs, emails, groups } = config.editors;

  if (subs.has(claims.sub)) return true;

  if (
    claims.email_verified === true &&
    typeof claims.email === "string" &&
    emails.has(claims.email.trim().toLowerCase())
  ) {
    return true;
  }

  if (groups.size) {
    const raw = claims[config.groupsClaim];
    const memberOf = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    if (memberOf.some((group) => typeof group === "string" && groups.has(group))) {
      return true;
    }
  }
  return false;
}

module.exports = { loadAuthConfig, isAuthorizedEditor, splitList };
