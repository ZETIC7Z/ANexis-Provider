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

const PLAYER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Source": ""
};

let cachedToken = null;
let tokenExpiry = 0;

// Helper to clean/normalize text for similarity comparison
function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/\[[^\]]+\]/g, '') // remove bracket info
        .replace(/[^a-z0-9]/g, '')  // remove non-alphanumeric
        .trim();
}

async function getGuestToken() {
    if (cachedToken && Date.now() < tokenExpiry) {
        return cachedToken;
    }
    
    try {
        const resp = await axios.get(`${API_BASE}/home?host=moviebox.ph`, { 
            headers: DEFAULT_HEADERS,
            timeout: 10000 
        });
        
        let token = null;
        const xUserHeader = resp.headers['x-user'];
        if (xUserHeader) {
            const parsed = JSON.parse(xUserHeader);
            token = parsed.token;
        } else {
            const setCookie = resp.headers['set-cookie'];
            if (setCookie) {
                for (const c of setCookie) {
                    const match = c.match(/token=([^;]+)/);
                    if (match) {
                        token = match[1];
                        break;
                    }
                }
            }
        }
        
        if (token) {
            cachedToken = token;
            // Token is a JWT, usually valid for hours/days. Set safe local expiry to 1 hour.
            tokenExpiry = Date.now() + 60 * 60 * 1000;
            return token;
        }
    } catch (e) {
        console.error("[Vidbox] Failed to fetch guest token:", e.message);
    }
    return null;
}

async function getVidboxStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidbox] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    
    try {
        // 1. Fetch details from TMDB to get the title and release year
        const details = await getDetails(mediaType, tmdbId);
        if (!details) {
            console.error("[Vidbox] Failed to retrieve details from TMDB.");
            return [];
        }
        
        const originalTitle = mediaType === 'movie' ? details.title : details.name;
        const releaseDate = mediaType === 'movie' ? details.release_date : details.first_air_date;
        const releaseYear = releaseDate ? releaseDate.split('-')[0] : '';
        
        if (!originalTitle) {
            console.error("[Vidbox] TMDB did not return a valid title/name.");
            return [];
        }
        
        console.log(`[Vidbox] TMDB Title: "${originalTitle}" (${releaseYear})`);
        
        // 2. Get the auth guest token
        const token = await getGuestToken();
        if (!token) {
            console.error("[Vidbox] No authentication token available.");
            return [];
        }
        
        const authHeaders = {
            ...DEFAULT_HEADERS,
            "Authorization": `Bearer ${token}`
        };
        
        // 3. Search for the title on the BFF API
        const searchResp = await axios.post(`${API_BASE}/subject/search`, {
            keyword: originalTitle,
            page: 1,
            perPage: 20
        }, { headers: authHeaders, timeout: 10000 });
        
        const items = searchResp.data?.data?.items || [];
        if (items.length === 0) {
            console.log(`[Vidbox] No search results returned for keyword: "${originalTitle}"`);
            return [];
        }
        
        // Normalize the TMDB original title for comparison
        const normalizedTarget = normalizeTitle(originalTitle);
        
        // Filter and find matching items (could be multiple for different dubs)
        const matchedItems = items.filter(item => {
            const normalizedItem = normalizeTitle(item.title);
            // Must have high similarity or be contained
            return normalizedItem.includes(normalizedTarget) || normalizedTarget.includes(normalizedItem);
        });
        
        if (matchedItems.length === 0) {
            console.log(`[Vidbox] No search items matched the target title: "${originalTitle}"`);
            return [];
        }
        
        console.log(`[Vidbox] Found ${matchedItems.length} matching search candidate(s).`);
        
        // Get media player domain (netfilm.world or movibox.net)
        let playerDomain = "https://netfilm.world";
        try {
            const domResp = await axios.get(`${API_BASE}/media-player/get-domain`, { headers: authHeaders, timeout: 8000 });
            if (domResp.data?.data) {
                playerDomain = domResp.data.data.replace(/\/$/, "");
            }
        } catch (domErr) {
            console.warn("[Vidbox] Failed to retrieve player domain, falling back to netfilm.world:", domErr.message);
        }
        
        // 4. Resolve streams for each matched item (dub) in parallel
        const streamPromises = matchedItems.map(async (item) => {
            const itemStreams = [];
            try {
                const subjectId = item.subjectId;
                const detailPath = item.detailPath;
                const itemTitle = item.title;
                
                // Determine dub label from search item title (e.g. "One Piece [English]" -> "English")
                let dubLabel = "Sub/Original";
                const dubMatch = itemTitle.match(/\[([^\]]+)\]/);
                if (dubMatch) {
                    dubLabel = dubMatch[1];
                }
                
                // Fetch the detail of the item to get seasons/episodes structure
                const detailResp = await axios.get(`${API_BASE}/detail?detailPath=${detailPath}`, { headers: authHeaders, timeout: 10000 });
                const detailData = detailResp.data?.data || {};
                const seasons = detailData.resource?.seasons || [];
                
                let se = 1;
                let ep = 1;
                
                if (mediaType === 'movie') {
                    // Movies usually have se = seasons[0].se (could be 0 or 1)
                    se = seasons[0]?.se !== undefined ? seasons[0].se : 1;
                    ep = 1;
                } else {
                    // TV Series / Anime
                    if (seasons.length === 1 && seasons[0].se === 1 && seasons[0].maxEp > 100) {
                        // Anime continuous absolute episode structure (e.g. One Piece)
                        se = 1;
                        ep = episodeNum || 1;
                    } else {
                        // Regular multi-season structure
                        const matchedSeason = seasons.find(s => s.se === seasonNum);
                        if (matchedSeason) {
                            se = seasonNum;
                            ep = episodeNum || 1;
                        } else {
                            // If the season is not found, skip this candidate as it does not cover the requested season
                            return [];
                        }
                    }
                }
                
                // Build Referer header to bypass anti-hotlinking
                // For movies, if host is movibox, we use movibox.net as referer base
                const refererDomain = (mediaType === 'movie') ? "https://movibox.net" : playerDomain;
                
                const playerReferer = `${refererDomain}/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=${mediaType === 'movie' ? '' : se}&detailEp=${mediaType === 'movie' ? '' : ep}&lang=en`;
                const playUrl = `${refererDomain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${detailPath}`;
                
                const playResp = await axios.get(playUrl, {
                    headers: {
                        ...PLAYER_HEADERS,
                        "Referer": playerReferer,
                        "Authorization": `Bearer ${token}`
                    },
                    timeout: 12000
                });
                
                const playData = playResp.data?.data || {};
                if (!playData.hasResource) {
                    return [];
                }
                
                const streams = playData.streams || [];
                const dash = playData.dash || [];
                
                // Fetch subtitles/captions if any stream/dash item exists
                const subs = [];
                let firstStreamId = null;
                let streamFormat = "MP4";
                
                if (streams.length > 0) {
                    firstStreamId = streams[0].id;
                    streamFormat = streams[0].format || "MP4";
                } else if (dash.length > 0) {
                    firstStreamId = dash[0].id;
                    streamFormat = dash[0].format || "DASH";
                }
                
                if (firstStreamId) {
                    try {
                        const capUrl = `${API_BASE}/subject/caption?format=${streamFormat}&id=${firstStreamId}&subjectId=${subjectId}&detailPath=${detailPath}`;
                        const capResp = await axios.get(capUrl, { headers: authHeaders, timeout: 8000 });
                        const captions = capResp.data?.data?.captions || capResp.data?.data || [];
                        
                        if (Array.isArray(captions)) {
                            captions.forEach(cap => {
                                if (cap.url) {
                                    subs.push({
                                        url: cap.url,
                                        label: cap.lanName || 'Unknown',
                                        lang: cap.lan || 'en',
                                        format: cap.url.includes('.vtt') ? 'vtt' : 'srt'
                                    });
                                }
                            });
                        }
                    } catch (capErr) {
                        // ignore caption errors
                    }
                }
                
                // Add direct MP4 streams
                streams.forEach(s => {
                    if (s.url) {
                        itemStreams.push({
                            server: `Vidbox - ${dubLabel} (${s.resolutions}p)`,
                            title: `${originalTitle} - ${dubLabel} (${s.resolutions}p)`,
                            url: s.url,
                            quality: `${s.resolutions}p`,
                            type: 'mp4',
                            provider: 'vidbox',
                            subtitles: subs,
                            headers: {
                                "Referer": `${refererDomain}/`,
                                "User-Agent": PLAYER_HEADERS["User-Agent"]
                            }
                        });
                    }
                });
                
                // Add DASH streams
                dash.forEach(d => {
                    if (d.url) {
                        itemStreams.push({
                            server: `Vidbox DASH - ${dubLabel} (${d.resolutions}p)`,
                            title: `${originalTitle} - DASH ${dubLabel} (${d.resolutions}p)`,
                            url: d.url,
                            quality: `${d.resolutions}p`,
                            type: 'dash',
                            provider: 'vidbox',
                            subtitles: subs,
                            headers: {
                                "Referer": `${refererDomain}/`,
                                "User-Agent": PLAYER_HEADERS["User-Agent"]
                            }
                        });
                    }
                });
                
            } catch (candErr) {
                console.error(`[Vidbox] Error resolving candidate "${item.title}":`, candErr.message);
            }
            return itemStreams;
        });
        
        const streamResults = await Promise.all(streamPromises);
        const allStreams = streamResults.flat();
        
        console.log(`[Vidbox] Resolved ${allStreams.length} total stream(s) in parallel.`);
        return allStreams;
        
    } catch (err) {
        console.error("[Vidbox] Main error:", err.message);
        return [];
    }
}

module.exports = { getVidboxStreams };
