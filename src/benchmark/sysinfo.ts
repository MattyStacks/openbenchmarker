import type { SystemInfo } from "./types";

/**
 * Read-only commands the user can run themselves to look up the values they type into the
 * results form. The page never runs them and never reads their output: values are still
 * provided (pasted) by the user.
 */
export interface InfoCommand {
  /** Form field the output belongs in, or "gpu" for help picking the catalog entry. */
  field: keyof SystemInfo | "gpu";
  label: string;
  command: string;
  note?: string;
}

export interface OsCommands {
  shell: string;
  howToOpen: string;
  commands: InfoCommand[];
  /** One paste that prints every value, labelled. */
  all: string;
}

const WIN_GPU_KEY = String.raw`HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*`;
const WIN_CV_KEY = String.raw`HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion`;
const WIN_MEM_TYPES = "@{20='DDR';21='DDR2';24='DDR3';26='DDR4';30='LPDDR4';34='DDR5';35='LPDDR5'}";

const MEM_CHANNELS_NOTE = "No command reads this reliably. Most desktops run 2 (dual channel) with two or four sticks, and 1 with a single stick. CPU-Z's Memory tab (Windows) or your motherboard manual tells you for sure.";

const WIN = {
  gpu: `Get-ItemProperty '${WIN_GPU_KEY}' -ErrorAction SilentlyContinue | Where-Object { $_.'HardwareInformation.qwMemorySize' } | ForEach-Object { "$($_.DriverDesc) ($([math]::Round($_.'HardwareInformation.qwMemorySize' / 1GB)) GB)" }`,
  osDetail: `$os = Get-CimInstance Win32_OperatingSystem; "$($os.Caption -replace '^Microsoft ','') $((Get-ItemProperty '${WIN_CV_KEY}').DisplayVersion)".Trim()`,
  cpu: `(Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()`,
  memoryGb: `[math]::Round((Get-CimInstance Win32_PhysicalMemory | Measure-Object Capacity -Sum).Sum / 1GB)`,
  memoryType: `$m = Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1; "$(${WIN_MEM_TYPES}[[int]$m.SMBIOSMemoryType])-$($m.ConfiguredClockSpeed)"`,
  driver: `nvidia-smi --query-gpu=name,driver_version --format=csv,noheader`,
  // AMD's installer records the AMD Software (Adrenalin) version next to Windows' own number.
  driverAmd: `Get-ItemProperty '${WIN_GPU_KEY}' -ErrorAction SilentlyContinue | Where-Object { $_.RadeonSoftwareVersion } | ForEach-Object { "$($_.DriverDesc): $($_.RadeonSoftwareVersion)" }`,
  // Intel publishes its drivers under Windows' own version number.
  driverIntel: `Get-ItemProperty '${WIN_GPU_KEY}' -ErrorAction SilentlyContinue | Where-Object { $_.ProviderName -match 'Intel' -and $_.DriverDesc } | ForEach-Object { "$($_.DriverDesc): $($_.DriverVersion)" }`,
};

/**
 * The Mesa version (AMD and Intel's driver on Linux). glxinfo isn't installed by default, so this
 * falls back to the installed package: Debian/Ubuntu, Fedora/openSUSE, then Arch. Package epochs
 * and suffixes are stripped (1:24.2.5-1 and 24.2.5-1ubuntu1 become 24.2.5).
 */
const LINUX_MESA = `{ glxinfo -B 2>/dev/null | grep -o 'Mesa [0-9][0-9.]*' | cut -d' ' -f2; dpkg-query -W -f='\${Version}\\n' libglx-mesa0 2>/dev/null; rpm -q --qf '%{VERSION}\\n' mesa-dri-drivers Mesa-dri 2>/dev/null; pacman -Q mesa 2>/dev/null | cut -d' ' -f2; } | grep -m1 '^[0-9]' | sed 's/^[0-9]*://; s/[-+~].*//'`;

const LINUX = {
  gpu: `lspci | grep -Ei 'vga|3d|display'; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null`,
  osDetail: `. /etc/os-release && echo "$PRETTY_NAME"`,
  distro: `. /etc/os-release && echo "$NAME"`,
  kernel: `uname -r`,
  cpu: `grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ //'`,
  memoryGb: `sudo dmidecode -t 17 | awk '/^\\tSize: [0-9]+ GB/ {s+=$2} /^\\tSize: [0-9]+ MB/ {s+=$2/1024} END {print s}'`,
  memoryType: `sudo dmidecode -t 17 | awk -F': ' '/^\\tType: (LP)?DDR/ {t=$2} /^\\tConfigured Memory Speed: [0-9]/ {s=$2+0} END {if (t) print t "-" s}'`,
  driver: `nvidia-smi --query-gpu=driver_version --format=csv,noheader`,
  driverMesa: `${LINUX_MESA} | sed 's/^/Mesa /'`,
  mesa: LINUX_MESA,
};

export const SYSINFO_COMMANDS: Record<"windows" | "linux", OsCommands> = {
  windows: {
    shell: "PowerShell",
    howToOpen: "Right-click Start → Terminal (or Windows PowerShell), paste, press Enter.",
    commands: [
      { field: "gpu", label: "GPU and VRAM (to pick the catalog entry)", command: WIN.gpu },
      { field: "osDetail", label: "OS version", command: WIN.osDetail },
      { field: "cpu", label: "CPU", command: WIN.cpu },
      { field: "memoryGb", label: "Memory (GB)", command: WIN.memoryGb, note: "Installed RAM, summed across all modules." },
      { field: "memoryType", label: "Memory type", command: WIN.memoryType, note: "Type and the speed it is running at (e.g. DDR5-6000). If the type comes back blank, check the module label or your BIOS." },
      { field: "memoryChannels", label: "Memory channels", command: "", note: MEM_CHANNELS_NOTE },
      {
        field: "driver",
        label: "GPU driver (NVIDIA)",
        command: WIN.driver,
        note: "Prints e.g. 561.09. Windows' own number for NVIDIA drivers (e.g. 32.0.15.6109) is not the version NVIDIA publishes.",
      },
      { field: "driver", label: "GPU driver (AMD)", command: WIN.driverAmd, note: "Prints the AMD Software (Adrenalin) version, e.g. 24.10.1, also shown in AMD Software under System." },
      { field: "driver", label: "GPU driver (Intel)", command: WIN.driverIntel, note: "Prints e.g. 32.0.101.6083. Intel publishes its drivers under this same number, also shown in Intel Graphics Software." },
    ],
    all: [
      `"GPU:         " + ((${WIN.gpu}) -join '; ')`,
      `${WIN.osDetail.replace('"$(', '"OS version:  $(')}`,
      `"CPU:         " + ${WIN.cpu}`,
      `"Memory (GB): " + ${WIN.memoryGb}`,
      `${WIN.memoryType.replace('"$(', '"Memory type: $(')}`,
      `if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { "GPU driver (NVIDIA): " + (nvidia-smi --query-gpu=driver_version --format=csv,noheader) }`,
      `(${WIN.driverAmd}) | ForEach-Object { "GPU driver (AMD):    $_" }`,
      `(${WIN.driverIntel}) | ForEach-Object { "GPU driver (Intel):  $_" }`,
    ].join("\n"),
  },
  linux: {
    shell: "Terminal (bash)",
    howToOpen: "Open a terminal, paste, press Enter. Memory commands use sudo to read DMI tables.",
    commands: [
      { field: "gpu", label: "GPU (to pick the catalog entry)", command: LINUX.gpu },
      { field: "osDetail", label: "OS version", command: LINUX.osDetail },
      { field: "distro", label: "Distro", command: LINUX.distro },
      { field: "kernel", label: "Kernel", command: LINUX.kernel },
      { field: "cpu", label: "CPU", command: LINUX.cpu },
      {
        field: "memoryGb",
        label: "Memory (GB)",
        command: LINUX.memoryGb,
        note: "Without sudo, awk '/MemTotal/ {printf \"%d\\n\", $2/1048576 + 0.5}' /proc/meminfo works but reads a little under what is installed.",
      },
      { field: "memoryType", label: "Memory type", command: LINUX.memoryType, note: "Prints e.g. DDR5-6000." },
      { field: "memoryChannels", label: "Memory channels", command: "", note: MEM_CHANNELS_NOTE },
      { field: "driver", label: "GPU driver (NVIDIA)", command: LINUX.driver, note: "The NVIDIA proprietary driver, e.g. 560.35.03." },
      {
        field: "driver",
        label: "GPU driver (AMD/Intel)",
        command: LINUX.driverMesa,
        note: "AMD and Intel GPUs (Arc included) use Mesa on Linux, so the driver version is the Mesa version, e.g. Mesa 24.2.5. Works without glxinfo: it falls back to the installed Mesa package.",
      },
      { field: "mesa", label: "Mesa", command: LINUX.mesa, note: "Same Mesa version, without the word Mesa. Leave blank on the NVIDIA proprietary driver." },
      { field: "proton", label: "Proton", command: "", note: "Not applicable: Proton runs Windows games through Steam, and this benchmark runs in your browser. Leave blank." },
    ],
    all: [
      `echo "GPU:         $(lspci 2>/dev/null | grep -Ei 'vga|3d|display' | cut -d: -f3- | sed 's/^ //' | paste -sd ';')"`,
      `echo "GPU (NVIDIA): $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null)"`,
      `echo "OS version:  $(${LINUX.osDetail})"`,
      `echo "Distro:      $(${LINUX.distro})"`,
      `echo "Kernel:      $(${LINUX.kernel})"`,
      `echo "CPU:         $(${LINUX.cpu})"`,
      `echo "Memory (GB): $(${LINUX.memoryGb})"`,
      `echo "Memory type: $(${LINUX.memoryType})"`,
      `command -v nvidia-smi >/dev/null && echo "GPU driver (NVIDIA): $(${LINUX.driver})"`,
      `echo "Mesa (AMD/Intel driver): $(${LINUX.mesa})"`,
    ].join("\n"),
  },
};

export function commandsFor(os: string): OsCommands | null {
  return os === "windows" || os === "linux" ? SYSINFO_COMMANDS[os] : null;
}
