const axios = require('axios');

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    "Referer": "https://vidfast.pro/",
    "X-Requested-With": "XMLHttpRequest"
};

const API_BASE = "https://enc-dec.app/api";

async function getVidfastStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidfast] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    // Construct URL
    const baseUrl = mediaType === 'tv'
        ? `https://vidfast.pro/tv/${tmdbId}/${seasonNum}/${episodeNum}/`
        : `https://vidfast.pro/movie/${tmdbId}/`;

    try {
        console.log(`[Vidfast] Fetching page: ${baseUrl}`);
        const response = await axios.get(baseUrl, { 
            headers: { "User-Agent": HEADERS["User-Agent"] },
            timeout: 10000 
        });
        const html = response.data;
        if (!html) return [];

        // Extract encrypted payload for English ("en")
        const match = html.match(/\\"en\\":\\"(.*?)\\"/) || html.match(/"en"\s*:\s*"([^"]+)"/);
        if (!match || !match[1]) {
            console.log('[Vidfast] Encrypted payload not found on page.');
            return [];
        }
        const text = match[1];

        // 1. Get vidfast URLs & Token
        const encUrl = `${API_BASE}/enc-vidfast?text=${encodeURIComponent(text)}`;
        const encRes = await axios.get(encUrl, { timeout: 8000 });
        if (encRes.data.status !== 200 || !encRes.data.result) {
            console.error('[Vidfast] VPS Encryption step failed:', encRes.data.error || 'unknown');
            return [];
        }
        
        const { servers, stream, token } = encRes.data.result;

        // Update headers
        const requestHeaders = { ...HEADERS, "X-CSRF-Token": token };

        // 2. Fetch encrypted servers
        const serversRes = await axios.post(servers, null, { headers: requestHeaders, timeout: 8000 });
        const serversEncrypted = serversRes.data;

        // 3. Decrypt servers list
        const decServersRes = await axios.post(`${API_BASE}/dec-vidfast`, { text: serversEncrypted }, { timeout: 8000 });
        if (decServersRes.data.status !== 200 || !Array.isArray(decServersRes.data.result)) {
            console.error('[Vidfast] Failed to decrypt servers:', decServersRes.data.error || 'unknown');
            return [];
        }

        const serversDecrypted = decServersRes.data.result;
        console.log(`[Vidfast] Found ${serversDecrypted.length} decrypted servers.`);

        const streams = [];

        // 4. Try loading streams from the servers
        for (const server of serversDecrypted) {
            try {
                const data = server.data;
                const streamEndpoint = `${stream}/${data}`;
                console.log(`[Vidfast] Fetching stream data from server: ${server.name || 'Unknown'}`);

                const streamRes = await axios.post(streamEndpoint, null, { headers: requestHeaders, timeout: 8000 });
                const streamEncrypted = streamRes.data;

                const decStreamRes = await axios.post(`${API_BASE}/dec-vidfast`, { text: streamEncrypted }, { timeout: 8000 });
                if (decStreamRes.data.status === 200 && decStreamRes.data.result) {
                    const decrypted = decStreamRes.data.result;
                    
                    // 1. Support direct url property
                    if (decrypted.url) {
                        streams.push({
                            server: `Vidfast (${server.name || 'Auto'})`,
                            title: `Vidfast - ${server.name || 'Auto'}`,
                            url: decrypted.url,
                            quality: 'Auto',
                            type: decrypted.url.includes('.m3u8') ? 'hls' : 'mp4',
                            provider: 'vidfast',
                            headers: {
                                "Referer": "https://vidfast.pro/",
                                "User-Agent": HEADERS["User-Agent"]
                            }
                        });
                    }
                    
                    // 2. Support sources array
                    if (Array.isArray(decrypted.sources)) {
                        decrypted.sources.forEach(src => {
                            streams.push({
                                server: `Vidfast (${server.name || 'Auto'})`,
                                title: `Vidfast - ${src.label || 'Auto'}`,
                                url: src.file,
                                quality: src.label || 'Auto',
                                type: src.file.includes('.m3u8') ? 'hls' : 'mp4',
                                provider: 'vidfast',
                                headers: {
                                    "Referer": "https://vidfast.pro/",
                                    "User-Agent": HEADERS["User-Agent"]
                                }
                            });
                        });
                    }
                }
            } catch (serverErr) {
                console.warn(`[Vidfast] Failed to fetch stream from server ${server.name || 'Unknown'}:`, serverErr.message);
            }
        }

        console.log(`[Vidfast] Got ${streams.length} stream(s).`);
        return streams;

    } catch (err) {
        console.error(`[Vidfast] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getVidfastStreams };
