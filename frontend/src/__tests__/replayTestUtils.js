import replays from "../../test-fixtures/replays.json";

// Builds a File shaped like a real ROFL2 replay: header, filler standing in for
// the compressed game data, then the metadata JSON and its 4-byte length.
export function buildRofl({ stats, gameLength = 1777560, version = "14.16.609.8277", fileName = "game.rofl" }) {
  const encoder = new TextEncoder();
  const metadata = encoder.encode(
    JSON.stringify({ gameLength, lastGameChunkId: 62, lastKeyFrameId: 30, statsJson: JSON.stringify(stats) }),
  );
  const head = new Uint8Array(64);
  head.set([0x52, 0x49, 0x4f, 0x54, 0x02, 0x00]);
  head[14] = version.length;
  head.set(encoder.encode(version), 15);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, metadata.length, true);
  return new File([head, new Uint8Array(500), metadata, tail], fileName);
}

export const fixtureReplayFile = (name, fileName) => {
  const { stats, version, gameLength } = replays[name];
  return buildRofl({ stats, version, gameLength, fileName });
};
export { replays };
