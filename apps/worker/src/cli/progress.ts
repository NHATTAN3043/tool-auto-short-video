/** Prints render progress to stderr every 5%, so a long render visibly moves. */
export function progressPrinter(label: string): (progress: number) => void {
  let lastStep = -1;
  return (progress) => {
    const step = Math.floor(progress * 20);
    if (step === lastStep) return;
    lastStep = step;
    process.stderr.write(`[${label}] ${String(step * 5)}%\n`);
  };
}

export function timestampName(prefix: string, date = new Date()): string {
  return `${prefix}-${date.toISOString().replace(/[:.]/gu, "-")}`;
}
