// Tiny name helpers shared by the replay/screenshot matching code and the role
// guesser. Kept in their own module so both can use them without importing each
// other.

// Accent-, case- and whitespace-insensitive ("Ène" == "Ene").
export function foldName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function splitRiotId(value) {
  const text = String(value ?? "");
  const hash = text.indexOf("#");
  return hash === -1 ? { name: text, tag: "" } : { name: text.slice(0, hash), tag: text.slice(hash + 1) };
}
