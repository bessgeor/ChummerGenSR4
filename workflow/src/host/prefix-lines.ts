/** Splits a child's output into lines and writes each with the label prefixed; `flush` writes an unfinished last line. */
export function prefixLines(label: string, write: (text: string) => void) {
  let pending = "";
  return {
    push(chunk: string) {
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) write(`[${label}] ${line}\n`);
    },
    flush() {
      if (pending.length > 0) write(`[${label}] ${pending}\n`);
      pending = "";
    },
  };
}
