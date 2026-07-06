const axios = require('axios');

const ANIKAI_BASE = 'https://anikai.watch';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Referer': ANIKAI_BASE + '/'
};

async function testSearch(query) {
    try {
        console.log(`Searching for "${query}"...`);
        const searchUrl = `${ANIKAI_BASE}/?s=${encodeURIComponent(query)}`;
        const res = await axios.get(searchUrl, { headers: HEADERS });
        const matches = [...res.data.matchAll(/<a\s+href="([^"]+)"[^>]*title="([^"]+)"/gi)];
        console.log(`Found ${matches.length} results:`);
        for (const m of matches.slice(0, 5)) {
            console.log(`  Url: ${m[1]} | Title: ${m[2]}`);
        }
    } catch (e) {
        console.error(e.message);
    }
}

async function run() {
    await testSearch("Demon Slayer");
    await testSearch("Demon Slayer Season");
    await testSearch("Demon Slayer Season 3");
    await testSearch("Jujutsu Kaisen");
}

run();
