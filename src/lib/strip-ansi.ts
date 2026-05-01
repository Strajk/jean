// Strips ANSI escape codes (colors, formatting) from strings.
// These appear in Bash tool output (e.g. tsc --pretty, colored grep).
// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}
