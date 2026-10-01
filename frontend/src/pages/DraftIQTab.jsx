import { useEffect, useState } from "react";
import { api } from "../api/client";
import DataTable from "../components/table/DataTable";
import Modal from "../components/shared/Modal";
import { NameWithTag } from "../components/shared/Cells";
import { round1 } from "../utils/format";
import DraftScatterChart from "../charts/DraftScatterChart";

function PickCell({ pick, rankLabel }) {
  if (!pick) return <>{"\u2013"}</>;
  const rank = pick.entryRank ?? pick.exitRank;
  return (
    <>
      {pick.displayName}{" "}
      <span className={`pick-value ${pick.value > 0 ? "outcome-win" : pick.value < 0 ? "outcome-loss" : ""}`}>
        {pick.value > 0 ? "+" : ""}
        {pick.value}
      </span>
      <br />
      <span className="pick-detail">
        pick #{pick.pickOrder} {"\u00b7"} {rankLabel} #{rank}
      </span>
    </>
  );
}

const DRAFT_IQ_COLUMNS = (onOpenCaptain) => [
  { key: "rank", label: "#", sortable: false, hideable: false, filterable: false },
  {
    key: "captain",
    label: "Captain",
    sortable: true,
    hideable: false,
    filterable: true,
    type: "string",
    className: "group-name",
    sticky: true,
    render: (val, row) => (
      <a
        href="#"
        className="captain-draft-link"
        onClick={(e) => {
          e.preventDefault();
          onOpenCaptain(row.captain);
        }}
      >
        <NameWithTag fullName={row.captain} />
      </a>
    ),
  },
  { key: "avgDraftValue", label: "Draft IQ (avg value)", sortable: true, hideable: true, filterable: true, type: "number", decimals: 2, className: "adj-avg" },
  { key: "picksEvaluated", label: "Picks Evaluated", sortable: true, hideable: true, filterable: true, type: "number", decimals: 0 },
  {
    key: "bestPickLabel",
    label: "Best Pick",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.bestPick?.value ?? -Infinity,
    render: (val, row) => <PickCell pick={row.bestPick} rankLabel="entering-rank" />,
  },
  {
    key: "worstPickLabel",
    label: "Worst Pick",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.worstPick?.value ?? -Infinity,
    render: (val, row) => <PickCell pick={row.worstPick} rankLabel="entering-rank" />,
  },
  {
    key: "bestPickLeavingLabel",
    label: "Best Pick (Leaving)",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.bestPickLeaving?.value ?? -Infinity,
    render: (val, row) => <PickCell pick={row.bestPickLeaving} rankLabel="leaving-rank" />,
  },
  {
    key: "worstPickLeavingLabel",
    label: "Worst Pick (Leaving)",
    sortable: true,
    hideable: true,
    filterable: false,
    type: "string",
    sortValue: (row) => row.worstPickLeaving?.value ?? -Infinity,
    render: (val, row) => <PickCell pick={row.worstPickLeaving} rankLabel="leaving-rank" />,
  },
];

function CaptainDraftHistory({ analysis, captain }) {
  const picks = analysis.picks.filter((p) => p.captain === captain);
  const byTournament = new Map();
  for (const p of picks) {
    const key = `${p.year}::${p.tournament}`;
    if (!byTournament.has(key)) byTournament.set(key, []);
    byTournament.get(key).push(p);
  }
  const sections = [...byTournament.entries()].sort((a, b) => {
    const [ay, at] = a[0].split("::");
    const [by, bt] = b[0].split("::");
    if (ay !== by) return by - ay;
    return at.localeCompare(bt);
  });

  return (
    <>
      {sections.map(([key, tournamentPicks]) => {
        const [year, tournament] = key.split("::");
        const teamBalance = analysis.teamBalance.find(
          (t) => t.captain === captain && t.tournament === tournament && Number(t.year) === Number(year),
        );
        const avgValue = round1(tournamentPicks.reduce((s, p) => s + p.value, 0) / tournamentPicks.length);
        const withLeaving = tournamentPicks.filter((p) => p.leavingValue !== null);
        const avgLeavingValue = withLeaving.length
          ? round1(withLeaving.reduce((s, p) => s + p.leavingValue, 0) / withLeaving.length)
          : null;
        const wins = teamBalance?.wins ?? "\u2013";
        const losses = teamBalance?.losses ?? "\u2013";
        const rows = [...tournamentPicks].sort((a, b) => a.pickOrder - b.pickOrder);
        return (
          <div key={key}>
            <h4>
              {tournament} {year}{" "}
              <span className="stat-formula">
                (avg entering value {avgValue > 0 ? "+" : ""}
                {avgValue}
                {avgLeavingValue !== null ? ` \u00b7 avg leaving value ${avgLeavingValue > 0 ? "+" : ""}${avgLeavingValue}` : ""})
              </span>
            </h4>
            <h4>
              {wins}W {losses}L
            </h4>
            <table className="profile-history-table">
              <thead>
                <tr>
                  <th>Pick #</th>
                  <th>Player</th>
                  <th>Entering Rank</th>
                  <th>Value</th>
                  <th>Leaving Rank</th>
                  <th>Value (Leaving)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={i}>
                    <td>#{p.pickOrder}</td>
                    <td>{p.displayName}</td>
                    <td>#{p.entryRank}</td>
                    <td className={p.value > 0 ? "outcome-win" : p.value < 0 ? "outcome-loss" : ""}>
                      {p.value > 0 ? "+" : ""}
                      {p.value}
                    </td>
                    <td>{p.exitRank !== null ? "#" + p.exitRank : "\u2013"}</td>
                    <td className={p.leavingValue > 0 ? "outcome-win" : p.leavingValue < 0 ? "outcome-loss" : ""}>
                      {p.leavingValue !== null ? (p.leavingValue > 0 ? "+" : "") + p.leavingValue : "\u2013"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {sections.length === 0 && <p>No draft history found.</p>}
    </>
  );
}

export default function DraftIQTab({ active }) {
  const [analysis, setAnalysis] = useState(null);
  const [openCaptain, setOpenCaptain] = useState(null);
  const [scatterOpen, setScatterOpen] = useState(false);

  useEffect(() => {
    if (active && !analysis) {
      api.draftAnalysis().then(setAnalysis);
    }
  }, [active, analysis]);

  const rows = (analysis?.captainDraftIQ || []).map((row) => ({ ...row }));

  return (
    <section className={`tab-panel${active ? " active" : ""}`}>
      <section className="control-panel">
        <h3>Draft IQ</h3>
        <p>
          <strong>Value:</strong> For every draft pick ever made, we rank all players in that tournament’s draft class
          by their TrueSkill entering that tournament. Value = (entering-skill rank) - (actual pick order). Positive
          means a player went later than their skill justified - a steal. Negative means they went earlier - a reach.
        </p>
        <p>
          <strong>Draft IQ:</strong> A captain’s average pick value across every draft they’ve participated in.
          Consistently positive means a captain reliably finds undervalued players; consistently negative means they
          tend to reach.
        </p>
        <p>
          Note: this compares against a fixed, final skill ranking of the whole draft class - it does not simulate
          who was actually still available on the board at each individual pick. A pick isn’t credited or penalized
          for the best remaining option having already been taken by someone else.
        </p>
        <p>
          Excluded data: Data from the first tournament is excluded because all players started at the same
          TrueSkill level. New players joining later tournaments are not excluded and are assessed at the default
          TrueSkill value.
        </p>
      </section>

      <div className="fun-facts-box">
        <button className="collapsible-toggle" aria-expanded={scatterOpen} onClick={() => setScatterOpen((o) => !o)}>
          {scatterOpen ? "\u25bc" : "\u25b6"} Draft IQ vs Win Rate
        </button>
        <div className="collapsible-body" hidden={!scatterOpen}>
          {scatterOpen && analysis && <DraftScatterChart analysis={analysis} />}
        </div>
      </div>

      {analysis ? (
        <DataTable
          columns={DRAFT_IQ_COLUMNS(setOpenCaptain)}
          data={rows}
          ownerKey="draftiq"
          defaultSortColumn="avgDraftValue"
          emptyMessage="No draft data available"
        />
      ) : (
        <p>{"Loading\u2026"}</p>
      )}

      <Modal open={!!openCaptain} onClose={() => setOpenCaptain(null)} title={openCaptain ? `${openCaptain} \u2014 Draft History` : ""}>
        {analysis && openCaptain && <CaptainDraftHistory analysis={analysis} captain={openCaptain} />}
      </Modal>
    </section>
  );
}
