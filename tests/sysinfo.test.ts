import { describe, expect, it } from "vitest";
import { SYSINFO_COMMANDS, commandsFor } from "../src/benchmark/sysinfo";
import { LINUX_ONLY_FIELDS } from "../src/benchmark/types";

const fields = (os: "windows" | "linux") => SYSINFO_COMMANDS[os].commands.filter((c) => c.command).map((c) => c.field);

describe("system-info lookup commands", () => {
  it("Windows covers every general field, and no Linux-only field", () => {
    expect(fields("windows")).toEqual(expect.arrayContaining(["gpu", "osDetail", "cpu", "memoryGb", "memoryType", "driver"]));
    for (const f of LINUX_ONLY_FIELDS) expect(fields("windows")).not.toContain(f);
  });

  it("Linux covers general fields plus distro, kernel and mesa", () => {
    expect(fields("linux")).toEqual(expect.arrayContaining(["gpu", "osDetail", "cpu", "memoryGb", "memoryType", "driver", "distro", "kernel", "mesa"]));
  });

  it("Proton has no command (not applicable to a browser benchmark)", () => {
    const proton = SYSINFO_COMMANDS.linux.commands.find((c) => c.field === "proton")!;
    expect(proton.command).toBe("");
    expect(proton.note).toMatch(/Not applicable/);
  });

  it("Windows script avoids PowerShell 7-only syntax", () => {
    const all = SYSINFO_COMMANDS.windows.all + SYSINFO_COMMANDS.windows.commands.map((c) => c.command).join("\n");
    expect(all).not.toMatch(/\?\?|\?\.|&&|\|\|/);
  });

  it("only windows/linux have commands", () => {
    expect(commandsFor("")).toBeNull();
    expect(commandsFor("macos")).toBeNull();
    expect(commandsFor("windows")?.shell).toBe("PowerShell");
  });
});
