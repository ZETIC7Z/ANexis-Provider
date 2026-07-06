const axios = require('axios');

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Referer": "https://vidcore.net/",
    "X-Requested-With": "XMLHttpRequest"
};

const API_BASE = "https://enc-dec.app/api";

async function getVidcoreStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidcore] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const isTv = mediaType === 'tv' || mediaType === 'series';
    // Construct URL
    const baseUrl = isTv
        ? `https://vidcore.net/tv/${tmdbId}/${seasonNum}/${episodeNum}/`
        : `https://vidcore.net/movie/${tmdbId}/`;

    try {
        console.log(`[Vidcore] Fetching page: ${baseUrl}`);
        const response = await axios.get(baseUrl, { 
            headers: { "User-Agent": HEADERS["User-Agent"] },
            timeout: 10000 
        });
        const html = response.data;
        if (!html) return [];

        // Extract encrypted payload for English ("en")
        const match = html.match(/\\"en\\":\\"([^\\"]+)/) || html.match(/"en"\s*:\s*"([^"]+)"/);
        if (!match || !match[1]) {
            console.log('[Vidcore] Encrypted payload not found on page.');
            return [];
        }
        const text = match[1];

        // 1. Get vidcore URLs & Token
        const encUrl = `${API_BASE}/enc-vidcore?text=${encodeURIComponent(text)}`;
        const encRes = await axios.get(encUrl, { timeout: 8000 });
        if (encRes.data.status !== 200 || !encRes.data.result) {
            console.error('[Vidcore] VPS Encryption step failed:', encRes.data.error || 'unknown');
            return [];
        }
        
        const { servers, stream, token } = encRes.data.result;

        // Update headers
        const requestHeaders = { ...HEADERS, "X-CSRF-Token": token };

        // 2. Fetch encrypted servers
        const serversRes = await axios.post(servers, null, { headers: requestHeaders, timeout: 8000 });
        const serversEncrypted = serversRes.data;

        // 3. Decrypt servers list
        const decServersRes = await axios.post(`${API_BASE}/dec-vidcore`, { text: serversEncrypted }, { timeout: 8000 });
        if (decServersRes.data.status !== 200 || !Array.isArray(decServersRes.data.result)) {
            console.error('[Vidcore] Failed to decrypt servers:', decServersRes.data.error || 'unknown');
            return [];
        }

        const serversDecrypted = decServersRes.data.result;
        console.log(`[Vidcore] Found ${serversDecrypted.length} decrypted servers.`);

        const streams = [];

        // 4. Try loading streams from the servers
        for (const server of serversDecrypted) {
            try {
                const data = server.data;
                const streamEndpoint = `${stream}/${data}`;
                console.log(`[Vidcore] Fetching stream data from server: ${server.name || 'Unknown'}`);

                const streamRes = await axios.post(streamEndpoint, null, { headers: requestHeaders, timeout: 8000 });
                const streamEncrypted = streamRes.data;
                console.log(`[Vidcore] Encrypted stream response (first 100 chars): ${streamEncrypted.slice(0, 100)}`);

                const decStreamRes = await axios.post(`${API_BASE}/dec-vidcore`, { text: streamEncrypted }, { timeout: 8000 });
                console.log(`[Vidcore] Decrypted stream response status: ${decStreamRes.data.status}, has result: ${!!decStreamRes.data.result}`);
                if (decStreamRes.data.status === 200 && decStreamRes.data.result) {
                    const decrypted = decStreamRes.data.result;
                    console.log(`[Vidcore] Decrypted stream result: ${JSON.stringify(decrypted).slice(0, 200)}`);
                    
                    // 1. Support direct url property
                    if (decrypted.url) {
                        streams.push({
                            server: `Vidcore (${server.name || 'Auto'})`,
                            title: `Vidcore - ${server.name || 'Auto'}`,
                            url: decrypted.url,
                            quality: 'Auto',
                            type: decrypted.url.includes('.m3u8') ? 'hls' : 'mp4',
                            provider: 'vidcore',
                            headers: {
                                "Referer": "https://vidcore.net/",
                                "User-Agent": HEADERS["User-Agent"]
                            }
                        });
                    }
                    
                    // 2. Support sources array
                    if (Array.isArray(decrypted.sources)) {
                        decrypted.sources.forEach(src => {
                            streams.push({
                                server: `Vidcore (${server.name || 'Auto'})`,
                                title: `Vidcore - ${src.label || 'Auto'}`,
                                url: src.file,
                                quality: src.label || 'Auto',
                                type: src.file.includes('.m3u8') ? 'hls' : 'mp4',
                                provider: 'vidcore',
                                headers: {
                                    "Referer": "https://vidcore.net/",
                                    "User-Agent": HEADERS["User-Agent"]
                                }
                            });
                        });
                    }
                }
            } catch (serverErr) {
                console.warn(`[Vidcore] Failed to fetch stream from server ${server.name || 'Unknown'}:`, serverErr.message);
            }
        }

        console.log(`[Vidcore] Got ${streams.length} stream(s).`);
        return streams;

    } catch (err) {
        console.error(`[Vidcore] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getVidcoreStreams };
