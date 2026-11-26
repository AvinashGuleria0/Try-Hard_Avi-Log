import { describe, expect, test } from "bun:test";
import { AVILOG_VERSION, attachAvilog } from "../src/index.js";
import { formatHelp, runCli } from "../src/cli.js";

describe("avilog Milestone 1 scaffold", () => {
  test("exports version and attachAvilog", () => {
    expect(AVILOG_VERSION).toBe("0.1.0");
    expect(typeof attachAvilog).toBe("function");
  });

  test("formatHelp includes core commands", () => {
    const help = formatHelp();
    expect(help).toContain("avilog -- <command>");
    expect(help).toContain("avilog analyze");
    expect(help).toContain("--target");
  });

  test("runCli handles --version", async () => {
    const code = await runCli(["--version"]);
    expect(code).toBe(0);
  });
});
