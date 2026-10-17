import crypto from "node:crypto";
import childProcess from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseOAuthConfig } from "../../build/oauth/config.js";

const execFile = promisify(execFileCallback);

const PROTECT_FIXTURE_ACL = String.raw`
$ErrorActionPreference = 'Stop'
$stage = 'parse'
try {
  $entries = $env:ETSY_OAUTH_FIXTURE_ACL_PATHS -split ([string][char]10)
  $stage = 'identity'
  $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $entryIndex = 0
  foreach ($entry in $entries) {
    $entryIndex += 1
    $parts = $entry.TrimEnd([char]13) -split ([string][char]9), 2
    if ($parts.Count -ne 2) { throw 'entry' }
    $kind = [string]$parts[0]
    $target = [string]$parts[1]
    if ($kind -eq 'directory') {
      $stage = 'directory-acl'
      $acl = [System.Security.AccessControl.DirectorySecurity]::new()
      $acl.SetAccessRuleProtection($true, $false)
      $acl.SetOwner($userSid)
      $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
      foreach ($sid in @($userSid, $systemSid, $adminSid)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inherit, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
      }
    } else {
      $stage = 'file-acl'
      $acl = [System.Security.AccessControl.FileSecurity]::new()
      $acl.SetAccessRuleProtection($true, $false)
      $acl.SetOwner($userSid)
      $userRule = [System.Security.AccessControl.FileSystemAccessRule]::new($userSid, [System.Security.AccessControl.FileSystemRights]::Read, [System.Security.AccessControl.AccessControlType]::Allow)
      $acl.AddAccessRule($userRule)
      foreach ($sid in @($systemSid, $adminSid)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
      }
    }
    $stage = ('set-entry-' + $entryIndex + ':pre=' + (Test-Path -LiteralPath $target))
    Set-Acl -LiteralPath $target -AclObject $acl
  }
  [Console]::Out.Write('OK')
  exit 0
} catch {
  $exists = Test-Path -LiteralPath $target
  [Console]::Out.Write(('FAIL:' + $stage + ':exists=' + $exists + ':' + $_.FullyQualifiedErrorId))
  exit 0
}
`;

const SET_SYNTHETIC_FIXTURE_ACL = String.raw`
$ErrorActionPreference = 'Stop'
$stage = 'identity'
try {
  $target = $env:ETSY_OAUTH_SYNTHETIC_ACL_PATH
  $scenario = $env:ETSY_OAUTH_SYNTHETIC_ACL_SCENARIO
  $userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $everyoneSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
  $stage = 'build-acl'
  if ($scenario -eq 'directory-foreign-effective-delete-child') {
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($userSid)
    foreach ($sid in @($userSid, $systemSid, $adminSid)) {
      $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow))
    }
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($everyoneSid, [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles, [System.Security.AccessControl.AccessControlType]::Allow))
  } elseif ($scenario -eq 'directory-foreign-effective-delete') {
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($userSid)
    foreach ($sid in @($userSid, $systemSid, $adminSid)) {
      $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow))
    }
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($everyoneSid, [System.Security.AccessControl.FileSystemRights]::Delete, [System.Security.AccessControl.AccessControlType]::Allow))
  } elseif ($scenario -eq 'data-user-inherit-only-modify') {
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($userSid)
    $inherit = [System.Security.AccessControl.InheritanceFlags]::ObjectInherit -bor [System.Security.AccessControl.InheritanceFlags]::ContainerInherit
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($userSid, [System.Security.AccessControl.FileSystemRights]::Modify, $inherit, [System.Security.AccessControl.PropagationFlags]::InheritOnly, [System.Security.AccessControl.AccessControlType]::Allow))
    foreach ($sid in @($systemSid, $adminSid)) {
      $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow))
    }
  } else {
    throw 'scenario'
  }
  $stage = 'set-acl'
  Set-Acl -LiteralPath $target -AclObject $acl
  [Console]::Out.Write('OK')
  exit 0
} catch {
  $failure = $_.Exception
  if ($failure.InnerException) { $failure = $failure.InnerException }
  [Console]::Out.Write(('FAIL|' + $stage + '|' + $failure.GetType().Name))
  exit 0
}
`;

async function protectWindowsFixture(paths) {
  try {
    const { stdout } = await execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", PROTECT_FIXTURE_ACL],
      {
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 8 * 1024,
        encoding: "utf8",
        env: {
          ...process.env,
          ETSY_OAUTH_FIXTURE_ACL_PATHS: paths
            .map((entry) => `${entry.kind}\t${entry.path}`)
            .join("\n"),
        },
      },
    );
    if (stdout !== "OK") throw new Error(`Native fixture ACL setup failed (${stdout.slice(0, 160)}).`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Native fixture ACL setup failed (FAIL:")) {
      throw error;
    }
    throw new Error("Native fixture ACL setup failed.");
  }
}

export async function setSyntheticWindowsFixtureAcl(target, scenario) {
  if (process.platform !== "win32") throw new Error("Windows-only ACL fixture requested.");
  const allowedScenarios = new Set([
    "directory-foreign-effective-delete-child",
    "directory-foreign-effective-delete",
    "data-user-inherit-only-modify",
  ]);
  if (!allowedScenarios.has(scenario)) throw new Error("Unknown synthetic ACL fixture scenario.");
  let stdout;
  try {
    ({ stdout } = await execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", SET_SYNTHETIC_FIXTURE_ACL],
      {
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 8 * 1024,
        encoding: "utf8",
        env: {
          ...process.env,
          ETSY_OAUTH_SYNTHETIC_ACL_PATH: target,
          ETSY_OAUTH_SYNTHETIC_ACL_SCENARIO: scenario,
        },
      },
    ));
  } catch {
    throw new Error("Native synthetic ACL fixture setup failed.");
  }
  if (stdout !== "OK") {
    const diagnostic = /^FAIL\|(identity|build-acl|set-acl)\|([A-Za-z]+)$/.exec(stdout);
    const stage = diagnostic?.[1] ?? "unknown";
    const failureType = diagnostic?.[2] ?? "unknown";
    throw new Error(`Native synthetic ACL fixture setup failed at ${stage} (${failureType}).`);
  }
}

export const syntheticOAuthKey = Buffer.alloc(32, 0x42);
export const syntheticWrongOAuthKey = Buffer.alloc(32, 0x24);
export const syntheticOAuthEnvKey = "synthetic-keystring:synthetic-shared-secret";
export const syntheticConnectionId = "AAAAAAAAAAAAAAAAAAAAAA";
export const syntheticStoreFormat = 1;
export const syntheticStoreAlgorithm = "AES-256-GCM";

function approvedTemporaryRoot() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData || !path.isAbsolute(localAppData)) {
      throw new Error("The approved Windows test temporary root is unavailable.");
    }
    return path.join(localAppData, "Temp", "opencode");
  }
  return os.tmpdir();
}

export async function createOAuthFixture(t) {
  const parent = approvedTemporaryRoot();
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(path.join(parent, "etsy-oauth-test-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700).catch(() => {});
  if (process.platform === "win32") {
    await protectWindowsFixture([{ path: root, kind: "directory" }]);
  }
  const dataDir = path.join(root, "data");
  const secretsDir = path.join(root, "secrets");
  const keyFile = path.join(secretsDir, "oauth.key");
  await fs.mkdir(dataDir, { mode: 0o700 });
  await fs.mkdir(secretsDir, { mode: 0o700 });
  await fs.writeFile(keyFile, syntheticOAuthKey, { flag: "wx", mode: 0o600 });
  await fs.chmod(keyFile, 0o600).catch(() => {});
  if (process.platform === "win32") {
    await protectWindowsFixture([
      { path: dataDir, kind: "directory" },
      { path: secretsDir, kind: "directory" },
      { path: keyFile, kind: "file" },
    ]);
  }

  return { root, dataDir, secretsDir, keyFile };
}

export async function createNativeWindowsOAuthFixture(t) {
  if (process.platform !== "win32") throw new Error("Windows-only native fixture requested.");
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData || !path.isAbsolute(localAppData)) {
    throw new Error("The approved Windows application-data fixture root is unavailable.");
  }

  const parent = path.resolve(localAppData);
  let root;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = path.join(parent, `etsy-mcp-native-test-${crypto.randomBytes(16).toString("hex")}`);
    try {
      await fs.mkdir(candidate, { mode: 0o700 });
      root = candidate;
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw new Error("Native Windows fixture creation failed.");
    }
  }
  if (!root) throw new Error("Native Windows fixture creation failed.");

  t.after(async () => {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {
      throw new Error("Native Windows fixture cleanup failed.");
    }
  });

  const dataDir = path.join(root, "data");
  const secretsDir = path.join(root, "secrets");
  const keyFile = path.join(secretsDir, "oauth.key");
  try {
    await fs.chmod(root, 0o700).catch(() => {});
    await protectWindowsFixture([{ path: root, kind: "directory" }]);
    await fs.mkdir(dataDir, { mode: 0o700 });
    await fs.mkdir(secretsDir, { mode: 0o700 });
    await fs.writeFile(keyFile, syntheticOAuthKey, { flag: "wx", mode: 0o600 });
    await fs.chmod(keyFile, 0o600).catch(() => {});
  } catch {
    throw new Error("Native Windows fixture preparation failed.");
  }

  return { root, dataDir, secretsDir, keyFile };
}

export function syntheticOAuthEnvironment(fixture, overrides = {}) {
  return {
    ETSY_API_KEY: syntheticOAuthEnvKey,
    ETSY_OAUTH_ENABLED: "true",
    ETSY_OAUTH_OPERATOR_ID: "synthetic_operator",
    ETSY_OAUTH_DATA_DIR: fixture.dataDir,
    ETSY_OAUTH_KEY_FILE: fixture.keyFile,
    ETSY_OAUTH_REDIRECT_URI: "https://oauth.invalid/oauth/etsy/callback",
    ETSY_OAUTH_CALLBACK_HOST: "127.0.0.1",
    ETSY_OAUTH_CALLBACK_PORT: "3001",
    ...overrides,
  };
}

export function syntheticOAuthConfig(fixture, overrides = {}) {
  const parsed = parseOAuthConfig(syntheticOAuthEnvironment(fixture, overrides), false);
  if (!parsed.enabled) throw new Error("Synthetic OAuth configuration was disabled.");
  return parsed.config;
}

export function syntheticConnection(overrides = {}) {
  const issuedAt = 1_800_000_000_000;
  return {
    connectionId: syntheticConnectionId,
    owner: {
      operatorId: "synthetic_operator",
      appFingerprint: crypto
        .createHash("sha256")
        .update("etsy-mcp-oauth-app-fingerprint-v1\0")
        .update("synthetic-keystring", "utf8")
        .digest("hex"),
    },
    accountId: 12_345,
    shopId: 67_890,
    generation: 1,
    label: "Synthetic fixture",
    state: "connected",
    accessToken: "12345.synthetic-access-token",
    refreshToken: "synthetic-refresh-token",
    issuedAt,
    expiresAt: issuedAt + 3_600_000,
    requestedScopes: ["shops_r"],
    grants: {
      scopes: ["shops_r"],
      source: "authorization_code_response",
      checkedAt: issuedAt,
    },
    ...overrides,
  };
}

export function syntheticConnectionIdFor(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("Invalid synthetic connection index.");
  }
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(value, 12);
  return bytes.toString("base64url");
}

export async function writeSyntheticKey(file, key = syntheticOAuthKey) {
  await fs.writeFile(file, key, { flag: "wx", mode: 0o600 });
  await fs.chmod(file, 0o600).catch(() => {});
}

export function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("Invalid synthetic base64url value.");
  }
  return Buffer.from(value, "base64url");
}

export function outerEnvelopeAad(envelope) {
  return Buffer.from(
    JSON.stringify([
      envelope.format,
      envelope.storeId,
      envelope.operatorId,
      envelope.generation,
    ]),
    "utf8",
  );
}

export function decryptOuterSnapshot(envelope, key = syntheticOAuthKey) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    decodeBase64Url(envelope.nonce),
  );
  decipher.setAAD(outerEnvelopeAad(envelope));
  decipher.setAuthTag(decodeBase64Url(envelope.tag));
  return Buffer.concat([
    decipher.update(decodeBase64Url(envelope.ciphertext)),
    decipher.final(),
  ]);
}

export function encryptOuterPayload(
  { storeId, operatorId, generation },
  plaintext,
  key = syntheticOAuthKey,
  nonce = crypto.randomBytes(12),
) {
  const bytes = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const envelope = {
    format: syntheticStoreFormat,
    algorithm: syntheticStoreAlgorithm,
    storeId,
    operatorId,
    generation,
  };
  cipher.setAAD(outerEnvelopeAad(envelope));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    ...envelope,
    nonce: nonce.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function stubWindowsAclForStoreTests(t) {
  if (process.platform !== "win32") return;
  t.mock.method(childProcess, "execFile", (_file, _args, options, callback) => {
    void (async () => {
      try {
        const entries = String(options?.env?.ETSY_OAUTH_ACL_PATHS ?? "")
          .split("\n")
          .map((line) => line.split("\t", 2))
          .filter(([kind]) => kind === "key" || kind === "store");
        const receipts = [];
        for (const [kind, target] of entries) {
          const stat = await fs.stat(target, { bigint: true });
          const device = stat.dev.toString(16);
          const fileId = stat.ino.toString(16);
          if (device.length > 8 || fileId.length > 16 || stat.ino === 0n) {
            throw new Error("Synthetic object identity is unavailable.");
          }
          receipts.push(`${kind}|${device.padStart(8, "0")}|${fileId.padStart(16, "0")}`);
        }
        callback(null, ["OK", ...receipts].join("\n"), "");
      } catch {
        callback(new Error("Synthetic ACL fixture failed."), "", "");
      }
    })();
    return undefined;
  });
}

export function captureTemporaryWrites(t) {
  const writes = [];
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, "open", async (file, flags, mode) => {
    const handle = await originalOpen(file, flags, mode);
    if (typeof file !== "string" || !path.basename(file).endsWith(".tmp")) {
      return handle;
    }
    return new Proxy(handle, {
      get(target, property) {
        if (property === "writeFile") {
          return async (data, ...args) => {
            writes.push(Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data)));
            return target.writeFile(data, ...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  return writes;
}

export function failTemporaryOperation(t, operation, code = "ENOSPC") {
  const originalOpen = fs.open.bind(fs);
  const temporary = (file) =>
    typeof file === "string" && path.basename(file).endsWith(".tmp");
  const failure = () => Object.assign(new Error("Synthetic filesystem failure."), { code });

  if (operation === "open") {
    t.mock.method(fs, "open", async (file, ...args) => {
      if (temporary(file)) throw failure();
      return originalOpen(file, ...args);
    });
    return;
  }

  t.mock.method(fs, "open", async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (!temporary(file)) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === operation) {
          return async (..._operationArgs) => {
            throw failure();
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}
