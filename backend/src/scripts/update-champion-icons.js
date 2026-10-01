const fs = require("fs");
const path = require("path");

const DATA_DRAGON_VERSIONS =
  "https://ddragon.leagueoflegends.com/api/versions.json";
const DATA_DRAGON_CHAMPIONS = (version) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;
const DATA_DRAGON_ICON = (version, key) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`;
const ICON_DIR = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "icons",
  "champions",
);
const VERSION_FILE = path.join(ICON_DIR, "version.json");

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function updateChampionIcons() {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  const versions = await (await fetch(DATA_DRAGON_VERSIONS)).json();
  const version = versions[0];
  const championData = await (
    await fetch(DATA_DRAGON_CHAMPIONS(version))
  ).json();
  const champions = Object.values(championData.data || {});

  let downloaded = 0;
  for (const champion of champions) {
    const destination = path.join(ICON_DIR, `${champion.id.toLowerCase()}.png`);
    if (!fs.existsSync(destination)) {
      await download(DATA_DRAGON_ICON(version, champion.id), destination);
      downloaded++;
    }
  }
  fs.writeFileSync(
    VERSION_FILE,
    `${JSON.stringify({ version, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return { version, total: champions.length, downloaded };
}

if (require.main === module) {
  updateChampionIcons()
    .then((result) =>
      console.log(
        `Champion icons: ${result.downloaded} downloaded, ${result.total} available at Data Dragon ${result.version}`,
      ),
    )
    .catch((error) => {
      console.error(`Champion icon update skipped: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { updateChampionIcons };
