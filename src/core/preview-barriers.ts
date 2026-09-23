import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface PendingPreviewBarrier {
  planId: string;
  operationId?: string;
  operationSequence?: number;
  sha256?: string;
  requiresExternalPreview: boolean;
}

/** Disk is authoritative when configured; never turn a corrupt checkpoint into an open gate. */
export class PreviewBarriers {
  private memory = new Map<number, PendingPreviewBarrier>();
  constructor(private directory?: string) {}

  get(id: number): PendingPreviewBarrier | undefined {
    if (!this.directory) return this.memory.get(id);
    try {
      const value = JSON.parse(readFileSync(join(this.directory, `${id}.json`), 'utf8'));
      if (typeof value.planId !== 'string' || typeof value.requiresExternalPreview !== 'boolean' ||
          (value.operationId !== undefined && typeof value.operationId !== 'string') ||
          (value.operationSequence !== undefined && (!Number.isSafeInteger(value.operationSequence) || value.operationSequence <= 0)) ||
          (value.sha256 !== undefined && typeof value.sha256 !== 'string')) throw new Error('Invalid preview barrier');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  set(id: number, value: PendingPreviewBarrier): void {
    if (!this.directory) { this.memory.set(id, value); return; }
    mkdirSync(this.directory, { recursive: true });
    const target = join(this.directory, `${id}.json`);
    const temp = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(value));
    renameSync(temp, target);
  }

  delete(id: number): void {
    if (!this.directory) { this.memory.delete(id); return; }
    try { unlinkSync(join(this.directory, `${id}.json`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
