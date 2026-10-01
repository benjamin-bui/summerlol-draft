import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppData } from "../../context/AppDataContext";
import { parseNameList, seasonRankLocal } from "../../utils/format";
import { namesForPastDraft, namesForPastDraftCaptains } from "../../utils/nameMatch";

// Paste/upload/preset name-list input, shared by the TrueSkill tab's row
// filter and the Mock Draft tab's player pool. `onApply(text)` receives the
// raw textarea contents whenever it changes (typed+Apply, file upload, or a
// preset selection) -- the caller owns what "applying" a list means.
// `onCaptains` (Mock Draft only) additionally receives the captain list a
// past-draft preset remembers.
export default function NameFilterBox({
  label,
  textareaId,
  placeholder,
  summary,
  onApply,
  onCaptains,
  applyLabel = "Apply Filter",
}) {
  const { players } = useAppData();
  const [text, setText] = useState("");
  const [adminPresets, setAdminPresets] = useState([]);

  useEffect(() => {
    api
      .presets()
      .then((data) => setAdminPresets(data.presets || []))
      .catch(() => {});
  }, []);

  const pastDraftOptions = (() => {
    const combos = new Set();
    (players || []).forEach((p) => (p.history || []).forEach((h) => combos.add(`${h.year}::${h.tournament}`)));
    return [...combos].sort((a, b) => {
      const [ay, at] = a.split("::");
      const [by, bt] = b.split("::");
      if (ay !== by) return by - ay;
      return seasonRankLocal(at) - seasonRankLocal(bt);
    });
  })();

  async function handlePresetChange(e) {
    const val = e.target.value;
    if (!val) return;
    if (val.startsWith("past::")) {
      const [, year, tournament] = val.split("::");
      const names = namesForPastDraft(players, year, tournament);
      setText(names.join("\n"));
      onApply(names.join("\n"));
      if (onCaptains) onCaptains(namesForPastDraftCaptains(players, year, tournament), names.length);
    } else if (val.startsWith("admin::")) {
      const id = val.slice("admin::".length);
      const data = await api.preset(id);
      setText(data.names.join("\n"));
      onApply(data.names.join("\n"));
      if (onCaptains) onCaptains(data.captains || [], data.names.length);
    }
    e.target.value = "";
  }

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fileText = await file.text();
    setText(fileText);
    onApply(fileText);
  }

  return (
    <div className="name-filter-box">
      <select onChange={handlePresetChange} defaultValue="">
        <option value="">{"Load a preset\u2026"}</option>
        <optgroup label="Past Drafts">
          {pastDraftOptions.map((combo) => {
            const [year, tournament] = combo.split("::");
            return (
              <option key={combo} value={`past::${combo}`}>
                {tournament} {year}
              </option>
            );
          })}
        </optgroup>
        <optgroup label="Upcoming Tournaments">
          {adminPresets.map((preset) => (
            <option key={preset.id} value={`admin::${preset.id}`}>
              {preset.label}
            </option>
          ))}
        </optgroup>
      </select>
      <label htmlFor={textareaId}>{label}</label>
      <textarea
        id={textareaId}
        rows={3}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="name-filter-controls">
        <input type="file" accept=".csv,.txt" onChange={handleFile} />
        <button type="button" onClick={() => onApply(text)}>
          {applyLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setText("");
            onApply("");
          }}
        >
          Clear
        </button>
        {summary}
      </div>
    </div>
  );
}

// Turns a raw pasted/uploaded name list into a {summaryText, hasMisses,
// matcher} triple against the known player pool -- shared logic behind the
// summary line under both name-filter boxes.
export function summarizeNameList(text, players, matcherFactoryFn) {
  const names = parseNameList(text);
  if (names.length === 0) return null;
  const matcher = matcherFactoryFn(names);
  const { matchedCount, totalCount, unmatched } = matcher.checkCoverage(players || []);
  return { names, matcher, matchedCount, totalCount, unmatched };
}
