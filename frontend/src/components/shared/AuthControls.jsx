import { useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const LOGIN_NOTICES = {
  denied: "You signed in, but that account isn't on the editors list, so the site stays read-only for you.",
  failed: "Sign-in didn't complete. Please try again.",
};

// Header widget: a sign-in link for would-be editors, or "Editing as ..." with
// a sign-out button. Renders nothing at all when the server has login off, so
// ordinary visitors of a read-only deployment never see it.
export default function AuthControls() {
  const { enabled, authenticated, user, logout } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const notice = LOGIN_NOTICES[searchParams.get("login")] || null;

  function dismissNotice() {
    const next = new URLSearchParams(searchParams);
    next.delete("login");
    setSearchParams(next, { replace: true });
  }

  const returnParams = new URLSearchParams(location.search);
  returnParams.delete("login");
  const returnQuery = returnParams.toString();
  const returnTo = `${location.pathname}${returnQuery ? `?${returnQuery}` : ""}`;

  return (
    <div className="auth-controls">
      {notice && (
        <p className="auth-notice" role="alert">
          {notice}{" "}
          <button type="button" className="auth-link-btn" onClick={dismissNotice}>
            Dismiss
          </button>
        </p>
      )}
      {enabled && !authenticated && (
        // A plain link on purpose: sign-in is a full-page redirect to the
        // identity provider, not a client-side route.
        <a className="auth-link" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
          Editor sign-in
        </a>
      )}
      {enabled && authenticated && (
        <span className="auth-user">
          Editing as <strong>{user?.name || "editor"}</strong>
          <button type="button" className="auth-link-btn" onClick={logout}>
            Sign out
          </button>
        </span>
      )}
    </div>
  );
}
