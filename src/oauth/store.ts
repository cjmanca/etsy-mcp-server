import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from "node:crypto";
import { constants as fsConstants, type BigIntStats, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { OAuthError, type ConnectionRecord, type ConnectionStore, type OAuthConfig, type OwnerContext, type Scope } from "./types.js";
import {
  verifyStoragePermissionsWithReceipt,
  type StorageObjectIdentity,
  type StoragePermissionReceipt,
} from "./permissions.js";

const FORMAT = 1;
const ALGORITHM = "AES-256-GCM";
const STORE_FILE = "connections.enc";
const LOCK_DIRECTORY = "oauth-store.lock";
const LOCK_METADATA_FILE = "owner.json";
const TEMP_PREFIX = ".connections.enc.";
const TEMP_SUFFIX = ".tmp";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_RECORDS = 100;
const MAX_TOMBSTONES = 4_096;
const MAX_ENCRYPTED_BYTES = 4 * 1024 * 1024;
const MAX_DECRYPTED_BYTES = 2 * 1024 * 1024;
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_RECORD_CIPHERTEXT_BYTES = 64 * 1024;
const MIN_EPOCH_MS = 946_684_800_000;
const MAX_EPOCH_MS = 4_102_444_800_000;
const MAX_TOKEN_LIFETIME_MS = 366 * 24 * 60 * 60 * 1_000;
const CONNECTION_ID = /^[A-Za-z0-9_-]{22,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATOR_ID = /^[A-Za-z0-9_-]{1,64}$/;
const APP_FINGERPRINT = /^[a-f0-9]{64}$/;
const TOKEN = /^[\x21-\x7e]+$/;
const SCOPE_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const SCOPES = new Set([
  "address_r",
  "address_w",
  "billing_r",
  "cart_r",
  "cart_w",
  "email_r",
  "favorites_r",
  "favorites_w",
  "listings_d",
  "listings_r",
  "listings_w",
  "profile_r",
  "profile_w",
  "recommend_r",
  "recommend_w",
  "shops_r",
  "shops_w",
  "transactions_r",
  "transactions_w",
]);
const CONNECTION_STATES = new Set([
  "connected",
  "connected_limited",
  "scope_verification_required",
  "reconnect_required",
  "recovery_required",
]);
const SCOPE_EVIDENCE_SOURCES = new Set([
  "authorization_code_response",
  "refresh_response",
  "diagnostic",
]);
const CONNECTION_REASONS = new Set([
  "account_mismatch",
  "consent_removed",
  "identity_unverified",
  "recovery_required",
  "refresh_uncertain",
  "scope_missing",
  "scope_verification_required",
  "storage_failure",
  "token_expired",
]);
const ALLOWED_RECORD_KEYS = new Set([
  "connectionId",
  "owner",
  "accountId",
  "shopId",
  "generation",
  "label",
  "state",
  "reason",
  "accessToken",
  "refreshToken",
  "issuedAt",
  "expiresAt",
  "requestedScopes",
  "grants",
]);

interface OuterEnvelope {
  format: number;
  algorithm: string;
  storeId: string;
  operatorId: string;
  generation: number;
  nonce: string;
  tag: string;
  ciphertext: string;
}

interface EncryptedRecord {
  format: number;
  connectionId: string;
  accountId: number;
  generation: number;
  nonce: string;
  tag: string;
  ciphertext: string;
}

interface Tombstone {
  connectionId: string;
  generation: number;
}

interface LoadedState {
  storeId: string;
  generation: number;
  records: Map<string, ConnectionRecord>;
  tombstones: Map<string, number>;
}

interface OwnedLock {
  directory: string;
  metadataFile: string;
  bootId: string;
  pid: number;
}

function fail(reason: ConstructorParameters<typeof OAuthError>[0]): never {
  throw new OAuthError(reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: ReadonlySet<string> = new Set(required),
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isSafeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function validEpoch(value: unknown): value is number {
  return isSafeInteger(value, MIN_EPOCH_MS, MAX_EPOCH_MS);
}

function validateConnectionId(value: unknown): value is string {
  if (typeof value !== "string" || !CONNECTION_ID.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length >= 16 && decoded.toString("base64url") === value;
}

function decodeBase64Url(value: unknown, exactLength?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return fail("storage_corrupt");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    decoded.toString("base64url") !== value ||
    (exactLength !== undefined && decoded.length !== exactLength)
  ) {
    return fail("storage_corrupt");
  }
  return decoded;
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("storage_corrupt");
  }
}

function serializeJson(value: unknown): Buffer {
  try {
    return Buffer.from(JSON.stringify(value), "utf8");
  } catch {
    return fail("record_invalid");
  }
}

function validateOwner(value: unknown, expected: OAuthConfig["owner"]): value is OwnerContext {
  if (!isPlainObject(value)) return false;
  if (!hasExactKeys(value, ["operatorId", "appFingerprint"])) return false;
  return (
    typeof value.operatorId === "string" &&
    OPERATOR_ID.test(value.operatorId) &&
    typeof value.appFingerprint === "string" &&
    APP_FINGERPRINT.test(value.appFingerprint) &&
    value.operatorId === expected.operatorId &&
    value.appFingerprint === expected.appFingerprint
  );
}

function validateScopeList(value: unknown): readonly Scope[] | undefined {
  if (!Array.isArray(value) || value.length > 32) return undefined;
  const scopes: string[] = [];
  for (const scope of value) {
    if (
      typeof scope !== "string" ||
      scope.length > 64 ||
      !SCOPE_NAME.test(scope) ||
      !SCOPES.has(scope) ||
      scopes.includes(scope)
    ) {
      return undefined;
    }
    scopes.push(scope);
  }
  return Object.freeze(scopes);
}

function validateRecord(value: unknown, expectedOwner: OAuthConfig["owner"]): ConnectionRecord {
  if (!isPlainObject(value)) return fail("record_invalid");
  if (!hasExactKeys(
    value,
    [
      "connectionId",
      "owner",
      "accountId",
      "generation",
      "state",
      "accessToken",
      "refreshToken",
      "issuedAt",
      "expiresAt",
      "requestedScopes",
      "grants",
    ],
    ALLOWED_RECORD_KEYS,
  )) {
    return fail("record_invalid");
  }
  if (
    !validateConnectionId(value.connectionId) ||
    !validateOwner(value.owner, expectedOwner) ||
    !isSafeInteger(value.accountId, 1) ||
    !isSafeInteger(value.generation, 1) ||
    typeof value.state !== "string" ||
    !CONNECTION_STATES.has(value.state) ||
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    Buffer.byteLength(value.accessToken, "utf8") > MAX_TOKEN_BYTES ||
    Buffer.byteLength(value.refreshToken, "utf8") > MAX_TOKEN_BYTES ||
    !TOKEN.test(value.accessToken) ||
    !TOKEN.test(value.refreshToken) ||
    !value.accessToken.startsWith(`${value.accountId}.`) ||
    !validEpoch(value.issuedAt) ||
    !validEpoch(value.expiresAt) ||
    value.expiresAt <= value.issuedAt ||
    value.expiresAt - value.issuedAt > MAX_TOKEN_LIFETIME_MS
  ) {
    return fail("record_invalid");
  }
  if (value.shopId !== undefined && !isSafeInteger(value.shopId, 1)) {
    return fail("record_invalid");
  }
  if (
    value.label !== undefined &&
    (typeof value.label !== "string" || value.label.length > 100 || /[\u0000-\u001f\u007f]/.test(value.label))
  ) {
    return fail("record_invalid");
  }
  if (
    value.reason !== undefined &&
    (typeof value.reason !== "string" || !CONNECTION_REASONS.has(value.reason))
  ) {
    return fail("record_invalid");
  }
  const requestedScopes = validateScopeList(value.requestedScopes);
  if (!requestedScopes || !isPlainObject(value.grants)) return fail("record_invalid");
  if (!hasExactKeys(value.grants, ["scopes", "source", "checkedAt"])) {
    return fail("record_invalid");
  }
  const grantedScopes = validateScopeList(value.grants.scopes);
  if (
    !grantedScopes ||
    typeof value.grants.source !== "string" ||
    !SCOPE_EVIDENCE_SOURCES.has(value.grants.source) ||
    !validEpoch(value.grants.checkedAt)
  ) {
    return fail("record_invalid");
  }

  const owner = Object.freeze({
    operatorId: value.owner.operatorId as string,
    appFingerprint: value.owner.appFingerprint as string,
  });
  const grants = Object.freeze({
    scopes: grantedScopes,
    source: value.grants.source as "authorization_code_response" | "refresh_response" | "diagnostic",
    checkedAt: value.grants.checkedAt as number,
  });
  const record: ConnectionRecord = {
    connectionId: value.connectionId,
    owner,
    accountId: value.accountId,
    ...(value.shopId === undefined ? {} : { shopId: value.shopId as number }),
    generation: value.generation,
    ...(value.label === undefined ? {} : { label: value.label as string }),
    state: value.state as ConnectionRecord["state"],
    ...(value.reason === undefined ? {} : { reason: value.reason as string }),
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    requestedScopes,
    grants,
  };
  return Object.freeze(record);
}

function cloneRecord(record: ConnectionRecord): ConnectionRecord {
  return validateRecord(
    {
      ...record,
      owner: { ...record.owner },
      requestedScopes: [...record.requestedScopes],
      grants: { ...record.grants, scopes: [...record.grants.scopes] },
    },
    record.owner,
  );
}

function outerAad(format: number, storeId: string, operatorId: string, generation: number): Buffer {
  return Buffer.from(JSON.stringify([format, storeId, operatorId, generation]), "utf8");
}

function recordAad(
  format: number,
  storeId: string,
  operatorId: string,
  connectionId: string,
  accountId: number,
  generation: number,
): Buffer {
  return Buffer.from(
    JSON.stringify([format, storeId, operatorId, connectionId, accountId, generation]),
    "utf8",
  );
}

function encrypt(key: Buffer, plaintext: Buffer, aad: Buffer): { nonce: Buffer; tag: Buffer; ciphertext: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, tag: cipher.getAuthTag(), ciphertext };
}

function decrypt(
  key: Buffer,
  nonce: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
  aad: Buffer,
): Buffer {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return fail("storage_corrupt");
  }
}

function validateEnvelope(value: unknown, operatorId: string): OuterEnvelope {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "format",
    "algorithm",
    "storeId",
    "operatorId",
    "generation",
    "nonce",
    "tag",
    "ciphertext",
  ])) {
    return fail("storage_corrupt");
  }
  if (
    value.format !== FORMAT ||
    value.algorithm !== ALGORITHM ||
    typeof value.storeId !== "string" ||
    !UUID.test(value.storeId) ||
    value.operatorId !== operatorId ||
    !isSafeInteger(value.generation, 1) ||
    typeof value.nonce !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    return fail("storage_corrupt");
  }
  decodeBase64Url(value.nonce, 12);
  decodeBase64Url(value.tag, 16);
  const ciphertext = decodeBase64Url(value.ciphertext);
  if (ciphertext.length > MAX_DECRYPTED_BYTES) return fail("storage_corrupt");
  return value as unknown as OuterEnvelope;
}

function validateEncryptedRecord(value: unknown): EncryptedRecord {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "format",
    "connectionId",
    "accountId",
    "generation",
    "nonce",
    "tag",
    "ciphertext",
  ])) {
    return fail("storage_corrupt");
  }
  if (
    value.format !== FORMAT ||
    !validateConnectionId(value.connectionId) ||
    !isSafeInteger(value.accountId, 1) ||
    !isSafeInteger(value.generation, 1) ||
    typeof value.nonce !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    return fail("storage_corrupt");
  }
  decodeBase64Url(value.nonce, 12);
  decodeBase64Url(value.tag, 16);
  const ciphertext = decodeBase64Url(value.ciphertext);
  if (ciphertext.length > MAX_RECORD_CIPHERTEXT_BYTES) return fail("storage_corrupt");
  return value as unknown as EncryptedRecord;
}

function decryptRecord(
  value: unknown,
  key: Buffer,
  config: OAuthConfig,
  storeId: string,
): ConnectionRecord {
  const envelope = validateEncryptedRecord(value);
  const plaintext = decrypt(
    key,
    decodeBase64Url(envelope.nonce, 12),
    decodeBase64Url(envelope.tag, 16),
    decodeBase64Url(envelope.ciphertext),
    recordAad(
      envelope.format,
      storeId,
      config.owner.operatorId,
      envelope.connectionId,
      envelope.accountId,
      envelope.generation,
    ),
  );
  if (plaintext.length > MAX_RECORD_CIPHERTEXT_BYTES) return fail("storage_corrupt");
  const record = validateRecord(decodeJson(plaintext), config.owner);
  if (
    record.connectionId !== envelope.connectionId ||
    record.accountId !== envelope.accountId ||
    record.generation !== envelope.generation
  ) {
    return fail("storage_corrupt");
  }
  return record;
}

function decryptSnapshot(
  plaintext: Buffer,
  key: Buffer,
  config: OAuthConfig,
  storeId: string,
  outerGeneration: number,
): LoadedState {
  const snapshot = decodeJson(plaintext);
  if (
    !isPlainObject(snapshot) ||
    !hasExactKeys(snapshot, ["format", "owner", "records", "tombstones"]) ||
    snapshot.format !== FORMAT ||
    !validateOwner(snapshot.owner, config.owner) ||
    !Array.isArray(snapshot.records) ||
    snapshot.records.length > MAX_RECORDS ||
    !Array.isArray(snapshot.tombstones) ||
    snapshot.tombstones.length > MAX_TOMBSTONES
  ) {
    return fail("storage_corrupt");
  }

  const records = new Map<string, ConnectionRecord>();
  const tombstones = new Map<string, number>();
  for (const item of snapshot.records) {
    const record = decryptRecord(item, key, config, storeId);
    if (record.generation > outerGeneration || records.has(record.connectionId)) {
      return fail("storage_corrupt");
    }
    records.set(record.connectionId, record);
  }
  for (const value of snapshot.tombstones) {
    if (
      !isPlainObject(value) ||
      !hasExactKeys(value, ["connectionId", "generation"]) ||
      !validateConnectionId(value.connectionId) ||
      !isSafeInteger(value.generation, 1) ||
      value.generation > outerGeneration ||
      tombstones.has(value.connectionId) ||
      records.has(value.connectionId)
    ) {
      return fail("storage_corrupt");
    }
    tombstones.set(value.connectionId, value.generation);
  }
  return { storeId, generation: outerGeneration, records, tombstones };
}

function validateLockMetadata(value: unknown, lock: OwnedLock): boolean {
  return (
    isPlainObject(value) &&
    hasExactKeys(value, ["format", "pid", "bootId", "createdAt"]) &&
    value.format === FORMAT &&
    value.pid === lock.pid &&
    value.bootId === lock.bootId &&
    validEpoch(value.createdAt)
  );
}

function lockMetadata(lock: OwnedLock): Buffer {
  return serializeJson({
    format: FORMAT,
    pid: lock.pid,
    bootId: lock.bootId,
    createdAt: Date.now(),
  });
}

function validatePrivateFileStat(stat: Stats | BigIntStats, sizeLimit: number): void {
  if (!stat.isFile() || Number(stat.nlink) !== 1 || Number(stat.size) > sizeLimit) {
    fail("storage_recovery_required");
  }
  if (process.platform !== "win32") {
    const uid = typeof process.getuid === "function" ? process.getuid() : -1;
    if (
      Number(stat.uid) !== uid ||
      (Number(stat.mode) & 0o777) !== PRIVATE_FILE_MODE
    ) {
      fail("storage_permissions");
    }
  }
}

function failObjectIdentity(
  entry: "key" | "store",
  code: "object_identity_unavailable" | "object_identity_mismatch" | "reparse_point",
): never {
  const platform = process.platform === "win32" ? "windows" : "posix";
  throw new OAuthError(code === "object_identity_unavailable" ? "storage_unavailable" : "storage_permissions", {
    platform,
    entry,
    code,
  });
}

function identityFromStat(stat: BigIntStats, entry: "key" | "store"): StorageObjectIdentity {
  if (typeof stat.dev !== "bigint" || typeof stat.ino !== "bigint" || stat.ino <= 0n) {
    return failObjectIdentity(entry, "object_identity_unavailable");
  }
  return { device: stat.dev, fileId: stat.ino };
}

function assertIdentityMatches(
  stat: BigIntStats,
  expected: StorageObjectIdentity,
  entry: "key" | "store",
): void {
  const actual = identityFromStat(stat, entry);
  if (actual.device !== expected.device || actual.fileId !== expected.fileId) {
    failObjectIdentity(entry, "object_identity_mismatch");
  }
}

async function revalidateOpenedObject(
  file: string,
  stat: BigIntStats,
  expected: StorageObjectIdentity,
  entry: "key" | "store",
  config: OAuthConfig,
): Promise<void> {
  assertIdentityMatches(stat, expected, entry);
  let pathStat: BigIntStats;
  try {
    pathStat = await fs.lstat(file, { bigint: true });
  } catch {
    return failObjectIdentity(entry, "object_identity_mismatch");
  }
  if (pathStat.isSymbolicLink()) return failObjectIdentity(entry, "reparse_point");
  if (!pathStat.isFile() || pathStat.nlink !== 1n) {
    return failObjectIdentity(entry, "object_identity_mismatch");
  }
  assertIdentityMatches(pathStat, expected, entry);

  const current: StoragePermissionReceipt = await verifyStoragePermissionsWithReceipt(config);
  const currentIdentity = entry === "key" ? current.keyFile : current.storeFile;
  if (!currentIdentity) return failObjectIdentity(entry, "object_identity_mismatch");
  if (currentIdentity.device !== expected.device || currentIdentity.fileId !== expected.fileId) {
    return failObjectIdentity(entry, "object_identity_mismatch");
  }
}

async function readProtectedFile(
  file: string,
  maxBytes: number,
  expected: StorageObjectIdentity,
  entry: "key" | "store",
  config: OAuthConfig,
): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | noFollow);
    const stat = await handle.stat({ bigint: true });
    validatePrivateFileStat(stat, maxBytes);
    await revalidateOpenedObject(file, stat, expected, entry, config);
    const bytes = await handle.readFile();
    if (bytes.length !== Number(stat.size) || bytes.length > maxBytes) {
      return fail("storage_recovery_required");
    }
    return bytes;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    return fail("storage_recovery_required");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readKeyFile(
  file: string,
  expected: StorageObjectIdentity,
  config: OAuthConfig,
): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | noFollow);
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || Number(stat.nlink) !== 1 || Number(stat.size) !== 32) {
      return fail("key_invalid");
    }
    if (process.platform !== "win32") {
      const uid = typeof process.getuid === "function" ? process.getuid() : -1;
      if (
        Number(stat.uid) !== uid ||
        ![0o400, 0o600].includes(Number(stat.mode) & 0o777)
      ) {
        return fail("storage_permissions");
      }
    }
    await revalidateOpenedObject(file, stat, expected, "key", config);
    const key = await handle.readFile();
    if (key.length !== 32 || key.length !== Number(stat.size)) return fail("key_invalid");
    return key;
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    return fail("key_invalid");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function createOwnedLock(dataDir: string): Promise<OwnedLock> {
  const directory = path.join(dataDir, LOCK_DIRECTORY);
  const metadataFile = path.join(directory, LOCK_METADATA_FILE);
  const lock: OwnedLock = {
    directory,
    metadataFile,
    bootId: randomUUID(),
    pid: process.pid,
  };
  try {
    await fs.mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return fail("storage_conflict");
    return fail("storage_unavailable");
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const dirStat = await fs.lstat(directory);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return fail("storage_permissions");
    if (process.platform !== "win32") {
      const uid = typeof process.getuid === "function" ? process.getuid() : -1;
      if (
        Number(dirStat.uid) !== uid ||
        (Number(dirStat.mode) & 0o777) !== PRIVATE_DIRECTORY_MODE
      ) {
        return fail("storage_permissions");
      }
    }
    handle = await fs.open(metadataFile, "wx", PRIVATE_FILE_MODE);
    const meta = lockMetadata(lock);
    if (process.platform !== "win32") {
      const fileStat = await handle.stat();
      validatePrivateFileStat(fileStat, 4_096);
    }
    await handle.writeFile(meta);
    await handle.sync();
    await handle.close();
    handle = undefined;
    return lock;
  } catch (error) {
    await handle?.close().catch(() => {});
    await cleanupUninitializedLock(lock);
    if (error instanceof OAuthError) throw error;
    return fail("storage_unavailable");
  }
}

async function cleanupUninitializedLock(lock: OwnedLock): Promise<void> {
  try {
    await fs.rmdir(lock.directory);
  } catch {
    // Do not remove unknown or nonempty lock contents.
  }
}

async function releaseOwnedLock(lock: OwnedLock): Promise<void> {
  let metadata: unknown;
  try {
    metadata = decodeJson(await fs.readFile(lock.metadataFile));
  } catch {
    return fail("storage_conflict");
  }
  if (!validateLockMetadata(metadata, lock)) return fail("storage_conflict");
  try {
    await fs.unlink(lock.metadataFile);
    await fs.rmdir(lock.directory);
  } catch {
    return fail("storage_conflict");
  }
}

async function cleanOwnedLockOnOpenFailure(lock: OwnedLock): Promise<void> {
  try {
    const metadata = decodeJson(await fs.readFile(lock.metadataFile));
    if (validateLockMetadata(metadata, lock)) {
      await fs.unlink(lock.metadataFile);
      await fs.rmdir(lock.directory);
      return;
    }
  } catch {
    try {
      await fs.rmdir(lock.directory);
    } catch {
      // Preserve anything that is not the empty directory this call created.
    }
  }
}

async function readExistingSnapshot(
  config: OAuthConfig,
  key: Buffer,
  dataDir: string,
  expectedStoreIdentity?: StorageObjectIdentity,
): Promise<LoadedState> {
  const entries = await fs.readdir(dataDir);
  const unknown = entries.filter((entry) => entry !== LOCK_DIRECTORY && entry !== STORE_FILE);
  if (unknown.length > 0) return fail("storage_recovery_required");

  const file = path.join(dataDir, STORE_FILE);
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        storeId: randomUUID(),
        generation: 0,
        records: new Map(),
        tombstones: new Map(),
      };
    }
    return fail("storage_recovery_required");
  }
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.nlink) !== 1) {
    return fail("storage_recovery_required");
  }
  if (Number(stat.size) > MAX_ENCRYPTED_BYTES) return fail("storage_corrupt");

  if (!expectedStoreIdentity) return failObjectIdentity("store", "object_identity_mismatch");
  const bytes = await readProtectedFile(
    file,
    MAX_ENCRYPTED_BYTES,
    expectedStoreIdentity,
    "store",
    config,
  );
  const envelope = validateEnvelope(decodeJson(bytes), config.owner.operatorId);
  const plaintext = decrypt(
    key,
    decodeBase64Url(envelope.nonce, 12),
    decodeBase64Url(envelope.tag, 16),
    decodeBase64Url(envelope.ciphertext),
    outerAad(envelope.format, envelope.storeId, envelope.operatorId, envelope.generation),
  );
  if (plaintext.length > MAX_DECRYPTED_BYTES) return fail("storage_corrupt");
  return decryptSnapshot(plaintext, key, config, envelope.storeId, envelope.generation);
}

function encryptSnapshot(
  state: LoadedState,
  records: Map<string, ConnectionRecord>,
  tombstones: Map<string, number>,
  generation: number,
  config: OAuthConfig,
  key: Buffer,
): Buffer {
  if (records.size > MAX_RECORDS || tombstones.size > MAX_TOMBSTONES) {
    return fail("record_invalid");
  }
  const encryptedRecords: EncryptedRecord[] = [];
  for (const record of [...records.values()].sort((left, right) => left.connectionId.localeCompare(right.connectionId))) {
    const checked = validateRecord(record, config.owner);
    const plaintext = serializeJson(checked);
    if (plaintext.length > MAX_RECORD_CIPHERTEXT_BYTES) return fail("record_invalid");
    const encrypted = encrypt(
      key,
      plaintext,
      recordAad(
        FORMAT,
        state.storeId,
        config.owner.operatorId,
        checked.connectionId,
        checked.accountId,
        checked.generation,
      ),
    );
    encryptedRecords.push({
      format: FORMAT,
      connectionId: checked.connectionId,
      accountId: checked.accountId,
      generation: checked.generation,
      nonce: encodeBase64Url(encrypted.nonce),
      tag: encodeBase64Url(encrypted.tag),
      ciphertext: encodeBase64Url(encrypted.ciphertext),
    });
  }
  const snapshot = {
    format: FORMAT,
    owner: config.owner,
    records: encryptedRecords,
    tombstones: [...tombstones.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([connectionId, deletedGeneration]) => ({
        connectionId,
        generation: deletedGeneration,
      })),
  };
  const plaintext = serializeJson(snapshot);
  if (plaintext.length > MAX_DECRYPTED_BYTES) return fail("record_invalid");
  const encryptedOuter = encrypt(
    key,
    plaintext,
    outerAad(FORMAT, state.storeId, config.owner.operatorId, generation),
  );
  const outer: OuterEnvelope = {
    format: FORMAT,
    algorithm: ALGORITHM,
    storeId: state.storeId,
    operatorId: config.owner.operatorId,
    generation,
    nonce: encodeBase64Url(encryptedOuter.nonce),
    tag: encodeBase64Url(encryptedOuter.tag),
    ciphertext: encodeBase64Url(encryptedOuter.ciphertext),
  };
  const bytes = serializeJson(outer);
  if (bytes.length > MAX_ENCRYPTED_BYTES) return fail("record_invalid");
  return bytes;
}

async function replaceAtomically(source: string, destination: string): Promise<void> {
  const attempts = process.platform === "win32" ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      const retryableWindowsSharingViolation =
        process.platform === "win32" &&
        (error as NodeJS.ErrnoException).code === "EBUSY" &&
        attempt + 1 < attempts;
      if (!retryableWindowsSharingViolation) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

async function flushDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP") return;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

class EncryptedConnectionStore implements ConnectionStore {
  private readonly mutex = new AsyncMutex();
  private state: LoadedState;
  private closed = false;
  private poisoned = false;

  constructor(
    private readonly config: OAuthConfig,
    private readonly key: Buffer,
    private readonly lock: OwnedLock,
    state: LoadedState,
  ) {
    this.state = state;
  }

  async read(id: string): Promise<ConnectionRecord | undefined> {
    return this.mutex.run(async () => {
      this.assertUsable();
      if (!validateConnectionId(id)) return fail("record_invalid");
      const record = this.state.records.get(id);
      return record === undefined ? undefined : cloneRecord(record);
    });
  }

  async put(record: ConnectionRecord, expectedGeneration: number | null): Promise<void> {
    return this.mutex.run(async () => {
      this.assertUsable();
      const checked = validateRecord(record, this.config.owner);
      const current = this.state.records.get(checked.connectionId);
      if (expectedGeneration === null) {
        if (current || this.state.tombstones.has(checked.connectionId)) {
          return fail("generation_conflict");
        }
        if (checked.generation !== 1) return fail("record_invalid");
      } else {
        if (!isSafeInteger(expectedGeneration, 1) || !current || current.generation !== expectedGeneration) {
          return fail("generation_conflict");
        }
        if (checked.generation !== expectedGeneration + 1) return fail("generation_conflict");
      }
      if (!current && this.state.records.size >= MAX_RECORDS) return fail("record_invalid");

      const records = new Map(this.state.records);
      records.set(checked.connectionId, checked);
      await this.persist(records, new Map(this.state.tombstones));
    });
  }

  async remove(id: string, expectedGeneration: number): Promise<void> {
    return this.mutex.run(async () => {
      this.assertUsable();
      if (!validateConnectionId(id) || !isSafeInteger(expectedGeneration, 1)) {
        return fail("record_invalid");
      }
      const current = this.state.records.get(id);
      if (!current || current.generation !== expectedGeneration) return fail("generation_conflict");
      if (this.state.tombstones.size >= MAX_TOMBSTONES) return fail("record_invalid");

      const records = new Map(this.state.records);
      records.delete(id);
      const tombstones = new Map(this.state.tombstones);
      tombstones.set(id, this.state.generation + 1);
      await this.persist(records, tombstones);
    });
  }

  async close(): Promise<void> {
    return this.mutex.run(async () => {
      if (this.closed) return;
      this.closed = true;
      this.key.fill(0);
      await releaseOwnedLock(this.lock);
    });
  }

  private assertUsable(): void {
    if (this.closed) return fail("store_closed");
    if (this.poisoned) return fail("storage_recovery_required");
  }

  private async persist(
    records: Map<string, ConnectionRecord>,
    tombstones: Map<string, number>,
  ): Promise<void> {
    const nextGeneration = this.state.generation + 1;
    if (!isSafeInteger(nextGeneration, 1)) return fail("record_invalid");
    const bytes = encryptSnapshot(
      this.state,
      records,
      tombstones,
      nextGeneration,
      this.config,
      this.key,
    );
    const tempFile = path.join(
      this.config.dataDir,
      `${TEMP_PREFIX}${randomUUID()}${TEMP_SUFFIX}`,
    );
    const liveFile = path.join(this.config.dataDir, STORE_FILE);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let tempCreated = false;
    let replaced = false;
    try {
      handle = await fs.open(tempFile, "wx", PRIVATE_FILE_MODE);
      tempCreated = true;
      const stat = await handle.stat();
      validatePrivateFileStat(stat, MAX_ENCRYPTED_BYTES);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await replaceAtomically(tempFile, liveFile);
      tempCreated = false;
      replaced = true;
      await flushDirectory(this.config.dataDir);
      this.state = {
        storeId: this.state.storeId,
        generation: nextGeneration,
        records,
        tombstones,
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (tempCreated) await fs.unlink(tempFile).catch(() => {});
      if (replaced) this.poisoned = true;
      if (error instanceof OAuthError) throw error;
      return fail("store_write_failed");
    }
  }
}

export async function openConnectionStore(config: OAuthConfig): Promise<ConnectionStore> {
  if (
    !config ||
    !config.owner ||
    typeof config.owner.operatorId !== "string" ||
    !OPERATOR_ID.test(config.owner.operatorId) ||
    typeof config.owner.appFingerprint !== "string" ||
    !APP_FINGERPRINT.test(config.owner.appFingerprint)
  ) {
    return fail("invalid_configuration");
  }

  const permissionReceipt = await verifyStoragePermissionsWithReceipt(config);
  if (!permissionReceipt.keyFile) return failObjectIdentity("key", "object_identity_unavailable");
  const lock = await createOwnedLock(config.dataDir);
  let key: Buffer | undefined;
  try {
    key = await readKeyFile(config.keyFile, permissionReceipt.keyFile, config);
    const state = await readExistingSnapshot(config, key, config.dataDir, permissionReceipt.storeFile);
    return new EncryptedConnectionStore(config, key, lock, state);
  } catch (error) {
    key?.fill(0);
    await cleanOwnedLockOnOpenFailure(lock);
    if (error instanceof OAuthError) throw error;
    return fail("storage_recovery_required");
  }
}
