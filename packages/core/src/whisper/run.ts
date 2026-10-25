import { spawn } from 'node:child_process'

/** Run a binary with array arguments (never a shell). Rejects with the tail of stderr. */
export function run(bin: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-20000)
    })
    child.on('error', (cause) => reject(new Error(`Could not start ${bin}`, { cause })))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else
        reject(new Error(`${bin} exited with ${code}: ${stderr.split('\n').slice(-8).join('\n')}`))
    })
  })
}
