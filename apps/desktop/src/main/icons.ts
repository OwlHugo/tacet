import { nativeImage, type NativeImage } from 'electron';

/**
 * Tray icons drawn from code so there are no binary assets to keep in sync.
 * Idle: a ring. Recording: a filled dot inside the ring.
 */
function draw(size: number, filled: boolean, color: [number, number, number]): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size * 0.42;
  const ring = size * 0.09;
  const dot = size * 0.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const ringA = Math.max(0, Math.min(1, ring / 2 + 0.5 - Math.abs(d - (outer - ring / 2))));
      const dotA = filled ? Math.max(0, Math.min(1, dot + 0.5 - d)) : 0;
      const a = Math.max(ringA, dotA);
      const i = (y * size + x) * 4;
      // BGRA
      buf[i] = color[2];
      buf[i + 1] = color[1];
      buf[i + 2] = color[0];
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

function icon(filled: boolean, template: boolean): NativeImage {
  const color: [number, number, number] = template ? [0, 0, 0] : filled ? [245, 181, 68] : [139, 124, 246];
  const img = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = 16 * scale;
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: draw(size, filled, color) });
  }
  if (template) img.setTemplateImage(true);
  return img;
}

export const trayIcons = () => {
  const mac = process.platform === 'darwin';
  return { idle: icon(false, mac), recording: icon(true, false) };
};
