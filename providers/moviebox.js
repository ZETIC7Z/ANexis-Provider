const axios = require('axios');
const { getDetails } = require('../utils/tmdb');

const API_BASE = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Referer": "https://moviebox.ph/",
    "Origin": "https://moviebox.ph",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Request-Lang": "en",
    "Accept": "application/json",
    "Content-Type": "application/json"
};

let bearerToken = null;

async function getBearerToken() {
    if (bearerToken) return bearerToken;
    try {
        const resp = await axios.get(`${API_BASE}/home?host=moviebox.ph`, { headers: DEFAULT_HEADERS });
        const xUser = resp.headers['x-user'];
        if (xUser) {
            bearerToken = JSON.parse(xUser).token;
        } else {
            const cookies = resp.headers['set-cookie'] || [];
            const tokenCookie = cookies.find(c => c.includes('token='));
            if (tokenCookie) {
                const match = tokenCookie.match(/token=([^;]+)/);
                if (match) bearerToken = match[1];
            }
        }
    } catch (err) {
        console.error("[Moviebox] Failed to get bearer token:", err.message);
    }
    return bearerToken || "";
}

async function makeRequest(url, method = "GET", payload = null) {
    const token = await getBearerToken();
    const headers = { ...DEFAULT_HEADERS, "Authorization": token ? `Bearer ${token}` : "" };
    
    try {
        const opts = { method, url, headers, timeout: 15000 };
        if (payload && method === 'POST') opts.data = payload;
        
        const resp = await axios(opts);
        
        const xUser = resp.headers['x-user'];
        if (xUser) {
            const newToken = JSON.parse(xUser).token;
            if (newToken) bearerToken = newToken;
        }
        
        return resp.data;
    } catch (err) {
        console.error(`[Moviebox] Request failed to ${url}:`, err.message);
        return null;
    }
}

async function getMovieboxStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Moviebox] Fetching for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    
    // 1. Get title from TMDB
    let title, year;
    try {
        const tmdbData = await getDetails(mediaType, tmdbId);
        title = mediaType === 'movie' ? tmdbData.title : tmdbData.name;
        const dateStr = mediaType === 'movie' ? tmdbData.release_date : tmdbData.first_air_date;
        year = dateStr ? dateStr.substring(0, 4) : null;
    } catch (err) {
        console.error("[Moviebox] TMDB fetch failed:", err.message);
        return [];
    }

    if (!title) return [];

    // 2. Search Moviebox
    const searchData = await makeRequest(`${API_BASE}/subject/search`, "POST", { keyword: title, page: 1, perPage: 20 });
    if (!searchData || !searchData.data) return [];
    
    let items = [];
    if (searchData.data.items) items = searchData.data.items;
    else if (searchData.data.list) items = searchData.data.list;
    
    // Find matching item
    let match = null;
    for (const item of items) {
        const sub = item.subject || item;
        const subTitle = sub.title;
        const subYear = sub.releaseDate ? sub.releaseDate.substring(0, 4) : null;
        
        // Very simple matching. Ideally should use string similarity.
        if (subTitle && subTitle.toLowerCase() === title.toLowerCase()) {
            if (!year || subYear === year) {
                match = sub;
                break;
            }
        }
    }
    
    // Fallback to first result if exact match not found
    if (!match && items.length > 0) {
        match = items[0].subject || items[0];
    }
    
    if (!match) {
        console.error("[Moviebox] No search results matched.");
        return [];
    }
    
    const subjectId = match.subjectId;
    const detailPath = match.detailPath;
    
    // 3. Get domain
    const domData = await makeRequest(`${API_BASE}/media-player/get-domain`, "GET");
    const domain = (domData && domData.data) ? domData.data.replace(/\/$/, "") : "https://netfilm.world";
    
    // 4. Fetch streams
    const se = mediaType === 'tv' ? parseInt(seasonNum) : 1;
    const ep = mediaType === 'tv' ? parseInt(episodeNum) : 1;
    
    const playerReferer = `${domain}/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
    const playUrl = `${domain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;
    
    const PLAYER_HEADERS = {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Accept": "application/json",
        "X-Client-Info": DEFAULT_HEADERS["X-Client-Info"],
        "Referer": playerReferer
    };
    
    let playData;
    try {
        const resp = await axios.get(playUrl, { headers: PLAYER_HEADERS, timeout: 15000 });
        playData = resp.data.data;
    } catch (err) {
        console.error("[Moviebox] Play URL fetch failed:", err.message);
        return [];
    }
    
    if (!playData || (!playData.streams && !playData.dash)) {
        return [];
    }
    
    const results = [];
    
    // Extract MP4/HLS streams
    if (playData.streams && playData.streams.length > 0) {
        for (const s of playData.streams) {
            results.push({
                server: `MovieBox ${s.resolutions}p`,
                title: `MovieBox ${s.resolutions}p`,
                quality: `${s.resolutions}p`,
                url: s.url,
                type: s.format === 'MP4' ? 'mp4' : 'hls',
                provider: 'moviebox',
                headers: {
                    'Referer': 'https://netfilm.world/',
                    'User-Agent': DEFAULT_HEADERS['User-Agent']
                }
            });
        }
    }
    
    // Extract DASH stream alternates
    if (playData.dash && playData.dash.length > 0) {
        for (const d of playData.dash) {
            results.push({
                server: `MovieBox DASH ${d.resolutions} (Auto)`,
                title: `MovieBox DASH ${d.resolutions} (Auto)`,
                quality: 'Auto',
                url: d.url,
                type: 'dash',
                provider: 'moviebox',
                headers: {
                    'Referer': 'https://netfilm.world/',
                    'User-Agent': DEFAULT_HEADERS['User-Agent']
                }
            });
        }
    }
    
    // TMDB-Embed-API unified format
    return results;
}

module.exports = { getMovieboxStreams };
