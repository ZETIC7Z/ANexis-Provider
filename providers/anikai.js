const axios = require('axios');
const { getTmdbApiKey } = require('../utils/tmdbKey');

const ANIKAI_BASE = 'https://anikai.watch';

const ANIKAI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Referer': ANIKAI_BASE + '/'
};

// Helper: Resolve title from TMDB
async function getTitleFromTmdb(tmdbId, mediaType) {
    const key = getTmdbApiKey();
    if (!key) return null;
    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const { data } = await axios.get(
            `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${key}`,
            { timeout: 8000 }
        );
        return data.name || data.title || null;
    } catch {
        return null;
    }
}

// Helper: Extract direct m3u8 link from megaplay/vidtube players
async function resolveDirectM3u8(playerUrl) {
    try {
        const parsedUrl = new URL(playerUrl);
        const host = parsedUrl.host;
        
        const { data: html } = await axios.get(playerUrl, {
            headers: {
                'User-Agent': ANIKAI_HEADERS['User-Agent'],
                'Referer': parsedUrl.origin + '/'
            },
            timeout: 8000
        });
        
        let fileId = null;
        const titleMatch = html.match(/<title>File ([0-9]+)/i);
        if (titleMatch) {
            fileId = titleMatch[1];
        } else {
            const dataIdMatch = html.match(/data-id=["']([0-9]+)["']/i);
            if (dataIdMatch) {
                fileId = dataIdMatch[1];
            }
        }
        
        if (!fileId) return null;
        
        const getSourcesUrl = `https://${host}/stream/getSources?id=${fileId}`;
        const { data: sourcesJson } = await axios.get(getSourcesUrl, {
            headers: {
                'User-Agent': ANIKAI_HEADERS['User-Agent'],
                'Referer': playerUrl,
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 8000
        });
        
        if (sourcesJson && sourcesJson.sources && sourcesJson.sources.file) {
            return {
                url: sourcesJson.sources.file,
                referer: playerUrl
            };
        }
        return null;
    } catch (e) {
        console.log(`[Anikai] resolveDirectM3u8 failed: ${e.message}`);
        return null;
    }
}

async function getAnikaiStreams(tmdbId, mediaType = 'tv', seasonNum = null, episodeNum = null) {
    console.log(`[Anikai] Fetching for TMDB ${tmdbId} S${seasonNum}E${episodeNum} type=${mediaType}`);
    try {
        const title = await getTitleFromTmdb(tmdbId, mediaType);
        if (!title) {
            console.log('[Anikai] Could not resolve title from TMDB');
            return [];
        }
        console.log(`[Anikai] Resolved TMDB Title: "${title}"`);

        // Search Anikai using WordPress search query
        const searchUrl = `${ANIKAI_BASE}/?s=${encodeURIComponent(title)}`;
        const { data: searchHtml } = await axios.get(searchUrl, { headers: ANIKAI_HEADERS, timeout: 8000 });
        
        // Find series or episode watch url matching title
        const searchRegex = /<article[^>]*>[\s\S]*?<a\s+href="([^"]+)"\s+itemprop="url"\s+title="([^"]+)"/gi;
        let match;
        let bestMatchUrl = null;
        while ((match = searchRegex.exec(searchHtml)) !== null) {
            const href = match[1];
            const itemTitle = match[2];
            if (itemTitle.toLowerCase().includes(title.toLowerCase()) || title.toLowerCase().includes(itemTitle.toLowerCase())) {
                bestMatchUrl = href;
                break;
            }
        }

        if (!bestMatchUrl) {
            // Fallback: use first article link found
            const fallbackMatch = searchHtml.match(/<article[^>]*>[\s\S]*?<a\s+href="([^"]+)"/i);
            if (fallbackMatch) {
                bestMatchUrl = fallbackMatch[1];
            }
        }

        if (!bestMatchUrl) {
            console.log('[Anikai] No search results found on site');
            return [];
        }

        console.log(`[Anikai] Found series page: ${bestMatchUrl}`);

        // Fetch the series page to get the list of episodes
        const { data: seriesHtml } = await axios.get(bestMatchUrl, { headers: ANIKAI_HEADERS, timeout: 8000 });
        
        // For TV/Series, look for the matching episode number
        let episodeUrl = bestMatchUrl;
        if (mediaType === 'tv') {
            const targetEpNum = episodeNum || 1;
            const epRegex = new RegExp(`<a\\s+href="([^"]+)"[^>]*>\\s*<div\\s+class="epl-num"\\s*>\\s*${targetEpNum}\\s*<\\/div>`, 'i');
            const epMatch = seriesHtml.match(epRegex);
            if (epMatch) {
                episodeUrl = epMatch[1];
            } else {
                // Fallback: look for general ep number in links
                const generalEpRegex = new RegExp(`href="([^"]+episode-${targetEpNum}[^"]+)"`, 'i');
                const genMatch = seriesHtml.match(generalEpRegex);
                if (genMatch) {
                    episodeUrl = genMatch[1];
                } else {
                    console.log(`[Anikai] Episode ${targetEpNum} not found on series page.`);
                    return [];
                }
            }
        }

        console.log(`[Anikai] Accessing episode page: ${episodeUrl}`);

        // Fetch episode page HTML
        const { data: epHtml } = await axios.get(episodeUrl, { headers: ANIKAI_HEADERS, timeout: 8000 });

        // Extract and decode base64 mirror options
        const optionRegex = /<option[^>]*value="([A-Za-z0-9+/=]{20,})"[^>]*>([^<]+)<\/option>/g;
        let optMatch;
        const streams = [];

        while ((optMatch = optionRegex.exec(epHtml)) !== null) {
            const base64Val = optMatch[1];
            const serverName = optMatch[2].trim();
            try {
                const decoded = Buffer.from(base64Val, 'base64').toString();
                const srcMatch = decoded.match(/src="([^"]+)"/);
                const iframeUrl = srcMatch ? srcMatch[1] : null;

                if (iframeUrl) {
                    console.log(`[Anikai] Resolving server: "${serverName}" | URL: ${iframeUrl}`);
                    const resolved = await resolveDirectM3u8(iframeUrl);
                    if (resolved) {
                        streams.push({
                            name: `Anikai - ${serverName}`,
                            title: `Anikai - ${serverName}`,
                            url: resolved.url,
                            quality: 'Auto',
                            type: 'hls',
                            provider: 'anikai',
                            headers: {
                                'Referer': new URL(resolved.referer).origin + '/',
                                'Origin': new URL(resolved.referer).origin
                            }
                        });
                    }
                }
            } catch (err) {
                // Skip individual server parse failures
            }
        }

        console.log(`[Anikai] Successfully resolved ${streams.length} stream(s)`);
        return streams;

    } catch (err) {
        console.error(`[Anikai] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getAnikaiStreams };
