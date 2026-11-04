import { useState } from "react";

// The whole uploaded screenshot, uncropped, for the match editor: the bans (and
// anything the reader couldn't make out) are read from it by eye while the form
// below is filled in. It sticks to the top of the dialog while the form scrolls
// underneath, can be shown at fit-width or actual size (scrolling inside its own
// box), collapsed, or opened in its own tab.
export default function ScreenshotViewer({ src, fileName = "" }) {
  const [open, setOpen] = useState(true);
  const [actualSize, setActualSize] = useState(false);
  const [pinned, setPinned] = useState(true);
  if (!src) return null;
  return (
    <figure className={`screenshot-viewer${pinned ? " is-pinned" : ""}`} aria-label="Full screenshot">
      <figcaption className="screenshot-viewer-bar">
        <strong>Full screenshot</strong>
        <span className="screenshot-viewer-hint">{fileName ? `${fileName} \u2014 ` : ""}for entering bans and checking the reading</span>
        <span className="screenshot-viewer-actions">
          {open && (
            <>
              <button type="button" className="columns-btn" aria-pressed={actualSize} onClick={() => setActualSize((value) => !value)}>
                {actualSize ? "Fit width" : "Actual size"}
              </button>
              <button type="button" className="columns-btn" aria-pressed={pinned} onClick={() => setPinned((value) => !value)}>
                {pinned ? "Unpin" : "Pin to top"}
              </button>
            </>
          )}
          <a className="columns-btn" href={src} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
          <button type="button" className="columns-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? "Hide" : "Show"}
          </button>
        </span>
      </figcaption>
      {open && (
        <div className={`screenshot-viewer-body${actualSize ? " is-actual-size" : ""}`}>
          <img src={src} alt="Uploaded scoreboard screenshot" />
        </div>
      )}
    </figure>
  );
}
