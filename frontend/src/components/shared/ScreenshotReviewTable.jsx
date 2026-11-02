import { OTHER_CHAMPION, championOptions, cropStyle, isSuggestedChampion, parseCount } from "../../utils/screenshotReview";

// One team of a screenshot read, as an editable table. Next to each player is
// the part of the screenshot each value came from, so the editor can see what
// was read and fix it right there. Values the reader isn't sure of (a champion
// it couldn't pin down, K/D/A that don't add up to the team's totals) are
// highlighted; changing one marks it as checked.

const COUNT_FIELDS = [
  ["kills", "kills"],
  ["deaths", "deaths"],
  ["assists", "assists"],
];

export default function ScreenshotReviewTable({ players, image, imageUrl, onChange }) {
  return (
    <table className="match-details-table match-editor-table screenshot-review-table">
      <thead>
        <tr>
          <th>On the screenshot</th>
          <th>Player</th>
          <th>Champion</th>
          <th>K / D / A</th>
        </tr>
      </thead>
      <tbody>
        {players.map((player) => {
          const label = `Player ${player.index + 1}`;
          const options = championOptions(player);
          const typed = !isSuggestedChampion(player);
          const championUnsure = !player.review.championConfident;
          const kdaUnsure =
            !player.review.kdaChecked &&
            (player.review.kdaOk === false || player.kills === null || player.deaths === null || player.assists === null);
          const boxes = player.review.boxes;
          return (
            <tr key={player.index}>
              <td className="screenshot-review-crops">
                {imageUrl && image && (
                  <>
                    <span className="screenshot-crop screenshot-crop-portrait" style={cropStyle(imageUrl, image, boxes.portrait, 44)} role="img" aria-label={`${label} portrait on the screenshot`} />
                    <span className="screenshot-crop-text">
                      <span className="screenshot-crop" style={cropStyle(imageUrl, image, boxes.name, 22)} role="img" aria-label={`${label} name on the screenshot`} />
                      <span className="screenshot-crop" style={cropStyle(imageUrl, image, boxes.kda, 22)} role="img" aria-label={`${label} K/D/A on the screenshot`} />
                    </span>
                  </>
                )}
              </td>
              <td>
                <input
                  type="text"
                  className="screenshot-review-name"
                  aria-label={`${label} name`}
                  value={player.gameName ?? ""}
                  onChange={(event) => onChange(player.index, { gameName: event.target.value, riotId: event.target.value })}
                />
              </td>
              <td>
                <div className="screenshot-review-champion">
                {typed ? (
                  <span className="screenshot-review-other">
                    <input
                      type="text"
                      aria-label={`${label} champion name`}
                      placeholder="Champion"
                      value={player.champion === OTHER_CHAMPION ? "" : player.champion}
                      autoFocus={player.champion === OTHER_CHAMPION}
                      onChange={(event) => onChange(player.index, { champion: event.target.value, markChampionChecked: true })}
                    />
                    {options.length > 0 && (
                      <button
                        type="button"
                        className="columns-btn"
                        aria-label={`${label} back to suggested champions`}
                        title="Back to the suggested champions"
                        onClick={() => onChange(player.index, { champion: options[0].key, markChampionChecked: true })}
                      >
                        {"\u21a9"}
                      </button>
                    )}
                  </span>
                ) : (
                  <select
                    aria-label={`${label} champion`}
                    className={championUnsure ? "is-unsure" : undefined}
                    value={player.champion}
                    onChange={(event) =>
                      onChange(player.index, { champion: event.target.value, markChampionChecked: event.target.value !== OTHER_CHAMPION })
                    }
                  >
                    {options.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                    <option value={OTHER_CHAMPION}>Other{"\u2026"}</option>
                  </select>
                )}
                {championUnsure && (
                  <span className="screenshot-review-flag" title="The reader wasn't sure of this champion (it may be a skin). Compare with the portrait.">
                    check
                  </span>
                )}
                </div>
              </td>
              <td className="screenshot-review-kda">
                {COUNT_FIELDS.map(([field, name]) => (
                  <input
                    key={field}
                    type="number"
                    min="0"
                    max="999"
                    inputMode="numeric"
                    className={`match-editor-stat${kdaUnsure ? " is-unsure" : ""}`}
                    aria-label={`${label} ${name}`}
                    value={player[field] ?? ""}
                    onChange={(event) => onChange(player.index, { [field]: parseCount(event.target.value), markKdaChecked: true })}
                  />
                ))}
                {player.review.kdaOk === true && (
                  <span className="screenshot-review-ok" title="This team's numbers add up to the scoreboard's totals.">
                    {"\u2713"}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

