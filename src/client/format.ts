// River Guide — chat message formatting (markdown-lite, XSS-safe).
//
// Pure string-in / string-out functions with no DOM dependency, so they can
// be unit tested in Node (test/format.test.ts).

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/**
 * Markdown-lite: ## / ### headings, **bold**, *italic*, [text](url) for
 * http(s)/mailto only, "- " bullets and line breaks.
 *
 * The raw content is escaped FIRST. Both user-typed and assistant text are
 * untrusted (the assistant can echo third-party data or be steered by a
 * crafted prompt). The markdown tokens are plain ASCII unaffected by escaping
 * &, <, >, ", ', so transforming the escaped string cannot be bypassed by
 * embedding real HTML in the message.
 */
export function formatMessage(content: string): string {
  // NULs are reserved for the link placeholders below.
  let f = escapeHtml(content.replace(/\u0000/g, ''));

  // Links first, parked behind placeholders so bold/italic markers inside a
  // URL can't inject tags into the href. Unsafe schemes (javascript:, data:,
  // vbscript: ...) fall back to plain text. The URL is already escaped, so it
  // can't break out of the attribute.
  const links: string[] = [];
  f = f.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    if (!SAFE_LINK.test(url)) return text;
    links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });

  // Headings
  f = f.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  f = f.replace(/^## (.+)$/gm, '<h2>$1</h2>');

  // Bold, then italic
  f = f.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  f = f.replace(/(?<!\*)\*(?![*\s])(.+?)(?<![*\s])\*(?!\*)/g, '<em>$1</em>');

  // Bullet lists: consecutive "- " lines become one <ul>.
  f = f.replace(/^- (.+)$/gm, '<li>$1</li>');
  f = f.replace(/(?:<li>.*<\/li>(?:\n|$))+/g, (m) => {
    const trailing = m.endsWith('\n') ? '\n' : '';
    return `<ul>${m.replace(/\n/g, '')}</ul>${trailing}`;
  });

  // Line breaks, minus the redundant ones after block elements.
  f = f.replace(/\n/g, '<br>');
  f = f.replace(/(<\/h[23]>)<br>/g, '$1');
  f = f.replace(/(<\/ul>)<br>/g, '$1');

  // Restore links.
  f = f.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '');
  return f;
}
