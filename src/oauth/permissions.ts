import childProcess from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  OAuthError,
  type OAuthConfig,
  type OAuthStorageDiagnosticCode,
} from "./types.js";

const MAX_CONFIGURED_PATH_LENGTH = 1_024;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const KEY_ALLOWED_MODES = new Set([0o400, 0o600]);

type PathEntry = { path: string; kind: "ancestor" | "data" | "key" | "store" | "marker" };

export type StorageObjectIdentity = Readonly<{ device: bigint; fileId: bigint }>;
export type StoragePermissionReceipt = Readonly<{
  keyFile?: StorageObjectIdentity;
  storeFile?: StorageObjectIdentity;
  recoveryMarkerFile?: StorageObjectIdentity;
}>;

const WINDOWS_ACL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$kind = 'ancestor'
try {
  $entries = $env:ETSY_OAUTH_ACL_PATHS -split ([string][char]10)
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $userSid = $identity.User.Value
  $allowedSids = @($userSid, 'S-1-5-18', 'S-1-5-32-544')
  $identitySource = @"
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class EtsyOAuthStorageIdentity {
  [StructLayout(LayoutKind.Sequential)]
  public struct Info {
    public uint FileAttributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool GetVolumePathName(string fileName, System.Text.StringBuilder volumePathName, uint bufferLength);
}
"@
  Add-Type -TypeDefinition $identitySource -ErrorAction Stop
  function Get-StorageObjectIdentity([string]$target, [bool]$isDirectory, [string]$kind) {
    $flags = [uint32]0x00200000
    if ($isDirectory) { $flags = $flags -bor [uint32]0x02000000 }
    $handle = [EtsyOAuthStorageIdentity]::CreateFile($target, 0x80, 7, [IntPtr]::Zero, 3, $flags, [IntPtr]::Zero)
    if ($handle.IsInvalid) { throw "DENY|$kind|object_identity_unavailable" }
    try {
      $info = New-Object EtsyOAuthStorageIdentity+Info
      if (-not [EtsyOAuthStorageIdentity]::GetFileInformationByHandle($handle, [ref]$info)) {
        throw "DENY|$kind|object_identity_unavailable"
      }
      if (($info.FileAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "DENY|$kind|reparse_point"
      }
      $volume = $info.VolumeSerialNumber.ToString('x8', [System.Globalization.CultureInfo]::InvariantCulture)
      $fileId = (([uint64]$info.FileIndexHigh -shl 32) -bor [uint64]$info.FileIndexLow)
      $fileIdText = $fileId.ToString('x16', [System.Globalization.CultureInfo]::InvariantCulture)
      return [pscustomobject]@{ Volume = $volume; FileId = $fileIdText }
    } finally {
      $handle.Dispose()
    }
  }
  $receipts = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in $entries) {
    $parts = $entry.TrimEnd([char]13) -split ([string][char]9), 2
    if ($parts.Count -ne 2) { throw 'entry' }
    $kind = [string]$parts[0]
    $target = [string]$parts[1]
    if (@('ancestor', 'data', 'key', 'store', 'marker') -notcontains $kind) { throw 'kind' }
    $item = Get-Item -LiteralPath $target -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "DENY|$kind|reparse_point"
    }
    $drive = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($target))
    if ($drive.DriveType -ne [System.IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') {
      throw "DENY|$kind|filesystem_unsupported"
    }
    $isDirectory = $item.PSIsContainer
    $volumeRootPath = New-Object System.Text.StringBuilder 1024
    if (-not [EtsyOAuthStorageIdentity]::GetVolumePathName($target, $volumeRootPath, [uint32]$volumeRootPath.Capacity)) {
      throw "DENY|$kind|acl_inspection_unavailable"
    }
    $targetRootComparison = [System.IO.Path]::GetFullPath($target).TrimEnd([char[]]@([char]92, [char]47))
    $volumeRootComparison = $volumeRootPath.ToString().TrimEnd([char[]]@([char]92, [char]47))
    $isVolumeRoot = $isDirectory -and [string]::Equals($targetRootComparison, $volumeRootComparison, [System.StringComparison]::OrdinalIgnoreCase)
    $identityBefore = $null
    if ($kind -eq 'key' -or $kind -eq 'store' -or $kind -eq 'marker') {
      $identityBefore = Get-StorageObjectIdentity $target $isDirectory $kind
    }
    $acl = Get-Acl -LiteralPath $target
    $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    $isLeaf = ($kind -eq 'data' -or $kind -eq 'key' -or $kind -eq 'store' -or $kind -eq 'marker')
    if ($allowedSids -notcontains $ownerSid) {
      $ownerCode = if ($isLeaf) { 'untrusted_leaf_owner' } else { 'untrusted_ancestor_owner' }
      throw "DENY|$kind|$ownerCode"
    }
    $userRights = [int]0
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
      $sid = $rule.IdentityReference.Value
      $rights = [int]$rule.FileSystemRights
      $appliesToCurrent = (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0)
      $inheritanceFlags = [int]$rule.InheritanceFlags
      $propagatesToChild = $isDirectory -and $inheritanceFlags -ne 0
      $relevantToLeaf = $appliesToCurrent -or ($kind -eq 'data' -and $propagatesToChild)
      if ($isLeaf) {
        if ($relevantToLeaf -and $allowedSids -notcontains $sid) {
          throw "DENY|$kind|untrusted_leaf_acl"
        }
        if ($relevantToLeaf -and $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny) {
          throw "DENY|$kind|untrusted_leaf_acl"
        }
        if ($appliesToCurrent -and $sid -eq $userSid -and $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
          $userRights = $userRights -bor $rights
        }
      } elseif ($appliesToCurrent -and $allowedSids -notcontains $sid -and $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
        $dangerous = [int][System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [int][System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor [int][System.Security.AccessControl.FileSystemRights]::TakeOwnership
        # A volume root cannot be removed, but inheritable Delete rights can affect replaceable descendants.
        if (-not $isVolumeRoot -or $propagatesToChild) {
          $dangerous = $dangerous -bor [int][System.Security.AccessControl.FileSystemRights]::Delete
        }
        if (($rights -band $dangerous) -ne 0) { throw "DENY|$kind|untrusted_ancestor_acl" }
      }
    }
    if ($kind -eq 'data') {
      $required = [int][System.Security.AccessControl.FileSystemRights]::Modify
      if (($userRights -band $required) -ne $required) { throw "DENY|$kind|required_data_modify_missing" }
    }
    if ($kind -eq 'key') {
      $required = [int][System.Security.AccessControl.FileSystemRights]::Read
      if (($userRights -band $required) -ne $required) { throw "DENY|$kind|required_key_read_missing" }
    }
    if ($kind -eq 'store' -or $kind -eq 'marker') {
      $required = [int][System.Security.AccessControl.FileSystemRights]::Modify
      $modifyCode = if ($kind -eq 'marker') { 'required_marker_modify_missing' } else { 'required_store_modify_missing' }
      if (($userRights -band $required) -ne $required) { throw "DENY|$kind|$modifyCode" }
    }
    if ($identityBefore) {
      $identityAfter = Get-StorageObjectIdentity $target $isDirectory $kind
      if ($identityBefore.Volume -ne $identityAfter.Volume -or $identityBefore.FileId -ne $identityAfter.FileId) {
        throw "DENY|$kind|object_identity_mismatch"
      }
      $receipts.Add("$kind|$($identityAfter.Volume)|$($identityAfter.FileId)")
    }
  }
  $output = @('OK') + @($receipts.ToArray())
  [Console]::Out.Write(($output -join ([string][char]10)))
  exit 0
} catch {
  $message = $_.Exception.Message
  if ($message -match '^DENY\|(ancestor|data|key|store|marker)\|[a-z_]+$') {
    [Console]::Out.Write($message)
  } else {
    [Console]::Out.Write("DENY|$kind|acl_inspection_unavailable")
  }
  exit 0
}
`;

const WINDOWS_DIAGNOSTIC_CODES = new Set<OAuthStorageDiagnosticCode>([
  "untrusted_ancestor_owner",
  "untrusted_ancestor_acl",
  "untrusted_leaf_owner",
  "untrusted_leaf_acl",
  "required_key_read_missing",
  "required_data_modify_missing",
  "required_store_modify_missing",
  "required_marker_modify_missing",
  "reparse_point",
  "filesystem_unsupported",
  "acl_inspection_unavailable",
  "object_identity_unavailable",
  "object_identity_mismatch",
]);

function safeFailure(reason: "storage_permissions" | "storage_unavailable" = "storage_permissions"): never {
  throw new OAuthError(reason);
}

function permissionFailure(
  entry: PathEntry["kind"],
  code: OAuthStorageDiagnosticCode,
  platform: "windows" | "posix" = process.platform === "win32" ? "windows" : "posix",
): never {
  throw new OAuthError("storage_permissions", { platform, entry, code });
}

function identityUnavailable(
  entry: PathEntry["kind"],
  platform: "windows" | "posix" = process.platform === "win32" ? "windows" : "posix",
): never {
  throw new OAuthError("storage_unavailable", {
    platform,
    entry,
    code: "object_identity_unavailable",
  });
}

function getUid(): number {
  if (typeof process.getuid !== "function") return safeFailure();
  return process.getuid();
}

function validateAbsolutePath(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CONFIGURED_PATH_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !path.isAbsolute(value)
  ) {
    return safeFailure();
  }
  return path.resolve(value);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function samePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
  }
  return path.resolve(left) === path.resolve(right);
}

async function lstatOrMissing(value: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return safeFailure();
  }
}

function rejectLinkOrWrongType(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
  expected: "directory" | "file",
  entry: PathEntry["kind"] = "ancestor",
): void {
  if (stat.isSymbolicLink()) permissionFailure(entry, "reparse_point");
  if ((expected === "directory" && !stat.isDirectory()) || (expected === "file" && !stat.isFile())) {
    safeFailure();
  }
}

export function assertTrustedPosixAncestorOwner(ownerUid: number, currentUid: number): void {
  if (
    !Number.isSafeInteger(ownerUid) ||
    !Number.isSafeInteger(currentUid) ||
    (ownerUid !== 0 && ownerUid !== currentUid)
  ) {
    permissionFailure("ancestor", "untrusted_ancestor_owner", "posix");
  }
}

function validatePosixAncestor(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): void {
  assertTrustedPosixAncestorOwner(Number(stat.uid), getUid());
  const mode = Number(stat.mode) & 0o7777;
  const sharedWrite = (mode & 0o022) !== 0;
  const stickyProtectedRoot =
    (mode & 0o1000) !== 0 && Number(stat.uid) === 0 && (mode & 0o002) !== 0;
  if (sharedWrite && !stickyProtectedRoot) {
    permissionFailure("ancestor", "untrusted_ancestor_mode", "posix");
  }
}

function validatePosixDataDirectory(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
): void {
  const uid = getUid();
  if (
    Number(stat.uid) !== uid ||
    (Number(stat.mode) & 0o777) !== PRIVATE_DIRECTORY_MODE ||
    (Number(stat.mode) & 0o700) !== PRIVATE_DIRECTORY_MODE
  ) {
    safeFailure();
  }
}

function validatePosixKeyFile(stat: Awaited<ReturnType<typeof fs.lstat>>): void {
  const uid = getUid();
  const mode = Number(stat.mode) & 0o777;
  if (
    Number(stat.uid) !== uid ||
    Number(stat.nlink) !== 1 ||
    Number(stat.size) !== 32 ||
    !KEY_ALLOWED_MODES.has(mode)
  ) {
    safeFailure();
  }
}

function validatePosixStoreFile(stat: Awaited<ReturnType<typeof fs.lstat>>): void {
  const uid = getUid();
  if (
    Number(stat.uid) !== uid ||
    Number(stat.nlink) !== 1 ||
    (Number(stat.mode) & 0o777) !== PRIVATE_FILE_MODE
  ) {
    safeFailure();
  }
}

async function pathEntries(
  value: string,
  leafKind: "data" | "key" | "store" | "marker",
  allowMissingLeaf: boolean,
): Promise<PathEntry[]> {
  const fullPath = validateAbsolutePath(value);
  const parsed = path.parse(fullPath);
  if (parsed.root.length === 0) return safeFailure();
  const segments = fullPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const result: PathEntry[] = [{ path: parsed.root, kind: "ancestor" }];
  let current = parsed.root;
  let missing = false;

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const isLeaf = index === segments.length - 1;
    if (missing) {
      if (!allowMissingLeaf) return safeFailure();
      continue;
    }
    const stat = await lstatOrMissing(current);
    if (!stat) {
      if (!allowMissingLeaf) return safeFailure();
      missing = true;
      continue;
    }
    rejectLinkOrWrongType(
      stat,
      isLeaf ? (leafKind === "data" ? "directory" : "file") : "directory",
      isLeaf ? leafKind : "ancestor",
    );
    result.push({ path: current, kind: isLeaf ? leafKind : "ancestor" });
  }
  if (leafKind === "data" && missing) {
    result.push({ path: fullPath, kind: "data" });
  }
  return result;
}

async function ensureDataDirectory(dataDir: string): Promise<void> {
  const fullPath = validateAbsolutePath(dataDir);
  const parsed = path.parse(fullPath);
  const segments = fullPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  let currentStat = await lstatOrMissing(current);
  if (!currentStat) return safeFailure();
  rejectLinkOrWrongType(currentStat, "directory");
  if (process.platform !== "win32") validatePosixAncestor(currentStat);

  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat = await lstatOrMissing(current);
    if (!stat) {
      try {
        await fs.mkdir(current, { mode: PRIVATE_DIRECTORY_MODE });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") return safeFailure();
      }
      stat = await lstatOrMissing(current);
      if (!stat) return safeFailure();
    }
    rejectLinkOrWrongType(stat, "directory");
    const isDataDirectory = index === segments.length - 1;
    if (process.platform !== "win32") {
      if (isDataDirectory) validatePosixDataDirectory(stat);
      else validatePosixAncestor(stat);
    }
  }
}

function decodeMountField(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

async function assertLocalLinuxFilesystem(value: string): Promise<void> {
  let mountInfo: string;
  try {
    mountInfo = await fs.readFile("/proc/self/mountinfo", "utf8");
  } catch {
    return safeFailure("storage_unavailable");
  }
  const resolved = path.resolve(value);
  let bestMount = "";
  let bestType = "";
  for (const line of mountInfo.split("\n")) {
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;
    const left = line.slice(0, separator).split(" ");
    const right = line.slice(separator + 3).split(" ");
    const mountPoint = decodeMountField(left[4] ?? "");
    const type = right[0] ?? "";
    if (
      mountPoint.length > bestMount.length &&
      (mountPoint === path.parse(resolved).root ||
        resolved === mountPoint ||
        resolved.startsWith(`${mountPoint}${path.sep}`))
    ) {
      bestMount = mountPoint;
      bestType = type;
    }
  }
  const localTypes = new Set([
    "btrfs",
    "ext2",
    "ext3",
    "ext4",
    "f2fs",
    "overlay",
    "tmpfs",
    "xfs",
    "zfs",
  ]);
  if (!bestType || !localTypes.has(bestType)) return safeFailure("storage_unavailable");
}

function mergePathEntries(entries: readonly PathEntry[]): PathEntry[] {
  const merged = new Map<string, PathEntry>();
  for (const entry of entries) {
    const key = process.platform === "win32" ? entry.path.toLowerCase() : entry.path;
    const existing = merged.get(key);
    if (!existing || entry.kind !== "ancestor") merged.set(key, entry);
  }
  return [...merged.values()];
}

export async function verifyWindowsAclEntries(
  entries: readonly PathEntry[],
): Promise<StoragePermissionReceipt> {
  const data = entries.map((entry) => `${entry.kind}\t${entry.path}`).join("\n");
  const fallbackEntry = entries[0]?.kind ?? "ancestor";
  try {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      childProcess.execFile(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_ACL_SCRIPT],
        {
          windowsHide: true,
          timeout: 5_000,
          maxBuffer: 16 * 1024,
          encoding: "utf8",
          env: { ...process.env, ETSY_OAUTH_ACL_PATHS: data },
        },
        (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        },
      );
    });
    const normalized = stdout.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const match = /^DENY\|(ancestor|data|key|store|marker)\|([a-z_]+)$/.exec(lines[0] ?? "");
    if (match && WINDOWS_DIAGNOSTIC_CODES.has(match[2] as OAuthStorageDiagnosticCode)) {
      if (match[2] === "object_identity_unavailable") {
        return identityUnavailable(match[1] as PathEntry["kind"], "windows");
      }
      return permissionFailure(
        match[1] as PathEntry["kind"],
        match[2] as OAuthStorageDiagnosticCode,
        "windows",
      );
    }
    if (lines[0] !== "OK") {
      return permissionFailure(fallbackEntry, "acl_inspection_unavailable", "windows");
    }

    const receipt: {
      keyFile?: StorageObjectIdentity;
      storeFile?: StorageObjectIdentity;
      recoveryMarkerFile?: StorageObjectIdentity;
    } = {};
    for (const line of lines.slice(1)) {
      if (line.length === 0) continue;
      const identity = /^(key|store|marker)\|([0-9a-f]{8})\|([0-9a-f]{16})$/.exec(line);
      if (!identity) return identityUnavailable(fallbackEntry, "windows");
      const value = {
        device: BigInt(`0x${identity[2]}`),
        fileId: BigInt(`0x${identity[3]}`),
      };
      if (value.fileId === 0n) return identityUnavailable(identity[1] as PathEntry["kind"], "windows");
      if (identity[1] === "key") {
        if (receipt.keyFile) return identityUnavailable("key", "windows");
        receipt.keyFile = value;
      } else {
        const identityKind = identity[1] as "store" | "marker";
        const receiptKey = identityKind === "store" ? "storeFile" : "recoveryMarkerFile";
        if (receipt[receiptKey]) return identityUnavailable(identityKind, "windows");
        receipt[receiptKey] = value;
      }
    }
    if (entries.some((entry) => entry.kind === "key") && !receipt.keyFile) {
      return identityUnavailable("key", "windows");
    }
    if (entries.some((entry) => entry.kind === "store") && !receipt.storeFile) {
      return identityUnavailable("store", "windows");
    }
    if (entries.some((entry) => entry.kind === "marker") && !receipt.recoveryMarkerFile) {
      return identityUnavailable("marker", "windows");
    }
    return receipt;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    return permissionFailure(fallbackEntry, "acl_inspection_unavailable", "windows");
  }
}

async function capturePathIdentity(
  value: string,
  entry: "key" | "store" | "marker",
): Promise<StorageObjectIdentity> {
  let stat;
  try {
    stat = await fs.lstat(value, { bigint: true });
  } catch {
    return permissionFailure(entry, "object_identity_mismatch");
  }
  if (stat.isSymbolicLink()) return permissionFailure(entry, "reparse_point");
  if (!stat.isFile()) return permissionFailure(entry, "object_identity_mismatch");
  if (typeof stat.dev !== "bigint" || typeof stat.ino !== "bigint" || stat.ino <= 0n) {
    return identityUnavailable(entry, "posix");
  }
  return { device: stat.dev, fileId: stat.ino };
}

export async function verifyStoragePermissionsWithReceipt(
  config: OAuthConfig,
): Promise<StoragePermissionReceipt> {
  if (!config || typeof config !== "object") return safeFailure();
  const dataDir = validateAbsolutePath(config.dataDir);
  const keyFile = validateAbsolutePath(config.keyFile);

  try {
    const lexicalData = path.resolve(dataDir);
    const lexicalKey = path.resolve(keyFile);
    if (isInside(lexicalData, lexicalKey)) return safeFailure();

    await ensureDataDirectory(dataDir);
    const dataRealPath = await fs.realpath(dataDir);
    const dataStat = await fs.lstat(dataRealPath);
    rejectLinkOrWrongType(dataStat, "directory", "data");
    if (process.platform !== "win32") validatePosixDataDirectory(dataStat);

    const keyEntries = await pathEntries(keyFile, "key", false);
    const keyRealPath = await fs.realpath(keyFile);
    if (isInside(dataRealPath, keyRealPath)) return safeFailure();
    const keyStat = await fs.lstat(keyRealPath);
    rejectLinkOrWrongType(keyStat, "file", "key");
    if (Number(keyStat.nlink) !== 1 || Number(keyStat.size) !== 32) return safeFailure();

    const storeFile = path.join(dataRealPath, "connections.enc");
    const storeStat = await lstatOrMissing(storeFile);
    if (storeStat) {
      rejectLinkOrWrongType(storeStat, "file", "store");
      if (Number(storeStat.nlink) !== 1 || Number(storeStat.size) > 4 * 1024 * 1024) {
        return safeFailure();
      }
    }

    const recoveryMarkerFile = path.join(dataRealPath, "oauth-recovery-required.json");
    const recoveryMarkerStat = await lstatOrMissing(recoveryMarkerFile);
    if (recoveryMarkerStat) {
      rejectLinkOrWrongType(recoveryMarkerStat, "file", "marker");
      if (Number(recoveryMarkerStat.nlink) !== 1 || Number(recoveryMarkerStat.size) > 4_096) {
        return safeFailure();
      }
    }

    if (process.platform === "win32") {
      const dataEntries = await pathEntries(dataDir, "data", false);
      const storeEntries = storeStat ? await pathEntries(storeFile, "store", false) : [];
      const markerEntries = recoveryMarkerStat
        ? await pathEntries(recoveryMarkerFile, "marker", false)
        : [];
      return await verifyWindowsAclEntries(
        mergePathEntries([...dataEntries, ...keyEntries, ...storeEntries, ...markerEntries]),
      );
    }
    if (process.platform !== "linux") return safeFailure("storage_unavailable");

    validatePosixKeyFile(keyStat);
    const dataEntries = await pathEntries(dataDir, "data", false);
    const markerEntries = recoveryMarkerStat
      ? await pathEntries(recoveryMarkerFile, "marker", false)
      : [];
    for (const entry of [...dataEntries, ...keyEntries, ...markerEntries]) {
      const stat = await lstatOrMissing(entry.path);
      if (!stat) return safeFailure();
      if (stat.isSymbolicLink()) return permissionFailure(entry.kind, "reparse_point", "posix");
      if (entry.kind === "data") validatePosixDataDirectory(stat);
      else if (entry.kind === "key") validatePosixKeyFile(stat);
      else if (entry.kind === "store") validatePosixStoreFile(stat);
      else if (entry.kind === "marker") validatePosixStoreFile(stat);
      else validatePosixAncestor(stat);
    }
    if (storeStat) validatePosixStoreFile(storeStat);
    if (recoveryMarkerStat) validatePosixStoreFile(recoveryMarkerStat);
    await assertLocalLinuxFilesystem(dataDir);
    await assertLocalLinuxFilesystem(path.dirname(keyFile));
    const receipt: {
      keyFile?: StorageObjectIdentity;
      storeFile?: StorageObjectIdentity;
      recoveryMarkerFile?: StorageObjectIdentity;
    } = {
      keyFile: await capturePathIdentity(keyRealPath, "key"),
    };
    if (storeStat) receipt.storeFile = await capturePathIdentity(storeFile, "store");
    if (recoveryMarkerStat) {
      receipt.recoveryMarkerFile = await capturePathIdentity(recoveryMarkerFile, "marker");
    }
    return receipt;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    return safeFailure();
  }
}

export async function verifyStoragePermissions(config: OAuthConfig): Promise<void> {
  await verifyStoragePermissionsWithReceipt(config);
}
