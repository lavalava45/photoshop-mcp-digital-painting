import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { RUNTIME_STATE_VERSION } from './protocol-version.js';

export const RUNTIME_STATE_MANIFEST = 'runtime-state.json' as const;
export const PAINTING_STATE_FILE = 'painting-state.json' as const;

type InventoryRow = {
  relative_path: string;
  bytes: number;
  lines: number;
  sha256: string;
};

export type RuntimeArchiveManifest = {
  archive_schema: 'photoshop.guard.runtime-archive.v1';
  archived_at: string;
  source_runtime_root: string;
  source_runtime_state_version: string;
  runtime: InventoryRow[];
  run_state: InventoryRow[];
  totals: { files: number; bytes: number; lines: number };
  verified: true;
  purpose: 'diagnostic-read-only';
};

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function countLines(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  const text = buffer.toString('utf8');
  return text.split(/\r?\n/).length;
}

function inventoryTree(root: string): InventoryRow[] {
  if (!fs.existsSync(root)) return [];
  const rows: InventoryRow[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = fs.readFileSync(absolute);
      rows.push({
        relative_path: path.relative(root, absolute).split(path.sep).join('/'),
        bytes: bytes.length,
        lines: countLines(bytes),
        sha256: sha256(bytes),
      });
    }
  };
  walk(root);
  return rows.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

function assertSameInventory(expected: InventoryRow[], actual: InventoryRow[], label: string): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`runtime_archive_verification_failed: ${label} inventory/hash mismatch`);
  }
}

function assertArchiveOutsideRuntime(runtimeRoot: string, archiveDirectory: string): void {
  const runtime = path.resolve(runtimeRoot);
  const archive = path.resolve(archiveDirectory);
  const rel = path.relative(runtime, archive);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error('runtime_archive_invalid_path: archive directory must be outside the active runtime root');
  }
}

export function runtimeStateSchemaError(actual: unknown): Error {
  const error = new Error(
    `runtime_state_schema_mismatch: expected ${RUNTIME_STATE_VERSION}, received ${String(actual ?? 'missing')}`
  );
  Object.assign(error, { code: 'runtime_state_schema_mismatch' });
  return error;
}

export function emptyPaintingState(): Record<string, unknown> {
  return {
    schema_version: RUNTIME_STATE_VERSION,
    version: 2,
    revision: 0,
    documents: {},
  };
}

export function initializeRuntimeStateDirectory(directory: string): void {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) {
    throw new Error(`runtime_state_not_empty: refusing to initialize non-empty directory ${resolved}`);
  }
  fs.mkdirSync(resolved, { recursive: true });
  fs.writeFileSync(path.join(resolved, RUNTIME_STATE_MANIFEST), JSON.stringify({
    schema_version: RUNTIME_STATE_VERSION,
    created_at: new Date().toISOString(),
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(resolved, PAINTING_STATE_FILE), JSON.stringify(emptyPaintingState(), null, 2) + '\n');
}

export function assertCurrentRuntimeStateDirectory(directory: string): void {
  const resolved = path.resolve(directory);
  if (!fs.existsSync(resolved)) {
    initializeRuntimeStateDirectory(resolved);
    return;
  }
  const entries = fs.readdirSync(resolved);
  if (entries.length === 0) {
    initializeRuntimeStateDirectory(resolved);
    return;
  }
  const manifestPath = path.join(resolved, RUNTIME_STATE_MANIFEST);
  if (!fs.existsSync(manifestPath)) throw runtimeStateSchemaError(undefined);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw runtimeStateSchemaError('corrupt');
  }
  if (manifest.schema_version !== RUNTIME_STATE_VERSION) {
    throw runtimeStateSchemaError(manifest.schema_version);
  }
  const paintingPath = path.join(resolved, PAINTING_STATE_FILE);
  if (!fs.existsSync(paintingPath)) throw runtimeStateSchemaError('missing-painting-state');
  let painting: Record<string, unknown>;
  try {
    painting = JSON.parse(fs.readFileSync(paintingPath, 'utf8'));
  } catch {
    throw runtimeStateSchemaError('corrupt-painting-state');
  }
  if (painting.schema_version !== RUNTIME_STATE_VERSION) {
    throw runtimeStateSchemaError(painting.schema_version);
  }
}

export function assertCurrentRuntimeRecord(record: Record<string, unknown>, label = 'operation'): void {
  if (record.runtime_state_version !== RUNTIME_STATE_VERSION) {
    throw runtimeStateSchemaError(record.runtime_state_version ?? `${label}:missing`);
  }
}

function copyFileVerified(source: string, destination: string): InventoryRow {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const sourceBytes = fs.readFileSync(source);
  const destinationBytes = fs.readFileSync(destination);
  if (sourceBytes.length !== destinationBytes.length || sha256(sourceBytes) !== sha256(destinationBytes)) {
    throw new Error(`runtime_archive_verification_failed: copied file mismatch for ${source}`);
  }
  return {
    relative_path: path.basename(destination),
    bytes: destinationBytes.length,
    lines: countLines(destinationBytes),
    sha256: sha256(destinationBytes),
  };
}

export function createRuntimeStateArchive(options: {
  runtimeRoot: string;
  archiveDirectory: string;
  runStateFiles?: string[];
}): RuntimeArchiveManifest {
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const archiveDirectory = path.resolve(options.archiveDirectory);
  assertArchiveOutsideRuntime(runtimeRoot, archiveDirectory);
  if (!fs.existsSync(runtimeRoot)) {
    throw new Error(`runtime_archive_source_missing: ${runtimeRoot}`);
  }
  if (fs.existsSync(archiveDirectory)) {
    throw new Error(`runtime_archive_exists: ${archiveDirectory}`);
  }

  const sourceInventory = inventoryTree(runtimeRoot);
  let sourceRuntimeStateVersion = 'missing';
  const sourceManifestPath = path.join(runtimeRoot, 'controller', RUNTIME_STATE_MANIFEST);
  if (fs.existsSync(sourceManifestPath)) {
    try {
      const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
      sourceRuntimeStateVersion = String(sourceManifest?.schema_version ?? 'missing');
    } catch {
      sourceRuntimeStateVersion = 'corrupt';
    }
  }
  fs.mkdirSync(archiveDirectory, { recursive: true });
  const runtimeSnapshot = path.join(archiveDirectory, 'runtime');
  fs.cpSync(runtimeRoot, runtimeSnapshot, { recursive: true, errorOnExist: true, force: false });
  const archivedInventory = inventoryTree(runtimeSnapshot);
  assertSameInventory(sourceInventory, archivedInventory, 'runtime');

  const runStateRows: InventoryRow[] = [];
  const runStateRoot = path.join(archiveDirectory, 'run-state');
  for (const [index, file] of [...new Set(options.runStateFiles ?? [])].entries()) {
    const source = path.resolve(file);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new Error(`runtime_archive_run_state_missing: ${source}`);
    }
    const destination = path.join(runStateRoot, `${String(index + 1).padStart(3, '0')}-${path.basename(source)}`);
    const row = copyFileVerified(source, destination);
    row.relative_path = path.relative(archiveDirectory, destination).split(path.sep).join('/');
    runStateRows.push(row);
  }

  const runtimeRows = archivedInventory.map(row => ({ ...row, relative_path: `runtime/${row.relative_path}` }));
  const all = [...runtimeRows, ...runStateRows];
  const manifest: RuntimeArchiveManifest = {
    archive_schema: 'photoshop.guard.runtime-archive.v1',
    archived_at: new Date().toISOString(),
    source_runtime_root: runtimeRoot,
    source_runtime_state_version: sourceRuntimeStateVersion,
    runtime: runtimeRows,
    run_state: runStateRows,
    totals: {
      files: all.length,
      bytes: all.reduce((sum, row) => sum + row.bytes, 0),
      lines: all.reduce((sum, row) => sum + row.lines, 0),
    },
    verified: true,
    purpose: 'diagnostic-read-only',
  };
  fs.writeFileSync(path.join(archiveDirectory, 'archive-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

export function cutoverRuntimeStateV2(options: {
  runtimeRoot: string;
  archiveDirectory: string;
  runStateFiles?: string[];
}): RuntimeArchiveManifest {
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const archiveDirectory = path.resolve(options.archiveDirectory);
  const manifest = createRuntimeStateArchive({
    runtimeRoot,
    archiveDirectory,
    runStateFiles: options.runStateFiles,
  });

  const retiredRuntime = path.join(archiveDirectory, 'retired-active-runtime');
  fs.renameSync(runtimeRoot, retiredRuntime);
  const retiredInventory = inventoryTree(retiredRuntime);
  const expectedRetired = manifest.runtime.map(row => ({
    ...row,
    relative_path: row.relative_path.replace(/^runtime\//, ''),
  }));
  assertSameInventory(expectedRetired, retiredInventory, 'retired active runtime');

  const staging = `${runtimeRoot}.v2-${randomUUID()}`;
  initializeRuntimeStateDirectory(path.join(staging, 'controller'));
  fs.mkdirSync(path.join(staging, 'preview-barriers'), { recursive: true });
  fs.renameSync(staging, runtimeRoot);
  return manifest;
}
