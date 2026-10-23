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
  driverOther: `Get-ItemProperty '${WIN_GPU_KEY}' -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc } | ForEach-Object { "$($_.DriverDesc): $($_.DriverVersion)" }`,
};

const LINUX = {
  gpu: `lspci | grep -Ei 'vga|3d|display'; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null`,
  osDetail: `. /etc/os-release && echo "$PRETTY_NAME"`,
  distro: `. /etc/os-release && echo "$NAME"`,
  kernel: `uname -r`,
  cpu: `grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ //'`,
  memoryGb: `sudo dmidecode -t 17 | awk '/^\\tSize: [0-9]+ GB/ {s+=$2} /^\\tSize: [0-9]+ MB/ {s+=$2/1024} END {print s}'`,
  memoryType: `sudo dmidecode -t 17 | awk -F': ' '/^\\tType: (LP)?DDR/ {t=$2} /^\\tConfigured Memory Speed: [0-9]/ {s=$2+0} END {if (t) print t "-" s}'`,
  driver: `nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null || glxinfo -B | grep -o 'Mesa [0-9.]*' | head -1`,
  mesa: `glxinfo -B | grep -o 'Mesa [0-9.]*' | head -1 | cut -d' ' -f2`,
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
        note: "AMD/Intel: use the version shown in AMD Software or Intel Graphics Software. Windows' own number (e.g. 32.0.16.1714) is not the vendor's driver version.",
      },
    ],
    all: [
      `"GPU:         " + ((${WIN.gpu}) -join '; ')`,
      `${WIN.osDetail.replace('"$(', '"OS version:  $(')}`,
      `"CPU:         " + ${WIN.cpu}`,
      `"Memory (GB): " + ${WIN.memoryGb}`,
      `${WIN.memoryType.replace('"$(', '"Memory type: $(')}`,
      `"GPU driver:  " + $(if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { nvidia-smi --query-gpu=driver_version --format=csv,noheader } else { "no nvidia-smi; AMD/Intel: use the version in AMD Software / Intel Graphics Software" })`,
      `"Windows driver versions (not vendor versions): " + ((${WIN.driverOther}) -join '; ')`,
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
      { field: "driver", label: "GPU driver", command: LINUX.driver, note: "NVIDIA proprietary prints its version; otherwise the Mesa version (glxinfo is in mesa-utils / mesa-demos)." },
      { field: "mesa", label: "Mesa", command: LINUX.mesa, note: "Leave blank on the NVIDIA proprietary driver." },
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
      `echo "GPU driver:  $(${LINUX.driver})"`,
      `echo "Mesa:        $(${LINUX.mesa} 2>/dev/null)"`,
    ].join("\n"),
  },
};

export function commandsFor(os: string): OsCommands | null {
  return os === "windows" || os === "linux" ? SYSINFO_COMMANDS[os] : null;
}
