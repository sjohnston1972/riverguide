#!/usr/bin/env node
// XSS regression test for formatMessage (River Guide chat renderer).
//
// formatMessage is pure string-in / string-out, so it can be tested here
// without a browser or backend. Run with: node test/format.test.js
//
// This test must FAIL against the pre-fix formatMessage (raw content
// inserted into markdown output with no HTML-escaping and no link-scheme
// check) and PASS once the escaping fix (issue #13) is applied.

'use strict';

const { formatMessage } = require('../format.js');

const xssPayloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '"><b>break</b>',
    '[x](javascript:alert(1))'
];

let failures = 0;

function fail(message) {
    failures++;
    console.error(`FAIL: ${message}`);
}

for (const payload of xssPayloads) {
    const out = formatMessage(payload);

    if (/<script[\s>]/i.test(out)) {
        fail(`payload ${JSON.stringify(payload)} produced a <script> tag\n  output: ${out}`);
    }
    // Only flag onerror=/onload= when they sit inside a real (unescaped)
    // HTML tag — e.g. `<img ... onerror=...>` — not when they appear as
    // harmless escaped text such as `&lt;img ... onerror=...&gt;`.
    if (/<[^>]*\bonerror\s*=/i.test(out)) {
        fail(`payload ${JSON.stringify(payload)} produced a live onerror= attribute\n  output: ${out}`);
    }
    if (/<[^>]*\bonload\s*=/i.test(out)) {
        fail(`payload ${JSON.stringify(payload)} produced a live onload= attribute\n  output: ${out}`);
    }
    if (/href\s*=\s*"javascript:/i.test(out)) {
        fail(`payload ${JSON.stringify(payload)} produced a javascript: link\n  output: ${out}`);
    }
    // Nothing coming out of formatMessage should contain a raw, unescaped
    // '<' followed by a tag-like name that wasn't produced by the renderer
    // itself (h2, h3, strong, em, a, ul, li, br are the only tags it emits).
    const allowedTags = /<(\/?(h2|h3|strong|em|a|ul|li|br)\b[^>]*)>/gi;
    const strippedOfAllowedTags = out.replace(allowedTags, '');
    if (/[<>]/.test(strippedOfAllowedTags)) {
        fail(`payload ${JSON.stringify(payload)} left an unescaped '<' or '>' outside the renderer's own tags\n  output: ${out}`);
    }
}

if (failures === 0) {
    console.log(`PASS: all ${xssPayloads.length} XSS payloads rendered as inert output`);
}

// Control: normal markdown must still render as expected.
const control = [
    '## Heading',
    '',
    '**bold** text and *italic* text',
    '',
    '- item one',
    '- item two',
    '',
    'See [SEPA](https://www.sepa.org.uk) for levels.'
].join('\n');

const controlOut = formatMessage(control);

const controlChecks = [
    [controlOut.includes('<h2>Heading</h2>'), 'missing <h2>Heading</h2>'],
    [controlOut.includes('<strong>bold</strong>'), 'missing <strong>bold</strong>'],
    [controlOut.includes('<em>italic</em>'), 'missing <em>italic</em>'],
    [controlOut.includes('<ul><li>item one</li>'), 'missing <ul><li>item one</li>'],
    [
        controlOut.includes('<a href="https://www.sepa.org.uk" target="_blank" rel="noopener noreferrer">SEPA</a>') ||
        controlOut.includes('<a href="https://www.sepa.org.uk" target="_blank" rel="noopener">SEPA</a>'),
        'missing expected <a href="https://www.sepa.org.uk">SEPA</a> link'
    ]
];

for (const [ok, label] of controlChecks) {
    if (!ok) fail(`control markdown check — ${label}\n  output: ${controlOut}`);
}

if (failures === 0) {
    console.log('PASS: normal markdown formatting still renders correctly');
    process.exitCode = 0;
} else {
    console.error(`\n${failures} check(s) failed`);
    process.exitCode = 1;
}
