// Strips ANSI escape codes (colors, formatting) from strings.
// These appear in Bash tool output (e.g. tsc --pretty, colored grep).
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}
