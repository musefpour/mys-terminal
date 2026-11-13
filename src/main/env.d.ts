// electron-vite exposes MAIN_VITE_* variables to the main process at build time.
interface ImportMetaEnv {
  readonly MAIN_VITE_UPDATE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// zmodem.js ships no types; only the parts the terminal transfer uses.
declare module 'zmodem.js' {
  namespace Zmodem {
    interface Transfer {
      get_details(): { name: string; size?: number; mtime?: Date }
      get_offset(): number
      accept(): Promise<void>
      skip(): void
      send(chunk: Uint8Array): void
      end(chunk?: Uint8Array): Promise<void>
      on(event: 'input', fn: (payload: Uint8Array) => void): void
    }
    interface Session {
      type: 'send' | 'receive'
      on(event: 'offer', fn: (xfer: Transfer) => void): void
      on(event: 'session_end', fn: () => void): void
      start(): void
      abort(): void
      aborted(): boolean
      close(): Promise<void>
      send_offer(params: { name: string; size: number; mtime: Date; files_remaining: number; bytes_remaining: number }): Promise<Transfer | undefined>
    }
    interface Detection {
      confirm(): Session
      deny(): void
    }
    class Sentry {
      constructor(options: {
        to_terminal: (octets: number[] | Uint8Array) => void
        sender: (octets: number[] | Uint8Array) => void
        on_detect: (detection: Detection) => void
        on_retract: () => void
      })
      consume(input: Uint8Array | number[]): void
    }
  }
  export default Zmodem
}
