// Runs the Linux command's computer-type line in bash. Plain JS: tsconfig has no Node types.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSINFO_COMMANDS } from "../src/benchmark/sysinfo";

describe("the computer type line", () => {
  // The first line of the Linux GPU command, run by bash against a fake /sys/class/dmi/id.
  const linuxType = (dmi) => {
    const dir = mkdtempSync(join(tmpdir(), "dmi-"));
    for (const [k, v] of Object.entries(dmi)) writeFileSync(join(dir, k), `${v}\n`);
    const line = SYSINFO_COMMANDS.linux.commands[0].command.split("\n")[0].replaceAll("/sys/class/dmi/id", dir);
    return execFileSync("bash", ["-c", line], { encoding: "utf8" }).trim();
  };

  it.runIf(process.platform !== "win32")("tells Valve's machines and handhelds from laptops on Linux", () => {
    // The Steam Machine reports chassis type 10 (notebook).
    expect(linuxType({ sys_vendor: "Valve", product_name: "Fremont", product_family: "HawkPoint", chassis_type: "10" })).toBe("Computer type: desktop");
    expect(linuxType({ sys_vendor: "Valve", product_name: "Jupiter", chassis_type: "31" })).toBe("Computer type: handheld");
    expect(linuxType({ sys_vendor: "ASUSTeK COMPUTER INC.", product_name: "ROG Ally RC71L_RC71L", chassis_type: "31" })).toBe("Computer type: handheld");
    expect(linuxType({ sys_vendor: "LENOVO", product_name: "82JW", product_family: "Legion 5 15ACH6H", chassis_type: "10" })).toBe("Computer type: laptop");
    expect(linuxType({ sys_vendor: "Micro-Star International Co., Ltd.", product_name: "MS-7E26", chassis_type: "3" })).toBe("Computer type: desktop");
  });

});
