// Small pure helpers behind the screenshot review table: showing the part of
// the screenshot a value was read from, and turning what the editor types back
// into numbers and champion names.

import { championDisplayName } from "./replayMatching";

export const OTHER_CHAMPION = "__other__";

// Style for a box that shows just one region of the uploaded image, scaled to
// `height` px tall: the whole image as a background, shifted and sized so only
// the region shows. `box` is in the image's own pixels ({ left, top, width,
// height }); `image` is { width, height }.
export function cropStyle(imageUrl, image, box, height) {
  const scale = height / box.height;
  return {
    width: Math.round(box.width * scale),
    height,
    backgroundImage: `url("${imageUrl}")`,
    backgroundSize: `${image.width * scale}px ${image.height * scale}px`,
    backgroundPosition: `-${box.left * scale}px -${box.top * scale}px`,
    backgroundRepeat: "no-repeat",
  };
}

// What the editor typed in a kills/deaths/assists box: a whole number from 0 to
// 999, or null when blank or not usable.
export function parseCount(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number >= 0 && number <= 999 ? number : null;
}

// The champions to offer for a player: the screenshot reader's best guesses,
// first being its pick, each with its readable name.
export function championOptions(player, knownSpellings = []) {
  return (player.review?.championChoices || []).map((choice) => ({
    key: choice.key,
    label: championDisplayName(choice.key, knownSpellings),
  }));
}

// True when the player's champion is one of the reader's guesses (as opposed to
// something the editor typed in).
export function isSuggestedChampion(player) {
  return (player.review?.championChoices || []).some((choice) => choice.key === player.champion);
}
