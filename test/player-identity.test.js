const test = require("node:test");
const assert = require("node:assert/strict");
const { opggLinkFromDisplayName } = require("../src/lib/player-identity");

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
