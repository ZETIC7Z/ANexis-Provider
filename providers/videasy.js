const axios = require('axios');
const { getDetails } = require('../utils/tmdb');

const HEADERS = {
    "Accept": "*/*",
    "Origin": "https://player.videasy.to",
    "Referer": "https://player.videasy.to/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
};

const DEC_API = "https://enc-dec.app/api/dec-videasy";

// List of videasy servers in priority order
const SERVERS = ['cdn', 'jett', 'tejo', 'neon2', 'downloader2', 'm4uhd', 'hdmovie'];

async function getVideasyStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Videasy] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    // 1. Get metadata from TMDB
    let title, year, imdbId;
    try {
        const tmdbData = await getDetails(mediaType, tmdbId);
        title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const dateStr = mediaType === 'movie' ? tmdbData.release_date : tmdbData.first_air_date;
        year = dateStr ? dateStr.substring(0, 4) : null;
        imdbId = tmdbData.imdb_id || null;
    } catch (err) {
        console.error("[Videasy] TMDB details fetch failed:", err.message);
        return [];
    }

    if (!title) {
        console.error("[Videasy] No title found for TMDB ID:", tmdbId);
        return [];
    }

    // Double URL-encode the title
    const encTitle = encodeURIComponent(encodeURIComponent(title));
    const typeStr = mediaType === 'movie' ? 'movie' : 'tv';

    try {
        // 2. Fetch seed
        const seedUrl = `https://api.wingsdatabase.com/seed?mediaId=${tmdbId}`;
        const seedRes = await axios.get(seedUrl, { headers: HEADERS, timeout: 8000 });
        const seed = seedRes.data && seedRes.data.seed;
        if (!seed) {
            console.error("[Videasy] Failed to retrieve encryption seed.");
            return [];
        }

        const streams = [];

        // 3. Loop through servers and try to scrape
        for (const server of SERVERS) {
            try {
                let url;
                if (mediaType === 'movie') {
                    url = `https://api.wingsdatabase.com/${server}/sources-with-title?title=${encTitle}&mediaType=${typeStr}&year=${year}&tmdbId=${tmdbId}&imdbId=${imdbId || ''}&enc=2&seed=${seed}`;
                } else {
                    url = `https://api.wingsdatabase.com/${server}/sources-with-title?title=${encTitle}&mediaType=${typeStr}&year=${year}&episodeId=${episodeNum}&seasonId=${seasonNum}&tmdbId=${tmdbId}&imdbId=${imdbId || ''}&enc=2&seed=${seed}`;
                }

                console.log(`[Videasy] Querying server '${server}': ${url}`);
                const response = await axios.get(url, { headers: HEADERS, timeout: 8000, responseType: 'text' });
                const encData = response.data;
                if (!encData || encData.length < 10) continue;

                // 4. Decrypt via enc-dec.app VPS API
                const decRes = await axios.post(DEC_API, {
                    text: encData,
                    id: String(tmdbId),
                    seed: seed
                }, { timeout: 8000 });

                console.log(`[Videasy] Decrypted status: ${decRes.data.status}, has result: ${!!decRes.data.result}, isArray: ${Array.isArray(decRes.data.result)}`);
                if (decRes.data && decRes.data.status === 200 && decRes.data.result) {
                    const decrypted = decRes.data.result;
                    const sources = decrypted.sources || [];
                    const tracks = decrypted.tracks || [];
                    console.log(`[Videasy] Successfully decrypted ${sources.length} sources and ${tracks.length} tracks from server '${server}'`);

                    // Parse subtitles
                    const subs = [];
                    if (Array.isArray(tracks)) {
                        tracks.forEach(track => {
                            if (track.url) {
                                subs.push({
                                    url: track.url,
                                    label: track.lang || track.language || 'Unknown',
                                    lang: track.lang || track.language || 'en',
                                    format: track.url.endsWith('.vtt') ? 'vtt' : 'srt'
                                });
                            }
                        });
                    }

                    for (const item of sources) {
                        if (!item.url) continue;
                        const isM3u8 = item.url.includes('.m3u8');
                        
                        streams.push({
                            server: `Videasy (${server})`,
                            title: `${title} - ${server.toUpperCase()} ${item.quality || 'Auto'}`,
                            url: item.url,
                            quality: item.quality || 'Auto',
                            type: isM3u8 ? 'hls' : 'mp4',
                            provider: 'videasy',
                            subtitles: subs,
                            headers: {
                                "Referer": "https://player.videasy.to/",
                                "User-Agent": HEADERS["User-Agent"]
                            }
                        });
                    }

                    // If we found streams on one server, we can stop to be fast
                    if (streams.length > 0) break;
                }
            } catch (serverErr) {
                console.warn(`[Videasy] Server '${server}' failed:`, serverErr.message);
            }
        }

        console.log(`[Videasy] Got ${streams.length} total streams.`);
        return streams;

    } catch (err) {
        console.error("[Videasy] Error:", err.message);
        return [];
    }
}

module.exports = { getVideasyStreams };
