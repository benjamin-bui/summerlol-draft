// Pure helpers behind the round-robin group editor in TournamentStructureEditor.
// A group is { groupId?, name, teams: [teamName] }; a team belongs to at most
// one group of a stage, and a team in no group is "unassigned".

export const MAX_GROUPS = 16;

const norm = (name) => String(name || "").trim().toLowerCase();

// "Group A", "Group B", ... "Group Z" (the editor caps groups at 16).
export function defaultGroupName(index) {
  return `Group ${String.fromCharCode(65 + (index % 26))}`;
}

// Distinct team names in the tournament, spelled as first seen, alphabetical.
export function tournamentTeams(games) {
  const seen = new Map();
  for (const game of games || []) {
    for (const team of [game.team1, game.team2]) {
      const key = norm(team);
      if (key && !seen.has(key)) seen.set(key, team);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// Grows or shrinks the group list to `count`. New groups get the first
// default name not already taken; shrinking drops groups from the end and
// their teams simply become unassigned.
export function resizeGroups(groups, count) {
  const target = Math.max(0, Math.min(MAX_GROUPS, Math.floor(Number(count)) || 0));
  const next = groups.slice(0, target);
  while (next.length < target) {
    const taken = new Set(next.map((group) => norm(group.name)));
    let index = 0;
    while (taken.has(norm(defaultGroupName(index)))) index += 1;
    next.push({ name: defaultGroupName(index), teams: [] });
  }
  return next;
}

// Which group (by index) holds `team`, or -1.
export function groupIndexOfTeam(groups, team) {
  return groups.findIndex((group) => group.teams.some((member) => norm(member) === norm(team)));
}

// Moves `team` into groups[groupIndex], or out of every group when
// groupIndex is -1 (unassigned).
export function assignTeam(groups, team, groupIndex) {
  return groups.map((group, index) => {
    const without = group.teams.filter((member) => norm(member) !== norm(team));
    return { ...group, teams: index === groupIndex ? [...without, team] : without };
  });
}

// Round-robin groups are exactly the connected components of "who played
// whom", so one pass of union-find over the stage's games gives a sensible
// starting allocation: bigger groups first, teams in order of first game.
// Returns [] when there are no games to learn from.
export function suggestGroups(games) {
  const parent = new Map();
  const canonical = new Map();
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(key, root);
    return root;
  };
  for (const game of games || []) {
    const keys = [game.team1, game.team2].map((team) => {
      const key = norm(team);
      if (key && !parent.has(key)) {
        parent.set(key, key);
        canonical.set(key, team);
      }
      return key;
    });
    if (keys[0] && keys[1]) parent.set(find(keys[0]), find(keys[1]));
  }
  const components = new Map();
  for (const key of parent.keys()) {
    const root = find(key);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(canonical.get(key));
  }
  return [...components.values()]
    .sort((a, b) => b.length - a.length)
    .map((teams, index) => ({ name: defaultGroupName(index), teams }));
}

// What the API receives for a stage: groups only exist on round-robin stages.
export function groupsPayload(stage) {
  if (stage.format !== "round-robin") return [];
  return (stage.groups || []).map((group) => ({
    ...(group.groupId ? { groupId: group.groupId } : {}),
    name: group.name,
    teams: group.teams,
  }));
}
