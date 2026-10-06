const https = require('https');
const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, 'scotland_rivers_detail.json');
const OUTPUT = path.join(__dirname, 'scotland_rivers_detail_clean.json');
const PROGRESS = path.join(__dirname, 'depersonalize_progress.json');
const API_KEY = process.env.ANTHROPIC_API_KEY;

const FIELDS = ['where_is_it', 'general_description', 'major_hazards', 'water_level', 'other_notes', 'access_hassles'];

const SYSTEM_PROMPT = `You are a technical editor rewriting river paddling guide entries. You will receive a JSON object with text fields. Rewrite each field to depersonalise it while keeping ALL factual content.

REMOVE:
- Personal names (first names, surnames, nicknames, initials)
- First-person language — rewrite "I/we/my/our" into third person or imperative
- Named attributions ("Chris adds..", "Dave (March 2005)..")
- Community calls to action ("let us know", "anyone seen it?")
- Photo/video credits and URLs

KEEP EVERYTHING ELSE — reword it, don't delete it:
- ALL paddling descriptions, rapid-by-rapid breakdowns, route details
- ALL safety warnings, hazard descriptions, incident descriptions (just remove names)
- ALL put-in/take-out locations, grid references, distances, times
- ALL water level guidance, gauge info, dam release info
- ALL practical tips, portage descriptions, parking info, access notes
- ALL descriptions of what happens at different water levels
- ALL information about features, falls, stoppers, holes, eddies, play spots

The goal is to reword every sentence into objective guidebook style, NOT to shorten or summarise. Keep the same level of detail. If someone describes a dangerous incident, keep the safety lesson but remove their name.

Return ONLY a valid JSON object with the same field names and rewritten values. No markdown wrapping, no explanation.`;

function callAPI(payload) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(payload);
        const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: 60000
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (res.statusCode === 429) {
                        resolve({ retry: true, data: parsed });
                    } else if (res.statusCode !== 200) {
                        reject(new Error(`API ${res.statusCode}: ${body.substring(0, 200)}`));
                    } else {
                        resolve({ retry: false, data: parsed });
                    }
                } catch (e) { reject(e); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function processEntry(entry) {
    const fieldsToProcess = {};
    for (const f of FIELDS) {
        if (entry[f] && entry[f].trim()) fieldsToProcess[f] = entry[f];
    }
    if (Object.keys(fieldsToProcess).length === 0) return {};

    const userMsg = JSON.stringify(fieldsToProcess);

    let attempts = 0;
    while (attempts < 5) {
        attempts++;
        try {
            const result = await callAPI({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 8192,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userMsg }]
            });

            if (result.retry) {
                const wait = Math.min(60000, 5000 * attempts);
                console.log(`  Rate limited, waiting ${wait/1000}s...`);
                await sleep(wait);
                continue;
            }

            const text = result.data.content[0].text;
            // Extract JSON from response (handle potential markdown wrapping)
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON in response');
            return JSON.parse(jsonMatch[0]);
        } catch (err) {
            console.error(`  Attempt ${attempts} failed: ${err.message}`);
            if (attempts < 5) await sleep(3000);
        }
    }
    throw new Error('Max retries exceeded');
}

async function main() {
    const data = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));
    console.log(`Loaded ${data.length} entries`);

    // Load progress
    let progress = {};
    if (fs.existsSync(PROGRESS)) {
        progress = JSON.parse(fs.readFileSync(PROGRESS, 'utf-8'));
        console.log(`Resuming — ${Object.keys(progress).length} already done`);
    }

    for (let i = 0; i < data.length; i++) {
        const entry = data[i];
        const key = entry.page_name || entry.name_of_river || `entry_${i}`;

        if (progress[key]) {
            // Apply saved results
            for (const [f, v] of Object.entries(progress[key])) {
                entry[f] = v;
            }
            continue;
        }

        console.log(`[${i+1}/${data.length}] ${key}`);
        try {
            const cleaned = await processEntry(entry);
            for (const [f, v] of Object.entries(cleaned)) {
                if (FIELDS.includes(f)) entry[f] = v;
            }
            progress[key] = cleaned;

            // Save progress every 5 entries
            if ((i + 1) % 5 === 0) {
                fs.writeFileSync(PROGRESS, JSON.stringify(progress));
                console.log(`  Progress saved (${Object.keys(progress).length} done)`);
            }

            // Small delay between calls
            await sleep(500);
        } catch (err) {
            console.error(`  FAILED: ${key} — ${err.message}`);
            // Save progress and continue
            fs.writeFileSync(PROGRESS, JSON.stringify(progress));
        }
    }

    // Final save
    fs.writeFileSync(PROGRESS, JSON.stringify(progress));
    fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
    console.log(`\nDone! Written to ${OUTPUT}`);
    console.log(`Processed: ${Object.keys(progress).length}/${data.length}`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
