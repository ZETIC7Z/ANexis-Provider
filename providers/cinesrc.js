const axios = require('axios');
const crypto = require('crypto');

const HEADERS = {
    "Origin": "https://cinesrc.st",
    "Referer": "https://cinesrc.st/",
    "Content-Type": "text/plain;charset=UTF-8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
};

const API_BASE = "https://enc-dec.app/api";

// --- POW Challenge Utilities ---
function rotl(x, n) {
    n &= 31;
    x = x >>> 0;
    if (n === 0) return x;
    return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function build(w, m) {
    const s = new Uint32Array(4096);
    let x = (w[m & 3] ^ (Math.imul(m, 0x9e3779b1) - 0x61c8864f) ^ 0xa5a5a5a5) >>> 0;
    let y = 0x85ebca6b >>> 0;
    for (let i = 0; i < 4096; i++) {
        x = (x + y + w[i & 3]) >>> 0;
        x = (x ^ (x << 13)) >>> 0;
        x = (x ^ (x >>> 17)) >>> 0;
        x = (x ^ (x << 5)) >>> 0;
        s[i] = (x + Math.imul(i ^ m, 0xc2b2ae35) + rotl(w[(i + m) & 3], i + m)) >>> 0;
        y = (y - 0x7a143595) >>> 0;
    }
    return s;
}

function mix(w, s, m, n) {
    const lo = (n & 0xffffffff) >>> 0;
    const hi = ((n / 0x100000000) & 0xffffffff) >>> 0;

    let a = (w[0] ^ Math.imul(m + 1, 0x27d4eb2d) ^ lo) >>> 0;
    let b = (w[2] ^ rotl(lo, m + 5)) >>> 0;
    let c = (hi ^ (w[1] ^ 0x165667b1)) >>> 0;
    let d = (w[3] ^ rotl(lo ^ hi, m + 11)) >>> 0;

    let y = 2667;

    for (let r = 1; r <= 8; r++) {
        const v = s[(Math.imul(c, 2481) ^ rotl(b, r) ^ y ^ a) & 4095];
        const op = ((r + m - 1) & 7) - 1;

        if (op === -1) {
            a = rotl((a + d + v) >>> 0, 5);
            c = (Math.imul(a ^ c, 0x9e3779b1) + b) >>> 0;
        } else if (op === 0) {
            b = rotl((b ^ c ^ v) >>> 0, 11);
            d = (Math.imul(b ^ a, 0x85ebca6b) + d) >>> 0;
        } else if (op === 1) {
            c = rotl((b + c + v) >>> 0, 17);
            a = (Math.imul(c ^ d, 0xc2b2ae35) ^ a) >>> 0;
        } else if (op === 2) {
            d = rotl((a ^ d ^ v) >>> 0, 23);
            b = (Math.imul(d ^ c, 0x27d4eb2d) + b) >>> 0;
        } else if (op === 3) {
            a = (Math.imul(a ^ v, 0x165667b1) + rotl(b, 7)) >>> 0;
            d = (rotl((a + c) >>> 0, 13) ^ d) >>> 0;
        } else if (op === 4) {
            c = (Math.imul((v + c) >>> 0, 0xd3a2646c) ^ rotl(d, 9)) >>> 0;
            b = (rotl(c ^ a, 19) + b) >>> 0;
        } else if (op === 5) {
            b = (Math.imul(b ^ v, 0xfd7046c5) + rotl(a, 3)) >>> 0;
            c = (rotl((b + d) >>> 0, 15) ^ c) >>> 0;
        } else {
            d = (Math.imul((d + v) >>> 0, 0xb55a4f09) ^ rotl(c, 21)) >>> 0;
            a = (rotl(d ^ b, 27) + a) >>> 0;
        }
        y += 2667;
    }

    return { lo, hi, a, c, b, d };
}

function diff(h, d) {
    const q = d >> 3;
    const r = d & 7;
    for (let i = 0; i < q; i++) {
        if (h[i] !== 0) return false;
    }
    return r === 0 || (h[q] >> (8 - r)) === 0;
}

function b64(s) {
    let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) {
        normalized += "=";
    }
    return Buffer.from(normalized, 'base64');
}

function read_le32(b, p) {
    return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
}

function write_le32(b, p, x) {
    b[p] = x & 0xff;
    b[p + 1] = (x >> 8) & 0xff;
    b[p + 2] = (x >> 16) & 0xff;
    b[p + 3] = (x >> 24) & 0xff;
}

function solve_stage1(data) {
    const b = b64(data.w);
    const d = b[5];
    const m = b[6];

    const w = [
        read_le32(b, 8),
        read_le32(b, 12),
        read_le32(b, 16),
        read_le32(b, 20),
    ];

    const s = build(w, m);
    const msg = new Uint8Array(42);
    msg.set(b.subarray(8, 24), 0);
    msg[40] = 2;
    msg[41] = m;

    let n = 0;
    while (true) {
        const { lo, hi, a, c, b: b2, d: d2 } = mix(w, s, m, n);

        write_le32(msg, 16, lo);
        write_le32(msg, 20, hi);
        write_le32(msg, 24, a);
        write_le32(msg, 28, c);
        write_le32(msg, 32, b2);
        write_le32(msg, 36, d2);

        const h = crypto.createHash('sha256').update(msg).digest();
        if (diff(h, d)) {
            return `m2.${n.toString(16)}`;
        }
        n++;
    }
}

const reverseString = s => s.split('').reverse().join('');

function solve_stage2(data) {
    const target = reverseString(data.pack[0]);
    const salt = reverseString(data.pack[3]);
    const r = reverseString(data.pack[4]);

    const decodeBase64 = str => {
        let normalized = str.replace(/-/g, "+").replace(/_/g, "/");
        while (normalized.length % 4 !== 0) {
            normalized += "=";
        }
        return Buffer.from(normalized, 'base64').toString('utf-8');
    };

    const parts = r.split('.');
    const body = decodeBase64(parts[1]);
    const bodyParts = body.split('.');
    const payload = decodeBase64(bodyParts[1]);
    const difficulty = JSON.parse(payload).d;

    const width = Math.floor((difficulty + 3) / 4);
    const maxVal = 1 << difficulty;

    for (let counter = 0; counter < maxVal; counter++) {
        const key = counter.toString(16).padStart(width, '0');
        const hash = crypto.createHash('sha256').update(salt + key).digest('hex');
        if (hash === target) {
            return key;
        }
    }
    throw new Error("no solution found");
}

async function getCinesrcStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Cinesrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const isTv = mediaType === 'tv';
    
    // Resolve IMDB ID (cinesrc needs IMDB ID for embedding)
    const { resolveImdbId } = require('../utils/tmdb');
    let imdbId;
    try {
        imdbId = await resolveImdbId(isTv ? 'tv' : 'movie', tmdbId);
    } catch (e) {
        console.error('[Cinesrc] Failed to resolve IMDB ID:', e.message);
        return [];
    }

    if (!imdbId) {
        console.error('[Cinesrc] No IMDB ID resolved for TMDB ID:', tmdbId);
        return [];
    }

    const embedUrl = isTv
        ? `https://cinesrc.st/embed/tv/${imdbId}?s=${seasonNum}&e=${episodeNum}`
        : `https://cinesrc.st/embed/movie/${imdbId}`;

    try {
        // 1. Get bootstrap cookie data
        const fields = [mediaType, String(tmdbId), isTv ? Number(seasonNum) : null, isTv ? Number(episodeNum) : null];
        const fieldsStr = JSON.stringify(fields).replace(/ /g, '');
        const encodedQ = Buffer.from(fieldsStr).toString('base64').replace(/=/g, '');

        const requestHeaders = { ...HEADERS, "x-cs-q": encodedQ };
        console.log(`[Cinesrc] Bootstrapping for cinesrc...`);
        const bootstrapRes = await axios.post("https://cinesrc.st/api/c/bootstrap", null, { headers: requestHeaders, timeout: 10000 });
        
        const cookies = {
            "x-cs-q": encodedQ,
            "x-cs-r": bootstrapRes.data.r,
            "x-cs-p": bootstrapRes.data.p,
        };

        const cookieHeaders = {
            ...HEADERS,
            "Cookie": `x-cs-q=${cookies["x-cs-q"]}; x-cs-r=${encodeURIComponent(cookies["x-cs-r"])}; x-cs-p=${encodeURIComponent(cookies["x-cs-p"])}`,
            ...cookies
        };

        // 2. Resolve POW challenges
        console.log(`[Cinesrc] Solving POW stage 1...`);
        const challenge1Res = await axios.get("https://cinesrc.st/api/c/issue", { headers: cookieHeaders, timeout: 8000 });
        const stage1 = {
            challenge: challenge1Res.data,
            solution: solve_stage1(challenge1Res.data)
        };

        console.log(`[Cinesrc] Solving POW stage 2...`);
        const challenge2Res = await axios.get("https://cinesrc.st/api/c/stage2/issue", { headers: cookieHeaders, timeout: 8000 });
        const stage2 = {
            challenge: challenge2Res.data,
            solution: solve_stage2(challenge2Res.data)
        };

        const challengeData = { stage1, stage2 };

        // 3. Request enc-cinesrc from enc-dec.app VPS API
        console.log(`[Cinesrc] Solving and encrypting cinesrc token via enc-dec.app VPS...`);
        const encRes = await axios.post(`${API_BASE}/enc-cinesrc`, {
            url: embedUrl,
            agent: HEADERS["User-Agent"],
            challenge_data: challengeData
        }, { timeout: 10000 });

        if (encRes.data.status !== 200 || !encRes.data.result) {
            console.error('[Cinesrc] enc-dec API encryption failed:', encRes.data.error || 'unknown');
            return [];
        }

        const encResult = encRes.data.result;
        const finalToken = `${encResult.token}::c3::${cookies["x-cs-r"]}`;
        const key = encResult.key;
        
        const nextActionHeaders = encResult.headers;
        const getProviderList = nextActionHeaders.getProviderList;
        const getStream = nextActionHeaders.getStream;

        // 4. Get providers list from cinesrc
        const provHeaders = {
            ...HEADERS,
            "Next-Action": getProviderList,
            "Cookie": `x-cs-q=${cookies["x-cs-q"]}; x-cs-r=${encodeURIComponent(cookies["x-cs-r"])}; x-cs-p=${encodeURIComponent(cookies["x-cs-p"])}`,
        };

        const provRes = await axios.post(embedUrl, [], { headers: provHeaders, timeout: 8000 });
        const providersText = provRes.data;
        
        // Extract JSON from response
        const line = providersText.split('\n')[1];
        const colonIdx = line.indexOf(':');
        const providers = JSON.parse(line.substring(colonIdx + 1));

        console.log(`[Cinesrc] Found ${providers.length} stream providers.`);
        const streams = [];

        // 5. Try each provider
        for (const provider of providers) {
            try {
                const streamHeaders = {
                    ...HEADERS,
                    "Next-Action": getStream,
                    "Cookie": `x-cs-q=${cookies["x-cs-q"]}; x-cs-r=${encodeURIComponent(cookies["x-cs-r"])}; x-cs-p=${encodeURIComponent(cookies["x-cs-p"])}`,
                };

                const streamPayload = [
                    String(tmdbId),
                    isTv ? "show" : "movie",
                    isTv ? String(seasonNum) : "$undefined",
                    isTv ? String(episodeNum) : "$undefined",
                    finalToken,
                    provider.id
                ];

                console.log(`[Cinesrc] Fetching streams for provider '${provider.id}'`);
                const streamRes = await axios.post(embedUrl, streamPayload, { headers: streamHeaders, timeout: 8000 });
                if (streamRes.status !== 200) continue;

                const streamText = streamRes.data;
                const streamLine = streamText.split('\n')[1];
                const commaIdx = streamLine.indexOf(',');
                const colonIdx2 = streamLine.indexOf(':');
                const encryptedPayload = streamLine.substring(commaIdx + 1, colonIdx2);

                // 6. Decrypt stream via enc-dec.app VPS API
                const decRes = await axios.post(`${API_BASE}/dec-cinesrc`, {
                    text: encryptedPayload,
                    key: key
                }, { timeout: 8000 });

                if (decRes.data.status === 200 && decRes.data.result) {
                    const decrypted = decRes.data.result;
                    
                    if (Array.isArray(decrypted.sources)) {
                        decrypted.sources.forEach(src => {
                            streams.push({
                                server: `Cinesrc (${provider.id.toUpperCase()})`,
                                title: `Cinesrc - ${src.label || 'Auto'}`,
                                url: src.file,
                                quality: src.label || 'Auto',
                                type: src.file.includes('.m3u8') ? 'hls' : 'mp4',
                                provider: 'cinesrc',
                                headers: {
                                    "Referer": "https://cinesrc.st/",
                                    "User-Agent": HEADERS["User-Agent"]
                                }
                            });
                        });
                    }
                    // Stop once we find valid streams
                    if (streams.length > 0) break;
                }
            } catch (provErr) {
                console.warn(`[Cinesrc] Provider '${provider.id}' failed:`, provErr.message);
            }
        }

        console.log(`[Cinesrc] Got ${streams.length} stream(s).`);
        return streams;

    } catch (err) {
        console.error(`[Cinesrc] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getCinesrcStreams };
