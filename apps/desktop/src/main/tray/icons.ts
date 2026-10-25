import { type NativeImage, nativeImage } from 'electron'

type Rgb = readonly [number, number, number]

/** Tray icons drawn in code: a ring when idle, a dot inside the ring while recording. */
function draw(size: number, filled: boolean, color: Rgb): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const outer = size * 0.42
  const ring = size * 0.09
  const dot = size * 0.2
  const clamp = (x: number) => Math.max(0, Math.min(1, x))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const alpha = Math.max(
        clamp(ring / 2 + 0.5 - Math.abs(d - (outer - ring / 2))),
        filled ? clamp(dot + 0.5 - d) : 0,
      )
      const i = (y * size + x) * 4
      // BGRA
      buf.set([color[2], color[1], color[0], Math.round(alpha * 255)], i)
    }
  }
  return buf
}

function icon(filled: boolean, template: boolean): NativeImage {
  const VIOLET: Rgb = [139, 124, 246]
  const AMBER: Rgb = [245, 181, 68]
  const color: Rgb = template ? [0, 0, 0] : filled ? AMBER : VIOLET
  const img = nativeImage.createEmpty()
  for (const scale of [1, 2]) {
    const size = 16 * scale
    img.addRepresentation({
      scaleFactor: scale,
      width: size,
      height: size,
      buffer: draw(size, filled, color),
    })
  }
  if (template) img.setTemplateImage(true)
  return img
}

export function trayIcons(platform: NodeJS.Platform): {
  idle: NativeImage
  recording: NativeImage
} {
  return { idle: icon(false, platform === 'darwin'), recording: icon(true, false) }
}
