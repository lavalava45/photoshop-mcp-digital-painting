import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createStateTools } from '../src/tools/state-tools.js';
import type { PhotoshopConnection } from '../src/platform/connection.js';
import type { PhotoshopBackendRouter } from '../src/platform/photoshop-backend.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function jpegBytes(width: number, height: number, rgb: [number, number, number]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width, height }, 90).data);
}

describe('photoshop_get_preview focus bundle', () => {
  it('materializes whole + focus from one UXP backend capture without legacy script execution', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-preview-bundle-'));
    cleanup.push(dir);
    const wholeSource = jpegBytes(8, 6, [80, 120, 160]);
    const focusSource = jpegBytes(4, 3, [200, 140, 60]);

    let captures = 0;
    const fakeRouter = {
      capturePreview: async () => {
        captures += 1;
        return {
          transport: 'uxp' as const,
          whole: {
            base64: wholeSource.toString('base64'),
            width: 8,
            height: 6,
            mimeType: 'image/jpeg',
            canvasWidth: 16,
            canvasHeight: 12,
          },
          focus: {
            base64: focusSource.toString('base64'),
            width: 4,
            height: 3,
            mimeType: 'image/jpeg',
            region: { left: 10, top: 20, right: 14, bottom: 23 },
            canvasWidth: 16,
            canvasHeight: 12,
          },
        };
      },
    } as unknown as PhotoshopBackendRouter;
    const fakeConnection = {} as PhotoshopConnection;

    const preview = createStateTools(fakeConnection, fakeRouter)
      .find(def => def.tool.name === 'photoshop_get_preview');
    expect(preview).toBeDefined();
    const materialized = path.join(dir, 'out.jpg');
    const result = await preview!.handler({
      include_image: false,
      materialize_path: materialized,
      max_dimension_px: 1000,
      focus_region: { left: 10, top: 20, right: 14, bottom: 23 },
      focus_max_dimension_px: 1200,
      quality: 8,
    });

    expect(result.isError).not.toBe(true);
    expect(captures).toBe(1);
    const wholeMaterialized = await readFile(materialized);
    const focusMaterialized = await readFile(path.join(dir, 'out-focus.jpg'));

    const text = result.content.find(item => item.type === 'text');
    expect(text && 'text' in text).toBe(true);
    const meta = JSON.parse((text as { text: string }).text);
    expect(meta.sha256).toBe(createHash('sha256').update(wholeMaterialized).digest('hex'));
    expect(meta).toMatchObject({
      canvas_width: 16,
      canvas_height: 12,
      scale_x: 0.5,
      scale_y: 0.5,
    });
    expect(meta.focus.sha256).toBe(createHash('sha256').update(focusMaterialized).digest('hex'));
    expect(meta.focus.region).toEqual({ left: 10, top: 20, right: 14, bottom: 23 });
    expect(meta.focus).toMatchObject({
      canvas_width: 16,
      canvas_height: 12,
      scale_x: 1,
      scale_y: 1,
    });
  });
});
