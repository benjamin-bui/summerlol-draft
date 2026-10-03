#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

const sqliteProbe = spawnSync(
  process.execPath,
  [
    "-e",
    'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.prepare("SELECT 1").get(); db.close();',
  ],
  { encoding: "utf8" },
);

if (sqliteProbe.error || sqliteProbe.signal || sqliteProbe.status !== 0) {
  const failure = sqliteProbe.error?.message ||
    (sqliteProbe.signal ? `terminated by ${sqliteProbe.signal}` : `exited with status ${sqliteProbe.status}`);
  console.error(
    `Backend test preflight failed: better-sqlite3 ${failure} under Node ${process.version} (module ABI ${process.versions.modules}).`,
  );
  if (sqliteProbe.stderr?.trim()) console.error(sqliteProbe.stderr.trim());
  console.error(
    "The native addon may have been built for a different Node version. Rebuild better-sqlite3 using matching Node headers, or run the tests with the Node version used to install the backend dependencies.",
  );
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec"], {
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Could not start backend tests: ${result.error.message}`);
    process.exitCode = 1;
  } else if (result.signal) {
    console.error(`Backend test runner terminated by ${result.signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}