import { exec } from 'child_process';
import { promisify } from 'util';
import { access, constants, readdir } from 'fs/promises';
import { Logger } from '../utils/logger.js';
import { PhotoshopInfo } from './connection.js';

const execAsync = promisify(exec);

interface RegistryEntry {
  version: string;
  path: string;
}

export class WindowsDetector {
  private logger: Logger;

  constructor() {
    this.logger = new Logger('WindowsDetector');
  }

  async detect(): Promise<PhotoshopInfo> {
    this.logger.info('Detecting Photoshop on Windows...');

    // Try environment variable first
    const envPath = process.env.PHOTOSHOP_PATH;
    if (envPath) {
      this.logger.debug(`Using environment variable: ${envPath}`);
      const info = await this.checkPath(envPath);
      if (info) return info;
    }

    // Try registry detection
    try {
      const registryInfo = await this.detectFromRegistry();
      if (registryInfo) return registryInfo;
    } catch (error) {
      this.logger.warn('Registry detection failed:', error);
    }

    // Try common installation paths
    const commonPaths = await this.getCommonPaths();
    for (const path of commonPaths) {
      const info = await this.checkPath(path);
      if (info) return info;
    }

    throw new Error('Photoshop not found on this system');
  }

  private async detectFromRegistry(): Promise<PhotoshopInfo | null> {
    try {
      // Query Adobe registry keys
      const registryPaths = [
        'HKLM\\SOFTWARE\\Adobe\\Photoshop',
        'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop',
      ];

      for (const regPath of registryPaths) {
        try {
          const { stdout } = await execAsync(`reg query "${regPath}" /s`);
          const entries = this.parseRegistryOutput(stdout);
          
          if (entries.length > 0) {
            // Get the latest version
            const latest = entries.sort((a, b) => b.version.localeCompare(a.version))[0];
            const info = await this.checkPath(latest.path);
            if (info) return info;
          }
        } catch {
          // Continue to next registry path
          continue;
        }
      }

      // Try COM CLSID registry
      const clsidPaths = [
        'HKCR\\CLSID\\{06870682-6f3c-4b97-9143-f03e85c0bd3e}\\LocalServer32',
        'HKCR\\Wow6432Node\\CLSID\\{06870682-6f3c-4b97-9143-f03e85c0bd3e}\\LocalServer32',
      ];

      for (const clsidPath of clsidPaths) {
        try {
          const { stdout } = await execAsync(`reg query "${clsidPath}" /ve`);
          const exePath = this.extractPathFromCLSID(stdout);
          if (exePath) {
            const info = await this.checkPath(exePath);
            if (info) return info;
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      this.logger.error('Registry query failed:', error);
    }

    return null;
  }

  private parseRegistryOutput(output: string): RegistryEntry[] {
    const entries: RegistryEntry[] = [];
    const lines = output.split('\n');
    
    let currentVersion = '';
    for (const line of lines) {
      // Extract version from registry path
      const versionMatch = line.match(/Photoshop\\(\d+\.\d+)/);
      if (versionMatch) {
        currentVersion = versionMatch[1];
      }

      // Extract ApplicationPath
      const pathMatch = line.match(/ApplicationPath\s+REG_SZ\s+(.+)/);
      if (pathMatch && currentVersion) {
        entries.push({
          version: currentVersion,
          path: pathMatch[1].trim(),
        });
      }
    }

    return entries;
  }

  private extractPathFromCLSID(output: string): string | null {
    const match = output.match(/REG_SZ\s+(.+\.exe)/i);
    if (match) {
      // Remove quotes and trailing parameters
      return match[1].trim().replace(/^"(.+)".*$/, '$1');
    }
    return null;
  }

  private async getCommonPaths(): Promise<string[]> {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    const paths: string[] = [];

    // Enumerate only Adobe's immediate product directories. A frozen year list
    // silently excluded Photoshop 2026 and would fail again with each new release.
    for (const base of [programFiles, programFilesX86]) {
      try {
        const entries = await readdir(`${base}\\Adobe`, { withFileTypes: true });
        const installed = entries.filter(e => e.isDirectory() && /^Adobe Photoshop(?: CC)?(?: \d{4})?$/i.test(e.name))
          .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true })).slice(0, 64);
        paths.push(...installed.map(e => `${base}\\Adobe\\${e.name}\\Photoshop.exe`));
      } catch { /* Missing/inaccessible Adobe directory: use conventional paths. */ }
    }
    
    // Also support releases installed under a non-enumerable parent directory.
    for (let year = new Date().getFullYear() + 1; year >= 2012; year--) {
      paths.push(
        `${programFiles}\\Adobe\\Adobe Photoshop ${year}\\Photoshop.exe`,
        `${programFilesX86}\\Adobe\\Adobe Photoshop ${year}\\Photoshop.exe`,
        `${programFiles}\\Adobe\\Adobe Photoshop CC ${year}\\Photoshop.exe`,
        `${programFilesX86}\\Adobe\\Adobe Photoshop CC ${year}\\Photoshop.exe`
      );
    }

    // Also check for version-less installation
    paths.push(
      `${programFiles}\\Adobe\\Adobe Photoshop CC\\Photoshop.exe`,
      `${programFiles}\\Adobe\\Photoshop CC\\Photoshop.exe`
    );

    return paths;
  }

  private async checkPath(path: string): Promise<PhotoshopInfo | null> {
    try {
      // Clean up path
      let cleanPath = path.trim().replace(/^"|"$/g, '');
      
      // If path is a directory, append Photoshop.exe
      if (!cleanPath.toLowerCase().endsWith('.exe')) {
        cleanPath = `${cleanPath}\\Photoshop.exe`;
      }

      await access(cleanPath, constants.F_OK);
      
      const version = this.extractVersionFromPath(cleanPath);
      
      this.logger.info(`Found Photoshop at: ${cleanPath}`);
      
      return {
        version,
        path: cleanPath,
        isRunning: await this.checkIfRunning(),
      };
    } catch {
      return null;
    }
  }

  private extractVersionFromPath(path: string): string {
    // Try to extract year from path
    const yearMatch = path.match(/(\d{4})/);
    if (yearMatch) {
      return yearMatch[1];
    }

    // Try to extract version number
    const versionMatch = path.match(/(\d+\.\d+)/);
    if (versionMatch) {
      return versionMatch[1];
    }

    return 'Unknown';
  }

  private async checkIfRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Photoshop.exe"');
      return stdout.toLowerCase().includes('photoshop.exe');
    } catch {
      return false;
    }
  }
}
