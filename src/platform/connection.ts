import { platform } from 'node:os';
import { Logger } from '../utils/logger.js';
import { PhotoshopDetector } from './detector.js';
import type { ScriptExecutor } from './script-executor.js';
import { WindowsExecutor } from './windows-executor.js';
import { MacOSExecutor } from './macos-executor.js';

export interface PhotoshopInfo {
  version: string;
  path: string;
  isRunning: boolean;
  appName?: string;
}

interface PhotoshopDetectorLike {
  detect(forceRefresh?: boolean): Promise<PhotoshopInfo>;
}

export interface PhotoshopConnectionOptions {
  detector?: PhotoshopDetectorLike;
  executor?: ScriptExecutor;
  platformType?: NodeJS.Platform;
}

/**
 * Legacy external-script connection retained strictly as the pre-dispatch
 * fallback backend. Backend selection happens before any Photoshop mutation.
 * Callers must never catch a possibly-dispatched UXP command and replay it here.
 */
export class PhotoshopConnection {
  private logger: Logger;
  private detector: PhotoshopDetectorLike;
  private executor: ScriptExecutor | null;
  private platformType: NodeJS.Platform;
  private photoshopInfo: PhotoshopInfo | null = null;
  private macosExecutor?: MacOSExecutor;

  constructor(options: PhotoshopConnectionOptions = {}) {
    this.logger = new Logger('PhotoshopConnection');
    this.detector = options.detector ?? new PhotoshopDetector();
    this.executor = options.executor ?? null;
    this.platformType = options.platformType ?? platform();
    if (this.executor instanceof MacOSExecutor) this.macosExecutor = this.executor;
  }

  private getExecutor(): ScriptExecutor {
    if (this.executor) return this.executor;
    if (this.platformType === 'win32') {
      this.executor = new WindowsExecutor();
    } else if (this.platformType === 'darwin') {
      this.macosExecutor = new MacOSExecutor();
      this.executor = this.macosExecutor;
    } else {
      throw new Error(`Unsupported platform: ${this.platformType}`);
    }
    return this.executor;
  }

  private applyMacOSAppName(): void {
    if (this.macosExecutor && this.photoshopInfo?.appName) {
      this.macosExecutor.setAppName(this.photoshopInfo.appName);
    }
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.photoshopInfo) this.photoshopInfo = await this.detector.detect();
      return this.photoshopInfo !== null;
    } catch (error) {
      this.logger.error('Ping failed:', error);
      return false;
    }
  }

  async getVersion(): Promise<string> {
    try {
      if (!this.photoshopInfo) this.photoshopInfo = await this.detector.detect();
      return this.photoshopInfo?.version || 'Unknown';
    } catch (error) {
      this.logger.error('Failed to get version:', error);
      throw error;
    }
  }

  async executeScript(script: string, timeout?: number): Promise<unknown> {
    try {
      if (!this.photoshopInfo) this.photoshopInfo = await this.detector.detect();
      const executor = this.getExecutor();
      this.applyMacOSAppName();
      const isRunning = await executor.isPhotoshopRunning();
      if (!isRunning) {
        this.logger.info('Photoshop not running, launching...');
        await executor.launchPhotoshop(this.photoshopInfo.path);
      }
      return await executor.execute(script, timeout);
    } catch (error) {
      this.logger.error('Script execution failed:', error);
      throw error;
    }
  }

  getPhotoshopInfo(): PhotoshopInfo | null {
    return this.photoshopInfo;
  }

  async ensurePhotoshopRunning(): Promise<void> {
    if (!this.photoshopInfo) this.photoshopInfo = await this.detector.detect();
    const executor = this.getExecutor();
    this.applyMacOSAppName();
    if (!(await executor.isPhotoshopRunning())) {
      this.logger.info('Launching Photoshop...');
      await executor.launchPhotoshop(this.photoshopInfo.path);
    }
  }
}
