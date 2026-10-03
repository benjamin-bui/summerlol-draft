import { useNavigate } from "react-router-dom";
import { routeState } from "../utils/routeState";

// Back button for profile pages: pop browser history when the visitor arrived
// from elsewhere on this site, otherwise (a direct link or a refresh) land on
// the tab that was last open.
export function useGoBack() {
  const navigate = useNavigate();
  return function goBack() {
    const cameFromThisSite = document.referrer && document.referrer.startsWith(window.location.origin);
    if (cameFromThisSite && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(`/?tab=${routeState.lastKnownTab}`);
    }
  };
}
