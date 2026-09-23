import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
  const meta = {
    version: 1,
    job_id: jobId,
    created_at: new Date().toISOString(),
    state: 'starting',
    narrative,
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
    stdout: path.join(dir, 'stdout.log'),
    stderr: path.join(dir, 'stderr.log'),
  };
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

export function readJob(runtimeDirectory, jobId) {
  const dir = jobDirectory(runtimeDirectory, jobId);
  const files = jobFiles(dir);
  const meta = readJson(files.meta);
  if (!meta) throw new Error(`Unknown job_id ${jobId}`);
  const started = readJson(files.started);
  const completed = readJson(files.completed);
  const result = readJson(files.result);
  const pid = started?.pid ?? meta.pid;
  const alive = processAlive(pid);
  const state = completed
    ? (completed.exit_code === 0 ? 'completed' : 'failed')
    : started && alive ? 'running'
      : started && !alive ? 'uncertain'
        : meta.state ?? 'starting';
  return { dir, files, meta, started, completed, result, pid, alive, state };
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
