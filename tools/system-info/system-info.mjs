/**
 * System info: prints a clean, human-readable report about this machine
 * (model, OS, CPU, memory, GPU, displays, storage, network, battery, runtime).
 * No dependencies, Node.js 18+.
 *
 * Platforms: Windows (PowerShell/CIM), macOS (system_profiler, sysctl), Linux (/sys, lscpu,
 * lsblk, lspci, ...), FreeBSD/other Unix (sysctl). Anything a platform cannot report is simply
 * left out, and the Node-level basics (OS, CPU, memory, network, uptime) always work.
 * Serial numbers and MAC addresses are deliberately left out.
 *
 *   node system-info.mjs          readable report
 *   node system-info.mjs --json   same data as JSON
 */
import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// ---- helpers --------------------------------------------------------------
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
const gb = (n, digits = 1) => `${(n / 1024 ** 3).toFixed(digits)} GB`;
const bytes = (n) => {
  n = Number(n);
  if (!Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i > 2 ? 1 : 0)} ${units[i]}`;
};
const duration = (seconds) => {
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60);
  return [d && `${d}d`, (h || d) && `${h}h`, `${m}m`].filter(Boolean).join(' ');
};
const ghz = (mhz) => (Number(mhz) > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : null);
const when = (d) => { const t = d ? new Date(d) : null; return t && !Number.isNaN(+t) ? t.toLocaleString() : null; };
const day = (d) => { const t = d ? new Date(d) : null; return t && !Number.isNaN(+t) ? t.toLocaleDateString() : null; };
const read = (file) => { try { return fs.readFileSync(file, 'utf8').replace(/\0/g, '').trim(); } catch { return null; } };
const sh = (cmd, args = [], timeout = 20_000) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch { return null; }
};
const json = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const joinParts = (...parts) => clean(parts.filter(Boolean).join(' · '));
const vendorGarbage = /^(to be filled by o\.e\.m\.|default string|system manufacturer|system product name|not specified|unknown|none|o\.e\.m\.)$/i;
const meaningful = (s) => { s = clean(s); return s && !vendorGarbage.test(s) ? s : ''; };

// Every collector returns the same shape (missing parts are fine):
// { computer, os, cpu, memoryModules, gpus, drives, volumes, net, battery, tz, locale, notes }

// ---- Windows --------------------------------------------------------------
const MEMORY_TYPES = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 34: 'DDR5', 35: 'LPDDR5' };
const MEDIA = { 3: 'HDD', 4: 'SSD', 5: 'SCM' };

function collectWindows() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
function iso($d) { if ($d) { ([datetime]$d).ToString('o') } }
$vid = Get-CimInstance Win32_VideoController
$vram = @{}
Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' | ForEach-Object {
  if ($_.DriverDesc -and $_.'HardwareInformation.qwMemorySize') { $vram[$_.DriverDesc] = [double]$_.'HardwareInformation.qwMemorySize' }
}
[pscustomobject]@{
  cs   = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, SystemFamily, SystemType, Domain, PartOfDomain
  os   = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture, @{n='InstallDate';e={iso $_.InstallDate}}, @{n='LastBootUpTime';e={iso $_.LastBootUpTime}}
  bios = Get-CimInstance Win32_BIOS | Select-Object Manufacturer, SMBIOSBIOSVersion, @{n='ReleaseDate';e={iso $_.ReleaseDate}}
  board = Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer, Product
  cpu  = Get-CimInstance Win32_Processor | Select-Object Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, L2CacheSize, L3CacheSize, SocketDesignation, VirtualizationFirmwareEnabled, LoadPercentage
  ram  = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity, ConfiguredClockSpeed, Speed, Manufacturer, PartNumber, SMBIOSMemoryType)
  gpu  = @($vid | ForEach-Object { [pscustomobject]@{ Name = $_.Name; DriverVersion = $_.DriverVersion; DriverDate = (iso $_.DriverDate); AdapterRAM = $_.AdapterRAM; Vram = $vram[$_.Name]; W = $_.CurrentHorizontalResolution; H = $_.CurrentVerticalResolution; Hz = $_.CurrentRefreshRate; Bits = $_.CurrentBitsPerPixel } })
  disks = @(Get-PhysicalDisk | Select-Object FriendlyName, MediaType, BusType, Size, HealthStatus)
  vols = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace)
  net  = @(Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { [pscustomobject]@{ Name = $_.InterfaceAlias; Description = $_.InterfaceDescription; IPv4 = @($_.IPv4Address.IPAddress); Gateway = @($_.IPv4DefaultGateway.NextHop); Speed = $_.NetAdapter.LinkSpeed } })
  battery = @(Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining)
  tz   = (Get-TimeZone).DisplayName
  culture = (Get-Culture).Name
} | ConvertTo-Json -Depth 6 -Compress`;
  const out = sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], 60_000);
  const w = json(out);
  if (!w) return { notes: ['Windows detail unavailable (PowerShell query failed); showing basics only'] };
  const cpu = arr(w.cpu)[0], wo = w.os, bat = arr(w.battery)[0];
  return {
    computer: {
      Manufacturer: clean(w.cs?.Manufacturer), Model: clean(w.cs?.Model), Family: clean(w.cs?.SystemFamily),
      Motherboard: w.board ? clean(`${w.board.Manufacturer} ${w.board.Product}`) : null,
      BIOS: w.bios ? clean(`${w.bios.Manufacturer} ${w.bios.SMBIOSBIOSVersion}`) : null, 'BIOS date': day(w.bios?.ReleaseDate),
      'System type': clean(w.cs?.SystemType), Domain: w.cs?.PartOfDomain ? w.cs.Domain : null,
    },
    os: { name: clean(wo?.Caption), version: wo ? `${wo.Version} (build ${wo.BuildNumber})` : null, arch: wo?.OSArchitecture, installed: when(wo?.InstallDate), lastBoot: when(wo?.LastBootUpTime) },
    cpu: {
      name: clean(cpu?.Name), vendor: clean(cpu?.Manufacturer), cores: cpu?.NumberOfCores, threads: cpu?.NumberOfLogicalProcessors,
      max: ghz(cpu?.MaxClockSpeed), l2: cpu?.L2CacheSize ? bytes(cpu.L2CacheSize * 1024) : null, l3: cpu?.L3CacheSize ? bytes(cpu.L3CacheSize * 1024) : null,
      socket: clean(cpu?.SocketDesignation),
      virtualization: cpu?.VirtualizationFirmwareEnabled == null ? null : cpu.VirtualizationFirmwareEnabled ? 'Enabled' : 'Disabled',
      load: cpu?.LoadPercentage != null ? `${cpu.LoadPercentage}%` : null,
    },
    memoryModules: arr(w.ram).map((m) => joinParts(gb(m.Capacity, 0), MEMORY_TYPES[m.SMBIOSMemoryType], (m.ConfiguredClockSpeed || m.Speed) && `${m.ConfiguredClockSpeed || m.Speed} MT/s`, clean(m.Manufacturer), clean(m.PartNumber))),
    gpus: arr(w.gpu).map((g) => {
      const vram = g.Vram || g.AdapterRAM;
      return { Name: clean(g.Name), Memory: vram ? gb(vram, vram >= 1024 ** 3 ? 0 : 1) : null, Driver: clean(g.DriverVersion), 'Driver date': day(g.DriverDate), Display: g.W ? `${g.W}×${g.H} @ ${g.Hz} Hz, ${g.Bits}-bit` : 'No display attached' };
    }),
    drives: arr(w.disks).map((d) => joinParts(d.FriendlyName, bytes(d.Size), MEDIA[d.MediaType] || d.MediaType, d.BusType, d.HealthStatus)),
    volumes: arr(w.vols).map((v) => `${v.DeviceID} ${v.VolumeName ? `"${v.VolumeName}" ` : ''}· ${v.FileSystem} · ${bytes(v.FreeSpace)} free of ${bytes(v.Size)}`),
    net: arr(w.net).map((n) => ({ Adapter: clean(n.Name), Device: clean(n.Description), IPv4: arr(n.IPv4).join(', '), Gateway: arr(n.Gateway).join(', '), Speed: clean(n.Speed) })),
    battery: bat ? `${bat.EstimatedChargeRemaining}%` : null,
    tz: w.tz, locale: w.culture,
  };
}

// ---- Linux ----------------------------------------------------------------
const kv = (text, sep = ':') => {
  const out = {};
  for (const line of (text || '').split('\n')) {
    const i = line.indexOf(sep);
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
};
const cacheSize = (s) => (s ? s.replace(/\s*\(.*\)\s*$/, '') : null);

/** Parse `lscpu` text output (stable key: value format). */
export function parseLscpu(text) {
  const l = kv(text);
  const sockets = Number(l['Socket(s)']) || 1, perSocket = Number(l['Core(s) per socket']) || 0, perCore = Number(l['Thread(s) per core']) || 1;
  return {
    name: l['Model name'], vendor: l['Vendor ID'], cores: perSocket ? sockets * perSocket : null,
    threads: Number(l['CPU(s)']) || (perSocket ? sockets * perSocket * perCore : null),
    max: ghz(parseFloat(l['CPU max MHz'])), l2: cacheSize(l['L2 cache']), l3: cacheSize(l['L3 cache']),
    virtualization: l.Virtualization || null,
  };
}

/** Parse `lsblk -J -b -o NAME,MODEL,SIZE,ROTA,TRAN,TYPE` into readable drive lines. */
export function parseLsblk(text) {
  return arr(json(text)?.blockdevices).filter((d) => d.type === 'disk').map((d) => {
    const rotational = d.rota === true || d.rota === '1' || d.rota === 1;
    const nvme = d.tran === 'nvme' || /^nvme/.test(d.name);
    return joinParts(clean(d.model) || d.name, bytes(d.size), nvme ? 'SSD' : rotational ? 'HDD' : 'SSD', d.tran && String(d.tran).toUpperCase());
  });
}

const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'ntfs', 'ntfs3', 'fuseblk', 'vfat', 'exfat', 'apfs', 'hfs', 'ufs', 'reiserfs', 'jfs']);
/** Parse `df -P -T -B1` into readable volume lines (real filesystems only, one per device). */
export function parseDf(text) {
  const seen = new Set(), out = [];
  for (const line of (text || '').split('\n').slice(1)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 7 || !REAL_FS.has(p[1]) || seen.has(p[0])) continue;
    const mount = p.slice(6).join(' ');
    if (/^\/(snap|var\/lib\/(docker|snapd)|run)\b/.test(mount)) continue;
    seen.add(p[0]);
    out.push(`${mount} · ${p[1]} · ${bytes(p[4])} free of ${bytes(p[2])} · ${p[0]}`);
  }
  return out;
}

/** Parse the default route line of `ip route show default`. */
export function parseIpRoute(text) {
  const m = /default via (\S+)(?: dev (\S+))?/.exec(text || '');
  return m ? { gateway: m[1], dev: m[2] } : null;
}

function networkFromNode(route) {
  return Object.entries(os.networkInterfaces()).flatMap(([name, list]) => arr(list)
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => ({ Adapter: name, IPv4: a.address, Gateway: route && (!route.dev || route.dev === name) ? route.gateway : null })));
}

function collectLinux() {
  const dmi = (f) => meaningful(read(`/sys/class/dmi/id/${f}`));
  const tree = meaningful(read('/proc/device-tree/model') || read('/sys/firmware/devicetree/base/model')); // ARM boards, Raspberry Pi
  const osr = kv(read('/etc/os-release') || '', '=');
  const unq = (s) => (s ? s.replace(/^"|"$/g, '') : null);
  const wsl = /microsoft/i.test(os.release()) || /microsoft/i.test(read('/proc/version') || '');
  const lscpu = parseLscpu(sh('lscpu'));
  const cpuinfo = kv(read('/proc/cpuinfo') || '');
  const cpuName = lscpu.name || cpuinfo['model name'] || cpuinfo.Model || cpuinfo.Hardware || os.cpus()[0]?.model;

  // GPUs: lspci for names, nvidia-smi for NVIDIA memory/driver, DRM or xrandr for displays.
  const gpus = [];
  for (const line of (sh('lspci', ['-mm']) || '').split('\n')) {
    const m = /^\S+\s+"(VGA compatible controller|3D controller|Display controller)"\s+"([^"]*)"\s+"([^"]*)"/.exec(line);
    if (m) gpus.push({ Name: clean(`${m[2]} ${m[3]}`) });
  }
  const nv = (sh('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits']) || '').split('\n').filter(Boolean);
  for (const line of nv) {
    const [name, mem, driver] = line.split(',').map((s) => s.trim());
    const g = gpus.find((x) => x.Name.toLowerCase().includes(name.replace(/^NVIDIA\s+/i, '').toLowerCase().slice(0, 12))) || gpus.find((x) => /nvidia/i.test(x.Name));
    const target = g || (gpus.push({ Name: name }), gpus[gpus.length - 1]);
    target.Name = name; target.Memory = gb(Number(mem) * 1024 ** 2, 0); target.Driver = driver;
  }
  const screens = (sh('xrandr', ['--current']) || '').split('\n').filter((l) => /\sconnected/.test(l)).map((l) => {
    const m = /^(\S+) connected(?: primary)? (\d+x\d+)/.exec(l);
    return m ? `${m[1]}: ${m[2].replace('x', '×')}` : null;
  }).filter(Boolean);
  if (gpus.length && screens.length) gpus[0].Display = screens.join('; ');

  const battery = (() => {
    try {
      for (const d of fs.readdirSync('/sys/class/power_supply')) {
        if (!/^BAT/i.test(d)) continue;
        const cap = read(`/sys/class/power_supply/${d}/capacity`), st = read(`/sys/class/power_supply/${d}/status`);
        if (cap) return `${cap}%${st ? ` (${st.toLowerCase()})` : ''}`;
      }
    } catch { /* no battery */ }
    return null;
  })();

  // Memory modules need root (dmidecode); silently skipped when unavailable.
  const modules = (sh('dmidecode', ['-t', 'memory']) || '').split(/\n\n/).filter((b) => /Memory Device/.test(b) && /Size: \d/.test(b)).map((b) => {
    const f = kv(b);
    return joinParts(f.Size, f.Type, (f['Configured Memory Speed'] || f.Speed) && (f['Configured Memory Speed'] || f.Speed), meaningful(f.Manufacturer), meaningful(f['Part Number']));
  });

  return {
    computer: {
      Manufacturer: dmi('sys_vendor'), Model: tree || dmi('product_name') || dmi('product_version'), Family: dmi('product_family'),
      Motherboard: dmi('board_name') ? clean(`${dmi('board_vendor')} ${dmi('board_name')}`) : null,
      BIOS: dmi('bios_vendor') ? clean(`${dmi('bios_vendor')} ${dmi('bios_version')}`) : null, 'BIOS date': dmi('bios_date'),
      'System type': os.arch(),
    },
    os: {
      name: `${unq(osr.PRETTY_NAME) || 'Linux'}${wsl ? ' (WSL)' : ''}`, version: `Kernel ${os.release()}`, arch: os.arch(),
      installed: null, lastBoot: when(Date.now() - os.uptime() * 1000),
    },
    cpu: { ...lscpu, name: cpuName, threads: lscpu.threads || os.cpus().length, max: lscpu.max || ghz(os.cpus()[0]?.speed) },
    memoryModules: modules,
    gpus,
    drives: parseLsblk(sh('lsblk', ['-J', '-b', '-o', 'NAME,MODEL,SIZE,ROTA,TRAN,TYPE'])),
    volumes: parseDf(sh('df', ['-P', '-T', '-B1'])),
    net: networkFromNode(parseIpRoute(sh('ip', ['route', 'show', 'default']))),
    battery,
  };
}

// ---- macOS ----------------------------------------------------------------
const sysctl = (key) => { const v = sh('sysctl', ['-n', key]); return v ? v.trim() : null; };

/** Turn `system_profiler ... -json` output into the pieces we show. */
export function parseMacProfiler(text) {
  const p = json(text) || {};
  const hw = arr(p.SPHardwareDataType)[0] || {};
  const gpus = arr(p.SPDisplaysDataType).map((g) => {
    const displays = arr(g.spdisplays_ndrvs).map((d) => `${d._name}: ${d._spdisplays_resolution || d._spdisplays_pixels || ''}`.replace(/ x /g, '×'));
    const vram = [g.spdisplays_vram, g.spdisplays_vram_shared].find((v) => /\d/.test(v || ''));
    return {
      Name: clean(g.sppci_model || g._name), Memory: vram ? clean(String(vram).replace(/\s*\(.*\)/, '')) : null,
      Cores: g.sppci_cores ? `${g.sppci_cores} GPU cores` : null, Display: displays.join('; ') || null,
    };
  });
  const modules = [];
  for (const m of arr(p.SPMemoryDataType)) {
    const dimms = arr(m._items);
    if (dimms.length) for (const d of dimms) modules.push(joinParts(d.dimm_size, d.dimm_type, d.dimm_speed, meaningful(d.dimm_manufacturer), meaningful(d.dimm_part_number)));
    else modules.push(joinParts(m.SPMemoryDataType, m.dimm_type, meaningful(m.dimm_manufacturer), 'unified memory'));
  }
  const storage = arr(p.SPStorageDataType);
  const drives = [...new Set(storage.map((v) => v.physical_drive?.device_name && joinParts(v.physical_drive.device_name, v.physical_drive.medium_type, v.physical_drive.protocol)).filter(Boolean))];
  const volumes = storage.filter((v) => v.mount_point === '/' || /^\/Volumes\//.test(v.mount_point || '')).map((v) =>
    `${v.mount_point} ${v._name ? `"${v._name}" ` : ''}· ${v.file_system || '?'} · ${bytes(v.free_space_in_bytes)} free of ${bytes(v.size_in_bytes)}`);
  return { hw, gpus, modules, drives, volumes };
}

function collectMac() {
  const prof = parseMacProfiler(sh('system_profiler', ['SPHardwareDataType', 'SPDisplaysDataType', 'SPMemoryDataType', 'SPStorageDataType', '-json'], 60_000));
  const hw = prof.hw;
  const swv = kv(sh('sw_vers') || '');
  const perf = sysctl('hw.perflevel0.physicalcpu'), eff = sysctl('hw.perflevel1.physicalcpu');
  const cores = Number(sysctl('hw.physicalcpu')) || null;
  const route = sh('route', ['-n', 'get', 'default']) || '';
  const gw = /gateway:\s*(\S+)/.exec(route)?.[1], dev = /interface:\s*(\S+)/.exec(route)?.[1];
  const batt = /(\d+)%;?\s*([\w ]+)?/.exec(sh('pmset', ['-g', 'batt']) || '');
  const boot = /sec = (\d+)/.exec(sysctl('kern.boottime') || '')?.[1];
  const cpuName = sysctl('machdep.cpu.brand_string') || hw.chip_type || hw.cpu_type || os.cpus()[0]?.model;
  return {
    computer: {
      Model: clean(hw.machine_name), 'Model identifier': clean(hw.machine_model), 'Model number': clean(hw.model_number),
      Chip: clean(hw.chip_type), 'System type': os.arch(),
    },
    os: { name: `${swv.ProductName || 'macOS'} ${swv.ProductVersion || ''}`.trim(), version: swv.BuildVersion ? `Build ${swv.BuildVersion} · Darwin ${os.release()}` : `Darwin ${os.release()}`, arch: os.arch(), lastBoot: boot ? when(Number(boot) * 1000) : when(Date.now() - os.uptime() * 1000) },
    cpu: {
      name: cpuName, vendor: sysctl('machdep.cpu.vendor'),
      cores: cores && perf && eff ? `${cores} (${perf} performance + ${eff} efficiency)` : cores,
      threads: Number(sysctl('hw.logicalcpu')) || os.cpus().length,
      max: ghz(Number(sysctl('hw.cpufrequency_max')) / 1e6) || ghz(os.cpus()[0]?.speed),
      l2: Number(sysctl('hw.l2cachesize')) ? bytes(sysctl('hw.l2cachesize')) : null, l3: Number(sysctl('hw.l3cachesize')) ? bytes(sysctl('hw.l3cachesize')) : null,
    },
    memoryModules: prof.modules, gpus: prof.gpus, drives: prof.drives, volumes: prof.volumes,
    net: networkFromNode(gw ? { gateway: gw, dev } : null),
    battery: batt ? `${batt[1]}%${batt[2] ? ` (${clean(batt[2])})` : ''}` : null,
  };
}

// ---- FreeBSD and other Unix -----------------------------------------------
function collectOtherUnix() {
  return {
    computer: { Model: sysctl('hw.product') || sysctl('hw.model'), 'System type': os.arch() },
    os: { name: `${os.type()} ${os.release()}`, version: os.version(), arch: os.arch(), lastBoot: when(Date.now() - os.uptime() * 1000) },
    cpu: { name: sysctl('hw.model') || os.cpus()[0]?.model, threads: Number(sysctl('hw.ncpu')) || os.cpus().length, max: ghz(os.cpus()[0]?.speed) },
    volumes: parseDf(sh('df', ['-P', '-T', '-B1'])),
    net: networkFromNode(null),
  };
}

// ---- assemble -------------------------------------------------------------
export function gather() {
  const platform = process.platform;
  let d;
  try {
    d = platform === 'win32' ? collectWindows() : platform === 'darwin' ? collectMac() : platform === 'linux' ? collectLinux() : collectOtherUnix();
  } catch (error) { d = { notes: [`Detailed query failed: ${error.message.split('\n')[0]}`] }; }

  const cpus = os.cpus(), used = os.totalmem() - os.freemem(), intl = Intl.DateTimeFormat().resolvedOptions();
  const c = d.cpu || {};
  return {
    Computer: { Name: os.hostname(), ...d.computer, User: os.userInfo().username },
    'Operating system': {
      Name: d.os?.name || `${os.type()} ${os.release()}`, Version: d.os?.version || os.version(), Architecture: d.os?.arch || os.arch(),
      Installed: d.os?.installed, 'Last boot': d.os?.lastBoot, Uptime: duration(os.uptime()),
    },
    Processor: {
      Name: clean(c.name || cpus[0]?.model), Vendor: c.vendor, Cores: c.cores, Threads: c.threads || cpus.length, 'Max clock': c.max,
      'L2 cache': c.l2, 'L3 cache': c.l3, Socket: c.socket, Virtualization: c.virtualization, 'Load now': c.load,
    },
    Memory: { Total: gb(os.totalmem()), 'In use': `${gb(used)} (${Math.round(used / os.totalmem() * 100)}%)`, Available: gb(os.freemem()), Modules: d.memoryModules },
    Graphics: arr(d.gpus),
    Storage: { Drives: d.drives, Volumes: d.volumes },
    Network: arr(d.net),
    Power: { Battery: d.battery || 'None (desktop or not detected)' },
    Runtime: {
      Platform: `${process.platform} / ${process.arch}`, Node: process.version, V8: process.versions.v8,
      Shell: process.env.SHELL || process.env.ComSpec, 'Home folder': os.homedir(), 'Temp folder': os.tmpdir(),
    },
    Region: { 'Time zone': d.tz || intl.timeZone, Locale: d.locale || intl.locale, Now: new Date().toLocaleString() },
    _notes: d.notes,
  };
}

// ---- render ---------------------------------------------------------------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export function render(info) {
  const lines = [];
  const title = ' SYSTEM INFORMATION ';
  lines.push('', paint('1;36', `╔${'═'.repeat(title.length + 2)}╗`), paint('1;36', `║ ${title} ║`), paint('1;36', `╚${'═'.repeat(title.length + 2)}╝`));
  const block = (name, data) => {
    const entries = Object.entries(data).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
    if (!entries.length) return;
    lines.push('', paint('1;33', `▸ ${name}`), paint('90', `  ${'─'.repeat(58)}`));
    const width = Math.max(...entries.map(([k]) => k.length));
    for (const [key, value] of entries) {
      const [first, ...rest] = arr(value);
      lines.push(`  ${paint('36', key.padEnd(width))}  ${first}`);
      for (const extra of rest) lines.push(`  ${' '.repeat(width)}  ${extra}`);
    }
  };
  for (const [name, data] of Object.entries(info)) {
    if (name.startsWith('_')) continue;
    if (Array.isArray(data)) data.forEach((item, i) => block(data.length > 1 ? `${name} ${i + 1}` : name, item));
    else block(name, data);
  }
  for (const note of arr(info._notes)) lines.push('', paint('31', `! ${note}`));
  lines.push('');
  return lines.join('\n');
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = gather();
  console.log(process.argv.includes('--json') ? JSON.stringify(info, null, 2) : render(info));
}
