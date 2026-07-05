const axios = require('axios');

const VIDLINK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Referer': 'https://vidlink.pro'
};

async function getVidlinkStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidlink] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        // Step 1: Encrypt the TMDB ID via enc-dec.app
        const encRes = await axios.get(
            `https://enc-dec.app/api/enc-vidlink?text=${encodeURIComponent(String(tmdbId))}`,
            { timeout: 8000 }
        );
        const encodedTmdb = encRes.data && encRes.data.result;
        if (!encodedTmdb) {
            console.log('[Vidlink] Encryption step returned no result.');
            return [];
        }

        // Step 2: Fetch stream playlist from Vidlink API
        const apiUrl = mediaType === 'tv'
            ? `https://vidlink.pro/api/b/tv/${encodedTmdb}/${seasonNum}/${episodeNum}?multiLang=0`
            : `https://vidlink.pro/api/b/movie/${encodedTmdb}?multiLang=0`;

        const apiRes = await axios.get(apiUrl, { headers: VIDLINK_HEADERS, timeout: 8000 });

        const qualities = apiRes.data && apiRes.data.stream && apiRes.data.stream.qualities;
        if (!qualities) {
            console.log('[Vidlink] No qualities found in response.');
            return [];
        }

        const results = [];
        
        // Extract MP4 streams from qualities
        for (const [res, streamInfo] of Object.entries(qualities)) {
            if (streamInfo && streamInfo.url) {
                results.push({
                    server: `Vidlink ${res}p`,
                    title: `Vidlink ${res}p`,
                    url: streamInfo.url,
                    quality: `${res}p`,
                    type: 'mp4',
                    provider: 'vidlink',
                    headers: {
                        'Referer': 'https://vidlink.pro/',
                        'User-Agent': VIDLINK_HEADERS['User-Agent']
                    }
                });
            }
        }

        // Check for DASH alternates
        const alternates = apiRes.data && apiRes.data.stream && apiRes.data.stream.alternates;
        if (alternates && alternates.dash && alternates.dash.playlist) {
            results.push({
                server: 'Vidlink DASH (Auto)',
                title: 'Vidlink DASH (Auto)',
                url: alternates.dash.playlist,
                quality: 'Auto',
                type: 'dash',
                provider: 'vidlink',
                headers: {
                    'Referer': 'https://vidlink.pro/',
                    'User-Agent': VIDLINK_HEADERS['User-Agent']
                }
            });
        }

        console.log(`[Vidlink] Got ${results.length} stream(s).`);
        return results;
    } catch (err) {
        console.error(`[Vidlink] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getVidlinkStreams };
