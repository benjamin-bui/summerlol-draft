import { Link } from "react-router-dom";
import { buildPlayerSlug, championIconKey, getRankTier, ROLES, ROLE_LABELS } from "../../utils/format";

// A player's name, split so the "#tag" portion renders slightly muted.
export function NameWithTag({ fullName }) {
  const name = String(fullName || "");
  const idx = name.lastIndexOf("#");
  if (idx === -1) return <span className="player-name">{name}</span>;
  return (
    <>
      <span className="player-name">{name.slice(0, idx)}</span>
      <span className="player-tag">{name.slice(idx)}</span>
    </>
  );
}

// A player's name as a link to their profile page, or an external op.gg
// link, or (opt-in only) a "simple" stub profile for names with no identity
// on record at all.
//
// The old vanilla app actually had two different cell renderers here, and
// which one a given table used mattered:
//   - renderPlayerCell (utils.js): used by the generic table factory for any
//     "group"/playerLink column (TrueSkill, Draft Data). identityKey alone
//     decides the profile link -- no "identified" gate -- and there's no
//     simple-profile fallback; no identityKey and no profileUrl just means
//     plain unlinked text.
//   - renderClickableName (player-profile.js): used explicitly by Mock
//     Draft and Upcoming Roster, where a name might be freshly typed in with
//     no backing data at all. identityKey AND identified both have to be
//     true for the profile link, and anything else falls back to a
//     "/player/simple/..." stub link rather than plain text.
// allowSimpleFallback picks which of the two this call site wants; it
// defaults to the renderPlayerCell behavior since that's the common case.
export function PlayerLink({ fullName, identityKey, identified = true, profileUrl = null, allowSimpleFallback = false }) {
  const name = fullName || identityKey || "\u2013";
  const hasProfileRoute = allowSimpleFallback ? identityKey && identified : Boolean(identityKey);
  if (hasProfileRoute) {
    const slug = buildPlayerSlug(fullName) || encodeURIComponent(identityKey);
    return (
      <Link to={`/player/${slug}`} className="player-link" title="View profile">
        <NameWithTag fullName={name} />
      </Link>
    );
  }
  if (profileUrl) {
    return (
      <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="player-link" title="View on op.gg">
        <NameWithTag fullName={name} />
      </a>
    );
  }
  if (allowSimpleFallback && fullName) {
    const simpleSlug = buildPlayerSlug(fullName) || encodeURIComponent(fullName);
    return (
      <Link to={`/player/simple/${simpleSlug}`} className="simple-profile-link">
        <NameWithTag fullName={name} />
      </Link>
    );
  }
  return <NameWithTag fullName={name} />;
}

export function ChampionIcon({ champion }) {
  const label = champion || "Unknown champion";
  const iconKey = championIconKey(champion);
  return (
    <span className="champion-cell">
      <img
        src={`/icons/champions/${iconKey}.png`}
        alt={label}
        className="champion-icon"
        onError={(e) => {
          e.currentTarget.hidden = true;
        }}
      />
      <span>{label}</span>
    </span>
  );
}

// A champion (icon + name) as a link to its profile page. `championKey` is the
// normalized id the server uses; it's derived from the name when not given.
export function ChampionLink({ champion, championKey = null }) {
  const key = championKey || championIconKey(champion);
  return (
    <Link
      to={`/champion/${encodeURIComponent(key)}`}
      className="champion-link"
      title="View champion"
      onClick={(event) => event.stopPropagation()}
    >
      <ChampionIcon champion={champion} />
    </Link>
  );
}

// A team's bans for one game, as a labeled row of champion chips.
export function BanList({ bans, highlightKey = null }) {
  const list = bans || [];
  return (
    <div className="ban-list">
      <span className="ban-list-label">Bans</span>
      {list.length ? (
        list.map((b, i) => {
          const key = b.key ?? b.championKey ?? null;
          return (
            <span key={i} className={`ban-chip${highlightKey && key === highlightKey ? " is-highlighted" : ""}`}>
              <ChampionLink champion={b.champion} championKey={key} />
            </span>
          );
        })
      ) : (
        <span className="ban-list-none">{"–"}</span>
      )}
    </div>
  );
}

const ROLE_ICON_DIR = "/icons/roles";
const ROLE_ICON_EXT = "svg";

// The role's icon, in a fixed-width slot so names line up down a roster.
// `reserveSpace`: keep the (empty) slot even with no role, so this player's
// row still lines up with teammates who do have one recorded.
export function RoleIcon({ role, reserveSpace = false }) {
  const known = ROLES.includes(role);
  if (!known && !reserveSpace) return null;
  return (
    <span className="role-icon-slot">
      {known && (
        <img
          src={`${ROLE_ICON_DIR}/${role.toLowerCase()}.${ROLE_ICON_EXT}`}
          alt={ROLE_LABELS[role]}
          title={ROLE_LABELS[role]}
          className="role-icon"
          onError={(e) => e.currentTarget.remove()}
        />
      )}
    </span>
  );
}

export function RoleLabel({ role }) {
  if (!ROLES.includes(role)) return <>{"–"}</>;
  return (
    <>
      <RoleIcon role={role} />
      <span className="role-label">{ROLE_LABELS[role]}</span>
    </>
  );
}

export function RankBadge({ input }) {
  let tierName = "unranked";
  let displayName = "Unranked";
  if (typeof input === "string") {
    tierName = input.toLowerCase();
    displayName = input;
  } else if (typeof input === "object" && input?.name) {
    tierName = input.name.toLowerCase();
    displayName = input.name;
  } else if (typeof input === "number" && !Number.isNaN(input)) {
    const tier = getRankTier(input);
    tierName = tier?.name?.toLowerCase() || "unranked";
    displayName = tier?.name || "Unranked";
  }
  return <img src={`/icons/${tierName}.webp`} alt={`${displayName} rank badge`} className="rank-badge" />;
}

export function TrueSkillValue({ rating, mu }) {
  if (rating === null || rating === undefined) return <>{"–"}</>;
  const formatRating = (n) => <span className="rating-number">{Math.round(n)}</span>;
  if (mu === null || mu === undefined || Number.isNaN(mu)) {
    return (
      <span className="trueskill-cell">
        <RankBadge input={rating} />
        {formatRating(rating)}
      </span>
    );
  }
  return (
    <span className="trueskill-cell">
      <RankBadge input={rating} />
      <span className="trueskill-ratings">
        {formatRating(rating)}
        <span className="trueskill-mu">({formatRating(mu)})</span>
      </span>
    </span>
  );
}

export function SoloQueueRank({ rank }) {
  if (!rank || !rank.tier || rank.tier === "UNRANKED") return null;
  const tierName = rank.tier.toLowerCase();
  const isApex = ["CHALLENGER", "GRANDMASTER", "MASTER"].includes(rank.tier.toUpperCase());
  return (
    <span className="trueskill-cell">
      <RankBadge input={tierName} /> {isApex ? " " : rank.division} {"·"} {rank.leaguePoints} LP
    </span>
  );
}
