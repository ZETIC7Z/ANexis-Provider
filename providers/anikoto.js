/**
 * anikoto.js - AniKoto (anikototv.to via Vercel API) provider
 * Anime-only provider that resolves direct HLS m3u8 streams.
 */
const axios = require('axios');
const { getTmdbApiKey } = require('../utils/tmdbKey');
const { getDetails } = require('../utils/tmdb');

const API_BASE = 'https://nexus-anime-tau.vercel.app/api';

const AXIOS_OPTS = {
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
};

// Get anime title from TMDB, ensuring it is classified as animation
async function getTitleFromTmdb(tmdbId, mediaType) {
    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const data = await getDetails(type, tmdbId);
        
        // Ensure it is Animation (genre ID 16)
        const genres = data.genres || [];
        const isAnimation = genres.some(g => g.id === 16);
        if (!isAnimation) {
            console.log(`[AniKoto] TMDB ${tmdbId} is not animation. Genre IDs:`, genres.map(g => g.id));
            return null;
        }

        return data.name || data.title || null;
    } catch {
        return null;
    }
}

// Extract direct m3u8 link from player URL
async function resolveDirectM3u8(playerUrl) {
    try {
        const host = new URL(playerUrl).host;
        
        // Step A: Load the player page HTML
        const { data: html } = await axios.get(playerUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Referer': 'https://anikototv.to/'
            },
            timeout: 8000
        });
        
        // Step B: Extract file ID from HTML
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
        
        if (!fileId) {
            console.log(`[AniKoto] Could not extract fileId from playerUrl: ${playerUrl}`);
            return null;
        }
        
        // Step C: Query /stream/getSources?id={fileId}
        const getSourcesUrl = `https://${host}/stream/getSources?id=${fileId}`;
        const { data: sourcesJson } = await axios.get(getSourcesUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
        console.log(`[AniKoto] resolveDirectM3u8 failed for ${playerUrl}: ${e.message}`);
        return null;
    }
}

async function getAnikotoStreams(tmdbId, mediaType = 'tv', seasonNum = null, episodeNum = null) {
    console.log(`[AniKoto] Fetching for TMDB ${tmdbId} S${seasonNum}E${episodeNum} type=${mediaType}`);
    try {
        // Step 1: Get title from TMDB
        const title = await getTitleFromTmdb(tmdbId, mediaType);
        if (!title) {
            console.log('[AniKoto] Could not resolve title or not classified as anime');
            return [];
        }
        console.log(`[AniKoto] Title: "${title}"`);

        // Step 2: Search AniKoto
        const searchUrl = `${API_BASE}/search?keyword=${encodeURIComponent(title)}`;
        const searchRes = await axios.get(searchUrl, AXIOS_OPTS);
        if (!searchRes.data || !searchRes.data.success || !searchRes.data.results || !searchRes.data.results.data) {
            console.log('[AniKoto] Search returned no results');
            return [];
        }

        const items = searchRes.data.results.data;
        const targetType = mediaType === 'tv' ? 'TV' : 'Movie';
        let matched = items.find(item => 
            item.title.toLowerCase() === title.toLowerCase() && item.type === targetType
        );

        if (!matched) {
            matched = items.find(item => 
                item.title.toLowerCase().includes(title.toLowerCase()) && item.type === targetType
            );
        }

        if (!matched) {
            matched = items.find(item => item.type === targetType);
        }

        if (!matched) {
            matched = items[0];
        }

        if (!matched) {
            console.log('[AniKoto] No matching anime found in AniKoto results');
            return [];
        }

        const fullSlug = matched.slug;
        const animeSlug = fullSlug.split('/ep-')[0];
        console.log(`[AniKoto] Matched anime slug: "${animeSlug}"`);

        // Step 3: Get episodes list
        const epUrl = `${API_BASE}/episodes/${animeSlug}`;
        const epRes = await axios.get(epUrl, AXIOS_OPTS);
        if (!epRes.data || !epRes.data.success || !epRes.data.results || !epRes.data.results.episodes) {
            console.log('[AniKoto] Failed to load episodes list');
            return [];
        }

        const episodes = epRes.data.results.episodes;
        const targetEpNum = episodeNum || 1;
        const targetEp = episodes.find(e => e.episode_no === targetEpNum) || episodes[0];
        if (!targetEp) {
            console.log(`[AniKoto] Episode ${targetEpNum} not found`);
            return [];
        }

        const serverIds = targetEp.server_ids;
        if (!serverIds) {
            console.log('[AniKoto] No server_ids found for episode');
            return [];
        }

        // Step 4: Get server list
        const serversUrl = `${API_BASE}/servers?ids=${encodeURIComponent(serverIds)}`;
        const servRes = await axios.get(serversUrl, AXIOS_OPTS);
        if (!servRes.data || !servRes.data.success || !servRes.data.results || servRes.data.results.length === 0) {
            console.log('[AniKoto] No servers returned');
            return [];
        }

        const servers = servRes.data.results;
        console.log(`[AniKoto] Found ${servers.length} servers`);

        // Step 5: Resolve stream URLs for all available servers in parallel
        const streams = [];
        await Promise.all(servers.map(async (server) => {
            try {
                const streamUrl = `${API_BASE}/stream?id=${encodeURIComponent(server.link_id)}`;
                const streamRes = await axios.get(streamUrl, AXIOS_OPTS);
                if (streamRes.data && streamRes.data.success && streamRes.data.results && streamRes.data.results.url) {
                    const finalUrl = streamRes.data.results.url;
                    
                    // Resolve direct m3u8 stream!
                    const resolved = await resolveDirectM3u8(finalUrl);
                    if (resolved) {
                        streams.push({
                            name: `AniKoto - ${server.name} (${server.type})`,
                            title: `AniKoto - ${server.name} (${server.type})`,
                            url: resolved.url,
                            quality: 'Auto',
                            provider: 'anikoto',
                            headers: {
                                'Referer': new URL(resolved.referer).origin + '/',
                                'Origin': new URL(resolved.referer).origin
                            }
                        });
                    }
                }
            } catch (e) {
                // Ignore individual server failure
            }
        }));

        console.log(`[AniKoto] Successfully resolved ${streams.length} stream(s)`);
        return streams;
    } catch (err) {
        console.error(`[AniKoto] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getAnikotoStreams };
