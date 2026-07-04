/**
 * vsembed.js - VidSrc (vsembed.ru) provider
 * Flow: embed page → iframe src → player page → extract m3u8
 * Domain: vsembed.ru (VidSrc mirror, works with TMDB IDs)
 */
const axios = require('axios');

const BASE_URL = 'https://vsembed.ru';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': BASE_URL + '/'
};

async function getPage(url, referer) {
    try {
        const res = await axios.get(url, {
            headers: { ...HEADERS, Referer: referer || BASE_URL + '/' },
            timeout: 10000,
            responseType: 'text'
        });
        if (res.status !== 200) return null;
        return res.data;
    } catch {
        return null;
    }
}

function extractIframeSrc(html) {
    const m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (!m) return null;
    let src = m[1];
    if (src.startsWith('//')) src = 'https:' + src;
    return src;
}

function extractM3u8(html) {
    // Pattern: file: "...m3u8..." or file:"..." with domain placeholders
    const fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
    if (fileMatch) {
        let url = fileMatch[1];
        // Handle domain placeholders used by cloudnestra
        const domains = {
            '{v1}': 'neonhorizonworkshops.com',
            '{v2}': 'wanderlynest.com',
            '{v3}': 'orchidpixelgardens.com',
            '{v4}': 'cloudnestra.com'
        };
        for (const [ph, domain] of Object.entries(domains)) {
            url = url.replace(ph, domain);
        }
        // Take first URL if multiple separated by " or "
        url = url.split(/\s+or\s+/i)[0].trim();
        if (url.includes('m3u8') || url.includes('stream') || url.startsWith('http')) return url;
    }

    // Direct m3u8 URL in body
    const m3uMatch = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (m3uMatch) return m3uMatch[0];

    return null;
}

function extractRelSrc(html, baseUrl) {
    const m = html.match(/src\s*:\s*["']([^"']+)["']/i);
    if (!m) return null;
    try {
        return new URL(m[1], baseUrl).href;
    } catch {
        return null;
    }
}

async function getVsembedStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[VsEmbed] Fetching for TMDB ${tmdbId} type=${mediaType}`);
    try {
        // Step 1: Get embed page
        const embedUrl = mediaType === 'movie'
            ? `${BASE_URL}/embed/movie?tmdb=${tmdbId}`
            : `${BASE_URL}/embed/tv?tmdb=${tmdbId}&season=${seasonNum}&episode=${episodeNum}`;

        const embedHtml = await getPage(embedUrl, BASE_URL + '/');
        if (!embedHtml) {
            console.log('[VsEmbed] Failed to fetch embed page');
            return [];
        }

        // Step 2: Extract iframe src (player host)
        const iframeSrc = extractIframeSrc(embedHtml);
        if (!iframeSrc) {
            console.log('[VsEmbed] No iframe found in embed page');
            return [];
        }
        console.log(`[VsEmbed] Step 2 iframe: ${iframeSrc.slice(0, 80)}`);

        // Step 3: Fetch iframe/player page
        const playerHtml = await getPage(iframeSrc, embedUrl);
        if (!playerHtml) {
            console.log('[VsEmbed] Failed to fetch player page');
            return [];
        }

        // Step 4: Try to find m3u8 directly
        let streamUrl = extractM3u8(playerHtml);

        // Step 5: If not found, look for another src: 'url' redirect
        if (!streamUrl) {
            const thirdUrl = extractRelSrc(playerHtml, iframeSrc);
            if (thirdUrl) {
                console.log(`[VsEmbed] Step 5 third url: ${thirdUrl.slice(0, 80)}`);
                const thirdHtml = await getPage(thirdUrl, iframeSrc);
                if (thirdHtml) streamUrl = extractM3u8(thirdHtml);
            }
        }

        if (!streamUrl) {
            console.log('[VsEmbed] No m3u8 found');
            return [];
        }

        console.log(`[VsEmbed] Found stream: ${streamUrl.slice(0, 80)}`);
        return [{
            name: 'VidSrc',
            title: 'VidSrc (Auto)',
            url: streamUrl,
            quality: 'Auto',
            provider: 'VidSrc',
            headers: {
                'Referer': 'https://cloudnestra.com/',
                'Origin': 'https://cloudnestra.com'
            }
        }];
    } catch (err) {
        console.error(`[VsEmbed] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getVsembedStreams };
