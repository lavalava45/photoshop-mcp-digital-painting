/** A timed-out queued script must never execute later. An active timeout is ambiguous. */
export class ScriptQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private uncertain = false;

  execute<T>(run: (remainingMs: number) => Promise<T>, timeout: number): Promise<T> {
    if (!Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new Error('Invalid script timeout'));
    const deadline = Date.now() + timeout;
    let expired = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout>;
    const result = new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        if (started) this.uncertain = true;
        reject(new Error(started
          ? 'Script execution timeout; Photoshop outcome uncertain. Reconcile state before any retry.'
          : 'Script queue timeout; script not executed.'));
      }, timeout);
      this.tail = this.tail.then(async () => {
        if (expired) return;
        if (this.uncertain) throw new Error('Prior script outcome uncertain; this script was not executed. Reconnect and reconcile.');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Script queue timeout; script not executed.');
        started = true;
        try {
          resolve(await run(remaining));
        } catch (error) {
          // A killed script host is not proof that Photoshop stopped its JSX.
          if ((error as { killed?: boolean }).killed) this.uncertain = true;
          reject(error);
        }
      }).catch(reject).finally(() => clearTimeout(timer));
    });
    return result;
  }
}
