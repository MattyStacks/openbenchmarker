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

  it("has a driver version command for NVIDIA, AMD and Intel on each OS", () => {
    const labels = (os: "windows" | "linux") => SYSINFO_COMMANDS[os].commands.filter((c) => c.field === "driver" && c.command).map((c) => c.label);
    expect(labels("windows")).toEqual(["GPU driver (NVIDIA)", "GPU driver (AMD)", "GPU driver (Intel)"]);
    expect(labels("linux")).toEqual(["GPU driver (NVIDIA)", "GPU driver (AMD/Intel)"]);
    expect(SYSINFO_COMMANDS.windows.all).toMatch(/RadeonSoftwareVersion/);
    expect(SYSINFO_COMMANDS.windows.all).toMatch(/ProviderName -match 'Intel'/);
  });

  it("the Linux Mesa lookup works without glxinfo (falls back to the installed package)", () => {
    const mesa = SYSINFO_COMMANDS.linux.commands.find((c) => c.field === "mesa")!.command;
    for (const tool of ["glxinfo", "dpkg-query", "rpm -q", "pacman -Q"]) expect(mesa).toContain(tool);
    expect(mesa).toContain("dpkg-query -W -f='${Version}\\n'");
    const driver = SYSINFO_COMMANDS.linux.commands.find((c) => c.label === "GPU driver (AMD/Intel)")!.command;
    expect(driver.startsWith(mesa)).toBe(true);
    expect(SYSINFO_COMMANDS.linux.all).toContain(mesa);
  });

  it("only windows/linux have commands", () => {
    expect(commandsFor("")).toBeNull();
    expect(commandsFor("macos")).toBeNull();
    expect(commandsFor("windows")?.shell).toBe("PowerShell");
  });
});
