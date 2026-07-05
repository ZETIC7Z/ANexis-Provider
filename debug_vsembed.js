const axios = require('axios');

async function main() {
    const r = await axios.get('https://vsembed.ru/embed/movie/550', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://vsembed.ru/'
        },
        timeout: 15000,
        responseType: 'text'
    });
    const html = r.data;

    // Test the exact regex from vsembed.js
    const serverRegex = /class="server"[\s\S]*?data-hash="([\s\S]*?)"/g;
    let match;
    let count = 0;
    while ((match = serverRegex.exec(html)) !== null) {
        count++;
        const rawHash = match[1].replace(/\s/g, '');
        console.log(`\nServer ${count}:`);
        console.log('Raw hash length:', rawHash.length);
        console.log('First 50 chars:', rawHash.substring(0, 50));
        try {
            const decoded1 = Buffer.from(rawHash, 'base64').toString('utf-8');
            console.log('Decoded1 (first 100):', decoded1.substring(0, 100));
            // Try second decode
            const rawDecoded = decoded1.replace(/\s/g, '');
            if (/^[A-Za-z0-9+/=]{20,}$/.test(rawDecoded)) {
                const decoded2 = Buffer.from(rawDecoded, 'base64').toString('utf-8');
                console.log('Decoded2 (first 100):', decoded2.substring(0, 100));
            }
        } catch(e) {
            console.log('Decode error:', e.message);
        }
    }
    console.log('\nTotal servers found:', count);
    
    // Also try simple data-hash regex
    const simple = html.match(/data-hash="([\s\S]*?)"/g);
    console.log('Simple data-hash matches:', simple ? simple.length : 0);
}

main().catch(e => console.error('ERROR:', e.message));
