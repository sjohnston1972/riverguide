// River Guide — chat message formatting (markdown-lite, XSS-safe)
//
// Pure functions, no DOM dependencies, so this file works both as a plain
// browser <script> (see index.html) and as a Node module for the
// regression test in test/format.test.js.

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
}

// Markdown-lite formatting
function formatMessage(content) {
    // Escape the raw content FIRST, before any markdown transform. Both
    // user-typed and assistant-returned text are untrusted — the assistant
    // reply can echo third-party data (river guide JSON, SEPA, weather) or
    // be steered by a crafted prompt, so it gets the same treatment as user
    // input. The markdown tokens below (**, ##, -, []()) are plain ASCII
    // and unaffected by escaping &, <, >, ", ', so escaping first and then
    // running the markdown replacements on the escaped string is safe and
    // cannot be bypassed by embedding real HTML in the message.
    let f = escapeHtml(content);

    // Headers: ## and ###
    f = f.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    f = f.replace(/^## (.+)$/gm, '<h2>$1</h2>');

    // Bold
    f = f.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic
    f = f.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Links [text](url) — only http(s)/mailto schemes become a clickable
    // link; everything else (javascript:, data:, vbscript:, etc.) is
    // rendered as plain text instead. `url` is already HTML-escaped above,
    // so it cannot break out of the href attribute.
    f = f.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) =>
        /^https?:\/\//i.test(url) || /^mailto:/i.test(url)
            ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
            : text);

    // Bullet lists
    f = f.replace(/^- (.+)$/gm, '<li>$1</li>');
    f = f.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');

    // Line breaks (but not inside tags)
    f = f.replace(/\n/g, '<br>');

    // Clean up double breaks after block elements
    f = f.replace(/(<\/h[23]>)<br>/g, '$1');
    f = f.replace(/(<\/ul>)<br>/g, '$1');
    f = f.replace(/(<ul>)<br>/g, '$1');

    return f;
}

// Expose to Node for the test suite; plain <script> usage in the browser
// leaves `module` undefined, so this is a no-op there.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, formatMessage };
}
