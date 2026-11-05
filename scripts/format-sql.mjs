import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "sql-formatter";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(
  await readFile(resolve(projectRoot, ".sql-formatter.json"), "utf8"),
);
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const inputPaths = args.filter((arg) => arg !== "--check");
const sqlDirectory = resolve(projectRoot, "src/sql");
const filePaths =
  inputPaths.length > 0
    ? inputPaths
    : (await readdir(sqlDirectory))
        .filter((filePath) => filePath.endsWith(".sql"))
        .map((filePath) => resolve(sqlDirectory, filePath));

for (const filePath of filePaths) {
  const source = await readFile(filePath, "utf8");
  const formatted = format(source, config);

  if (source === formatted) {
    continue;
  }

  if (checkOnly) {
    console.error(`${filePath} is not formatted`);
    process.exitCode = 1;
    continue;
  }

  await writeFile(filePath, formatted);
}
