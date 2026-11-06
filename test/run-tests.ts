import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createGameTemplate } from "./support/game-fixture.js";

async function runTestFiles(): Promise<number> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pg-dungeon-tests-"));

  try {
    const snapshot = await createGameTemplate();
    const templatePath = join(temporaryDirectory, "template.tar");
    await writeFile(templatePath, Buffer.from(await snapshot.arrayBuffer()));

    const testDirectory = fileURLToPath(new URL("./", import.meta.url));
    const testFiles = (await readdir(testDirectory))
      .filter((fileName) => fileName.endsWith(".test.ts"))
      .sort()
      .map((fileName) => join(testDirectory, fileName));
    const tsxCli = fileURLToPath(
      new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
    );
    const child = spawn(process.execPath, [tsxCli, "--test", ...testFiles], {
      env: { ...process.env, PG_DUNGEON_TEMPLATE_PATH: templatePath },
      stdio: "inherit",
    });

    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

process.exitCode = await runTestFiles();
