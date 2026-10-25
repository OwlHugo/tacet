import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
  protocol,
  session,
} from 'electron'
import type { z } from 'zod'
import { invalidArguments } from '../shared/contract.ts'

/** The renderer is served from tacet://app/, never from file://. */
const SCHEME = 'tacet'
const APP_URL = `${SCHEME}://app`

/** Must run before app.ready. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

/** Serve the built renderer, refusing any path that escapes its folder. */
export function serveRenderer(root: string): void {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    const file = normalize(join(root, decodeURIComponent(url.pathname)))
    if (url.host !== 'app' || !file.startsWith(root + sep))
      return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

export const pageUrl = (page: 'index' | 'recorder', devUrl: string | undefined) =>
  devUrl ? `${devUrl}/${page}.html` : `${APP_URL}/${page}.html`

/** Only our own pages may talk to the main process (Electron security checklist, item 17). */
function trustedSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  devUrl: string | undefined,
): boolean {
  const frame = event.senderFrame
  if (!frame) return false
  const url = new URL(frame.url)
  // WHATWG gives custom schemes an opaque "null" origin, so compare scheme and host instead.
  if (url.protocol === `${SCHEME}:` && url.host === 'app') return true
  return devUrl !== undefined && url.origin === new URL(devUrl).origin
}

/** ipcMain.handle that rejects unknown senders and parses the arguments before the handler runs. */
export function handle<S extends z.ZodType<readonly unknown[]>, R>(
  channel: string,
  schema: S,
  devUrl: string | undefined,
  handler: (...args: z.infer<S>) => R,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!trustedSender(event, devUrl)) throw new Error(`IPC ${channel} from an untrusted frame`)
    const parsed = schema.safeParse(args)
    // The renderer shows this message: the schema's own words, not zod's JSON dump.
    if (!parsed.success)
      throw new Error(invalidArguments(channel, parsed.error), { cause: parsed.error })
    return handler(...parsed.data)
  })
}

/** Same for fire-and-forget messages. Bad input is dropped: there is nobody to answer. */
export function listen<S extends z.ZodType<readonly unknown[]>>(
  channel: string,
  schema: S,
  devUrl: string | undefined,
  handler: (...args: z.infer<S>) => void,
): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    const parsed = schema.safeParse(args)
    if (trustedSender(event, devUrl) && parsed.success) handler(...parsed.data)
  })
}

/** Microphone and screen capture (for system audio) only; everything else is denied. */
export function lockDownSession(): void {
  const allowed = new Set(['media', 'display-capture'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(allowed.has(permission)),
  )
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
}

/** No new windows, no navigation away from our pages. */
export function lockDownWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
}

export const SECURE_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
} as const
