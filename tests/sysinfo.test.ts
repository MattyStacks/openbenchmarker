import { describe, expect, it } from "vitest";
import { SYSINFO_COMMANDS, commandsFor, parseSysinfoPaste } from "../src/benchmark/sysinfo";
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

  it("the GPU command prints the lines the ID helper reads, on both OSes", () => {
    for (const os of ["windows", "linux"] as const) {
      const gpu = SYSINFO_COMMANDS[os].commands.find((c) => c.field === "gpu")!.command;
      expect(gpu).toContain("Computer type: ");
      expect(gpu).toMatch(/GPU: .*GB\) \[board /);
      expect(SYSINFO_COMMANDS[os].all.startsWith(gpu)).toBe(true);
    }
    expect(SYSINFO_COMMANDS.windows.commands[0].command).toMatch(/PCSystemType -eq 2/);
    expect(SYSINFO_COMMANDS.windows.commands[0].command).toMatch(/SUBSYS_/);
    expect(SYSINFO_COMMANDS.linux.commands[0].command).toMatch(/chassis_type/);
    expect(SYSINFO_COMMANDS.linux.commands[0].command).toMatch(/pci\.sub_device_id/);
    expect(SYSINFO_COMMANDS.linux.commands[0].command).not.toMatch(/sudo/);
  });

  it("driver commands only list GPUs present now", () => {
    for (const c of SYSINFO_COMMANDS.windows.commands.filter((x) => /AMD|Intel/.test(x.label))) expect(c.command).toMatch(/\$now -contains \$_\.DriverDesc/);
  });

  it("only windows/linux have commands", () => {
    expect(commandsFor("")).toBeNull();
    expect(commandsFor("macos")).toBeNull();
    expect(commandsFor("windows")?.shell).toBe("PowerShell");
  });
});

describe("the Windows computer type line", () => {
  it("checks for handhelds before PCSystemType", () => {
    const line = SYSINFO_COMMANDS.windows.commands[0].command.split("\n")[0];
    expect(line.indexOf("'handheld'")).toBeLessThan(line.indexOf("PCSystemType"));
    expect(line).toMatch(/ROG Ally\|/);
  });
});

describe("reading the pasted output of the everything-at-once command", () => {
  it("reads a Windows PC", () => {
    const out = parseSysinfoPaste(
      [
        "Computer type: desktop",
        "GPU: NVIDIA GeForce RTX 5080 (16 GB) [board 10DE]",
        "OS version:  Windows 11 Pro 24H2",
        "CPU:         AMD Ryzen 7 9800X3D 8-Core Processor",
        "Memory (GB): 32",
        "Memory type: DDR5-6000",
        "GPU driver (NVIDIA): 581.57",
      ].join("\r\n"),
    );
    expect(out).toEqual({ os: "windows", osDetail: "Windows 11 Pro 24H2", cpu: "AMD Ryzen 7 9800X3D 8-Core Processor", memoryGb: "32", memoryType: "DDR5-6000", driver: "581.57" });
  });

  it("reads AMD's driver version on Windows", () => {
    expect(parseSysinfoPaste("OS version:  Windows 11 Home 24H2\nGPU driver (AMD):    AMD Radeon RX 9070 XT: 25.10.1").driver).toBe("25.10.1");
  });

  it("reads a Steam Machine on SteamOS, leaving out what printed blank", () => {
    const out = parseSysinfoPaste(
      [
        "Computer type: desktop",
        "GPU: Navi 33 [Radeon Graphics] (8 GB) [board 1e44]",
        "OS version:  SteamOS",
        "Distro:      SteamOS",
        "Kernel:      7.2.7-valve2-2-neptune-72-g31504582a073",
        "CPU:         AMD Custom CPU 1772",
        "Memory (GB): ",
        "Memory type: ",
        "Mesa (AMD/Intel driver): 26.1.2",
      ].join("\n"),
    );
    expect(out).toEqual({
      os: "linux", osDetail: "SteamOS", distro: "SteamOS", kernel: "7.2.7-valve2-2-neptune-72-g31504582a073", cpu: "AMD Custom CPU 1772", driver: "Mesa 26.1.2", mesa: "26.1.2",
    });
  });

  it("on Linux with NVIDIA's driver, Mesa isn't the driver", () => {
    const out = parseSysinfoPaste("OS version:  Fedora Linux 43\nKernel:      6.17.1\nGPU driver (NVIDIA): 580.95.05\nMesa (AMD/Intel driver): 25.2.4");
    expect(out.driver).toBe("580.95.05");
    expect(out.mesa).toBeUndefined();
  });

  it("ignores text that isn't the command's output", () => {
    expect(parseSysinfoPaste("hello\nworld")).toEqual({});
  });
});
