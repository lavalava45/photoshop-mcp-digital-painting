// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const JOB_HEARTBEAT_INTERVAL_MS = 1_000;
export const JOB_HEARTBEAT_STALE_MS = 5_000;
export const JOB_DEADLINE_GRACE_MS = 5_000;

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function jobsDirectory(runtimeDirectory) {
  return path.join(runtimeDirectory, 'jobs');
}

export function jobDirectory(runtimeDirectory, jobId) {
  if (!/^job-[a-z0-9-]+$/i.test(jobId ?? '')) throw new Error('Invalid job_id');
  return path.join(jobsDirectory(runtimeDirectory), jobId);
}

export function createJob(runtimeDirectory, input, narrative) {
  const jobId = `job-${Date.now()}-${randomUUID()}`;
  const dir = jobDirectory(runtimeDirectory, jobId);
  fs.mkdirSync(dir, { recursive: true });
  atomicJson(path.join(dir, 'input.json'), input);
  const requestedTimeout = Number(input?.next_operation?.timeout_ms ?? 60_000);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout >= 1_000 && requestedTimeout <= 180_000
    ? requestedTimeout
    : 60_000;
  const meta = {
    version: 1,
    job_id: jobId,
    created_at: new Date().toISOString(),
    state: 'starting',
    owner_pid: process.pid,
    narrative,
    timeout_ms: timeoutMs,
    deadline_at: new Date(Date.now() + timeoutMs + JOB_DEADLINE_GRACE_MS).toISOString(),
    heartbeat_stale_ms: JOB_HEARTBEAT_STALE_MS,
  };
  atomicJson(path.join(dir, 'job.json'), meta);
  return { jobId, dir, meta };
}

export function updateJob(dir, patch) {
  const file = path.join(dir, 'job.json');
  const current = readJson(file) ?? {};
  const next = { ...current, ...patch, updated_at: new Date().toISOString() };
  atomicJson(file, next);
  return next;
}

export function jobFiles(dir) {
  return {
    input: path.join(dir, 'input.json'),
    meta: path.join(dir, 'job.json'),
    started: path.join(dir, 'started.json'),
    result: path.join(dir, 'result.json'),
    completed: path.join(dir, 'completed.json'),
    heartbeat: path.join(dir, 'heartbeat.json'),
    stdout: path.join(dir, 'stdout.log'),
    stderr: path.join(dir, 'stderr.log'),
  };
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

export function readJob(runtimeDirectory, jobId, capturedAt = Date.now()) {
  const dir = jobDirectory(runtimeDirectory, jobId);
  const files = jobFiles(dir);
  const meta = readJson(files.meta);
  if (!meta) throw new Error(`Unknown job_id ${jobId}`);
  const started = readJson(files.started);
  const completed = readJson(files.completed);
  const result = readJson(files.result);
  const heartbeat = readJson(files.heartbeat);
  const pid = started?.pid ?? meta.pid;
  const alive = processAlive(pid);
  const ownerPid = meta.owner_pid ?? meta.pid;
  const ownerAlive = processAlive(ownerPid);
  const heartbeatAtMs = Date.parse(heartbeat?.at ?? started?.at ?? meta.started_at ?? meta.created_at ?? '');
  const heartbeatAgeMs = Number.isFinite(heartbeatAtMs) ? Math.max(0, capturedAt - heartbeatAtMs) : null;
  const heartbeatStaleMs = Number(meta.heartbeat_stale_ms ?? JOB_HEARTBEAT_STALE_MS);
  const heartbeatStale = !!started && alive && heartbeatAgeMs !== null && heartbeatAgeMs > heartbeatStaleMs;
  const deadlineAtMs = Date.parse(meta.deadline_at ?? '');
  const deadlineExceeded = !!started && alive && Number.isFinite(deadlineAtMs) && capturedAt > deadlineAtMs;
  const ownerExitedBeforeStart = !started && Number.isSafeInteger(ownerPid) && ownerPid > 0 && !ownerAlive;
  const startDeadlineExceeded = !started && Number.isFinite(deadlineAtMs) && capturedAt > deadlineAtMs;
  const stalled = heartbeatStale || deadlineExceeded;
  const stallReason = ownerExitedBeforeStart
    ? 'owner_process_exited_before_start'
    : startDeadlineExceeded
      ? 'start_deadline_exceeded'
      : deadlineExceeded
        ? 'deadline_exceeded'
        : heartbeatStale ? 'heartbeat_stale' : null;
  const state = completed
    ? (completed.exit_code === 0 ? 'completed' : 'failed')
    : !started && (ownerExitedBeforeStart || startDeadlineExceeded) ? 'failed'
      : started && alive && stalled ? 'stalled'
        : started && alive ? 'running'
          : started && !alive ? 'uncertain'
            : meta.state ?? 'starting';
  return {
    dir, files, meta, started, completed, result, heartbeat, pid, alive, state,
    heartbeat_age_ms: heartbeatAgeMs,
    deadline_at: meta.deadline_at ?? null,
    stall_reason: stallReason,
  };
}

export async function waitForJobStart(runtimeDirectory, jobId, timeoutMs = 2_500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = readJob(runtimeDirectory, jobId);
    if (job.started || job.completed || job.state === 'uncertain' || job.state === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return readJob(runtimeDirectory, jobId);
}

export function writeJobStarted(dir, data = {}) {
  const files = jobFiles(dir);
  const body = { pid: process.pid, at: new Date().toISOString(), ...data };
  atomicJson(files.started, body);
  updateJob(dir, {
    state: 'running',
    progress_state: data.progress_state ?? 'starting',
    pid: process.pid,
    started_at: body.at,
    ...data,
  });
  writeJobHeartbeat(dir, { progress_state: data.progress_state ?? 'starting' });
  return body;
}

export function writeJobHeartbeat(dir, data = {}) {
  const body = { pid: process.pid, at: new Date().toISOString(), ...data };
  atomicJson(jobFiles(dir).heartbeat, body);
  return body;
}

export function writeJobResult(dir, result) {
  atomicJson(jobFiles(dir).result, result);
}

export function writeJobCompleted(dir, exitCode, extra = {}) {
  const body = { pid: process.pid, at: new Date().toISOString(), exit_code: exitCode, ...extra };
  atomicJson(jobFiles(dir).completed, body);
  updateJob(dir, { state: exitCode === 0 ? 'completed' : 'failed', completed_at: body.at });
  return body;
}
