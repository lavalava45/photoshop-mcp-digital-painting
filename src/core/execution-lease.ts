import { mkdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/** One Photoshop process is shared by all MCP clients, not just one Node queue. */
export class ExecutionLease {
  constructor(private file: string) {}
  acquire(tool: string): () => void {
    mkdirSync(dirname(this.file), { recursive: true });
    let fd: number;
    try { fd = openSync(this.file, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Photoshop execution busy or interrupted; inspect ${this.file}. Do not replay a mutation. Use the embedded Guard status/recover-lock workflow (or the compatibility controller while migrating).`);
      }
      throw error;
    }
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, tool, at: new Date().toISOString() })); }
    catch (error) { closeSync(fd); unlinkSync(this.file); throw error; }
    closeSync(fd);
    return () => unlinkSync(this.file);
  }
}
