const test = require("node:test");
const assert = require("node:assert/strict");
const { lookupIdentity, opggLinkFromDisplayName } = require("../src/lib/player-identity");

test("lookupIdentity prefers a trimmed alias over a whitespace-padded duplicate", () => {
  const cleanIdentity = { identityKey: "p188" };
  const paddedIdentity = { identityKey: "p206" };
  const identityMap = new Map([
    ["一見鍾情#1314", cleanIdentity],
    ["一見鍾情#1314\n", paddedIdentity],
  ]);

  assert.equal(lookupIdentity(identityMap, "一見鍾情#1314\n"), cleanIdentity);
});

test("lookupIdentity falls back to an alias stored with surrounding whitespace", () => {
  const identity = { identityKey: "p206" };
  const identityMap = new Map([["player#tag\r\n", identity]]);

  assert.equal(lookupIdentity(identityMap, "player#tag\r\n"), identity);
});

test("opggLinkFromDisplayName splits on last # and hyphen-joins for op.gg", () => {
  assert.equal(
    opggLinkFromDisplayName("SK Telecom T1#Faker"),
    "https://op.gg/lol/summoners/na/SK%20Telecom%20T1-Faker",
  );
  assert.equal(
    opggLinkFromDisplayName("torpid7#kitty"),
    "https://op.gg/lol/summoners/na/torpid7-kitty",
  );
});

test("opggLinkFromDisplayName returns null without a tag", () => {
  assert.equal(opggLinkFromDisplayName("NoTagName"), null);
  assert.equal(opggLinkFromDisplayName(""), null);
});
