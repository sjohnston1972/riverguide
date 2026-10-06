// Incremental parser for a text/event-stream body (data-only events).

export class SseParser {
  private buf = '';

  /** Feed a decoded chunk; returns the `data` payloads of any complete events. */
  push(chunk: string): string[] {
    this.buf += chunk.replace(/\r\n?/g, '\n');
    const out: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) out.push(data);
    }
    return out;
  }
}
