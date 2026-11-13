/** Two or more non-empty lines; one trailing newline alone does not count. */
export function isMultiline(text: string): boolean {
  return /\r?\n/.test(text.replace(/(\r?\n)+$/, ''))
}

/**
 * A dropped file or folder path, quoted for the shell that receives it.
 * POSIX shells get single quotes (only when needed); PowerShell/cmd get double quotes.
 */
export function quotePath(path: string, style: 'posix' | 'windows'): string {
  if (style === 'windows') return /[\s&()^;,'`$%!]/.test(path) ? `"${path.replace(/"/g, '""')}"` : path
  if (/^[\w@%+=:,./-]+$/.test(path)) return path
  return `'${path.replace(/'/g, `'\\''`)}'`
}
