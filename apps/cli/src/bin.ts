import os from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { run } from "./cli.js";
import { openInBrowser } from "./open.js";

/** Asks on stderr, so stdout stays clean for the link. Hidden answers aren't echoed. */
async function prompt(question: string, { hidden = false } = {}): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
  if (hidden && process.stdin.isTTY) {
    const internals = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    internals._writeToOutput = (s: string) => {
      if (s.startsWith(question)) internals.output.write(question);
    };
  }
  try {
    return await rl.question(question);
  } finally {
    if (hidden && process.stdin.isTTY) process.stderr.write("\n");
    rl.close();
  }
}

const code = await run(process.argv.slice(2), {
  env: process.env,
  home: os.homedir(),
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  prompt,
  open: (url) => openInBrowser(url),
  fetch,
  // dist/vellum.js and src/bin.ts both sit one level under the package root.
  skillFile: fileURLToPath(new URL("../skill/SKILL.md", import.meta.url)),
});
process.exitCode = code;
