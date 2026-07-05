/**
 * vsembed.js - VsEmbed/Vidsrc provider
 *
 * vsembed.ru is a server-selector page. The real player URL is encoded
 * as a base64 `data-hash` attribute on a ".server" div. We decode the first
 * hash to get a sub-player URL, fetch that page, and extract the m3u8.
 *
 * Flow:
 *  1. Fetch /embed/movie/{id} → parse .server[data-hash] elements
 *  2. Base64-decode the hash → get sub-player URL (e.g. 2embed, superembed)
 *  3. Fetch the sub-player URL → extract m3u8 from its HTML/API
 */
const axios = require('axios');

const PROVIDERS = [
    'https://vsembed.ru',
    'https://vsembed.su',
    'https://vidsrcme.ru',
];

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

function buildEmbedUrl(domain, tmdbId, mediaType, seasonNum, episodeNum) {
    if (mediaType === 'tv') {
        return `${domain}/embed/tv?tmdb=${tmdbId}&season=${seasonNum}&episode=${episodeNum}`;
    }
    return `${domain}/embed/movie/${tmdbId}`;
}

async function fetchHtml(url, referer) {
    try {
        const resp = await axios.get(url, {
            headers: { ...HEADERS, 'Referer': referer || url },
            timeout: 15000,
            responseType: 'text',
        });
        return resp.status === 200 ? resp.data : null;
    } catch (e) {
        return null;
    }
}

/**
 * Parse .server[data-hash] divs and decode the hashes.
 * The hash is a double-base64 encoded URL (sometimes with extra layers).
 */
function parseServerHashes(html) {
    const servers = [];
    // data-hash values span multiple lines in the HTML — use [\s\S] to capture across newlines
    const serverRegex = /class="server"[\s\S]*?data-hash="([\s\S]*?)"/g;
    let match;
    while ((match = serverRegex.exec(html)) !== null) {
        const rawHash = match[1].replace(/\s/g, ''); // strip all whitespace/newlines
        try {
            // First base64 decode
            const decoded1 = Buffer.from(rawHash, 'base64').toString('utf-8');
            
            // Format is: "md5hash:base64encodedUrl"
            // Split on the first colon to get the base64 URL part
            const colonIdx = decoded1.indexOf(':');
            if (colonIdx === -1) continue;
            
            const base64Url = decoded1.substring(colonIdx + 1).replace(/\s/g, '');
            
            // Second base64 decode to get the actual URL
            const url = Buffer.from(base64Url, 'base64').toString('utf-8');
            console.log(`[Vsembed] Decoded server URL: ${url.substring(0, 80)}`);
            
            if (url && (url.startsWith('http') || url.includes('embed') || url.includes('/'))) {
                servers.push(url.trim());
            }
        } catch (e) {
            console.warn('[Vsembed] Hash decode error:', e.message);
        }
    }
    return servers;
}

/**
 * Try to extract m3u8 URL from a sub-player page HTML.
 * Common patterns used by 2embed, superembed, etc.
 */
function extractM3u8FromHtml(html, baseUrl) {
    if (!html) return null;

    // Direct m3u8 URL
    const directM3u8 = html.match(/['"`](https?:\/\/[^'"`\s]+\.m3u8[^'"`\s]*)['"` ]/);
    if (directM3u8) return directM3u8[1];

    // file: "url" pattern (JW Player / Video.js style)
    const filePattern = html.match(/(?:file|src)\s*[=:]\s*['"`](https?:\/\/[^'"`]+)['"` ]/);
    if (filePattern && (filePattern[1].includes('m3u8') || filePattern[1].includes('stream'))) {
        return filePattern[1];
    }

    // source.src pattern
    const sourceSrc = html.match(/source\.src\s*=\s*['"`](https?:\/\/[^'"`]+)['"` ]/);
    if (sourceSrc) return sourceSrc[1];

    return null;
}

/**
 * Some sub-players (like 2embed) have an API endpoint that returns stream JSON.
 * e.g. https://www.2embed.cc/embedtv/movie?id={tmdbId}
 * Try fetching common API patterns.
 */
async function trySubPlayerApi(subPlayerUrl, tmdbId, mediaType) {
    // 2embed pattern: fetch /api/getVideoSource?id=...
    if (subPlayerUrl.includes('2embed')) {
        try {
            const apiUrl = `https://www.2embed.cc/embedtv/${mediaType === 'tv' ? 'tv' : 'movie'}?id=${tmdbId}`;
            const html = await fetchHtml(apiUrl, 'https://www.2embed.cc/');
            if (html) {
                const m3u8 = extractM3u8FromHtml(html, 'https://www.2embed.cc/');
                if (m3u8) return m3u8;
            }
        } catch {}
    }

    // Generic: just fetch the sub-player URL and try to extract m3u8
    const html = await fetchHtml(subPlayerUrl, subPlayerUrl);
    if (html) {
        const m3u8 = extractM3u8FromHtml(html, subPlayerUrl);
        if (m3u8) return m3u8;
    }
    return null;
}

async function tryScrapeProvider(domain, tmdbId, mediaType, seasonNum, episodeNum) {
    const embedUrl = buildEmbedUrl(domain, tmdbId, mediaType, seasonNum, episodeNum);
    console.log(`[Vsembed] Fetching selector page: ${embedUrl}`);

    const html = await fetchHtml(embedUrl, domain + '/');
    if (!html) {
        console.warn(`[Vsembed] No HTML from ${domain}`);
        return null;
    }

    // Parse server hashes
    const subPlayers = parseServerHashes(html);
    if (subPlayers.length === 0) {
        console.warn(`[Vsembed] No server hashes found on ${domain}`);
        return null;
    }

    console.log(`[Vsembed] Found ${subPlayers.length} sub-players on ${domain}`);

    // Try each sub-player in order
    for (const subUrl of subPlayers.slice(0, 3)) {
        console.log(`[Vsembed] Trying sub-player: ${subUrl}`);
        const m3u8 = await trySubPlayerApi(subUrl, tmdbId, mediaType);
        if (m3u8) {
            console.log(`[Vsembed] ✅ Found m3u8: ${m3u8}`);
            return { domain, m3u8Url: m3u8, subtitles: [] };
        }
    }

    console.warn(`[Vsembed] All sub-players failed on ${domain}`);
    return null;
}

async function getVsembedStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vsembed] Fetching for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    for (const domain of PROVIDERS) {
        const result = await tryScrapeProvider(domain, tmdbId, mediaType, seasonNum, episodeNum);
        if (result) {
            return [{
                server: 'VsEmbed',
                title: 'VsEmbed (Auto)',
                quality: 'Auto',
                url: result.m3u8Url,
                type: 'hls',
                provider: 'vsembed',
                subtitles: result.subtitles,
            }];
        }
    }

    console.error('[Vsembed] All providers failed.');
    return [];
}

module.exports = { getVsembedStreams };
