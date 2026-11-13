import type { Macro } from '../../shared/types'

/** The text to send for a snippet; secrets are fetched from the main process on demand. */
export async function snippetCommand(macro: Macro): Promise<string> {
  return macro.secret ? window.mys.macros.reveal(macro.id) : macro.command
}
