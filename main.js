import { serveDir } from '@std/http/file-server';
import '@std/dotenv/load';
import { canonRumors } from './canon/canon-rumors.js';
import { ymCinema } from './canon/ymcinema.js';
import { cineD } from "./canon/cined.js";
import { isWorld } from './canon/image-sensor-world.js';
import { p2pSensor } from './canon/p2psensor.js';
import { dpreview } from './canon/dpreview.js';
import { dprForumAll } from './canon/dpreview-forum-all.js';
import { opticalLimits } from './canon/opticallimits.js';
import { shortDateTime } from './static/datetime.js';
import { nikkeiAsia } from "./canon/asia-nikkei.js";
import { eosMagazine } from "./canon/eos-magazine.js";
import { asuswrtForum } from "./misc/asuswrt.js";

let responseHeaders = {
    // 'Content-Security-Policy': `default-src 'none' ; script-src 'self' ; connect-src https: ; img-src https: blob: data: ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`,
    // 'Content-Security-Policy': "default-src 'self' ; connect-src https: ; img-src https: blob: data: ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'",
    'Content-Security-Policy': "default-src 'self' ; connect-src https: ; img-src https: blob: data: ; base-uri 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff'
};
let responseHeadersArr = Object.entries(responseHeaders).map(([k, v]) => `${k}: ${v}`);

// const crPathPattern = new URLPattern({ pathname: "/canon/crfeed.json" });
// const crPathPattern = new URLPattern({ pathname: "/canon/crfeed{/}?" });
// const mainStaticPathPattern = new URLPattern({ pathname: "{/*}?" });
// const mainStaticPathPattern = new URLPattern({ pathname: "/:file?" });
// CANON related:
const crPathPattern = new URLPattern({ pathname: "/canon/crfeed.:type(json|rss)" });
const ymcPathPattern = new URLPattern({ pathname: "/canon/ymcfeed.:type(json|rss)" });
const cinedPathPattern = new URLPattern({ pathname: "/canon/cinedfeed.:type(json|rss)" });
const iswPathPattern = new URLPattern({ pathname: "/canon/iswfeed.:type(json|rss)" });
const p2psensorPathPattern = new URLPattern({ pathname: "/canon/p2psensorfeed.:type(json|rss)" });
const dprforumallPathPattern = new URLPattern({ pathname: "/canon/dprfallfeed.:type(json|rss)" });
const dpreviewPathPattern = new URLPattern({ pathname: "/canon/dpreviewfeed.:type(json|rss)" });
const opticallimitsPathPattern = new URLPattern({ pathname: "/canon/optlimitsfeed.:type(json|rss)" });
const nikkeiPathPattern = new URLPattern({ pathname: "/canon/nikkeifeed.:type(json|rss)" });
const eosmagPathPattern = new URLPattern({ pathname: "/canon/eosmagfeed.:type(json|rss)" });
// MISC:
const asuswrtPathPattern = new URLPattern({ pathname: "/misc/asuswrtfeed.:type(json|rss)" });

const serveOptions = {};
const servePort = Deno.env.get('feedbender_serve_port')?.trim();
if (servePort?.length) {
    serveOptions.port = Number.parseInt(servePort, 10);
}
const serveHostname = Deno.env.get('feedbender_serve_hostname')?.trim();
if (serveHostname?.length) {
    serveOptions.hostname = serveHostname;
}

// we could set a port-number with Deno.serve({port: portno}, handler);
Deno.serve(serveOptions, handler);

const now = new Date();
// https://github.com/denoland/deploy_feedback/issues/705
console.log(` >>>  ${shortDateTime(now, 'shortOffset')} - main.js running on Deno ${Deno.version.deno} (${navigator.userAgent.toLowerCase()})`);


async function handler(req, info) {
    const urlObj = new URL(req.url);
    const origin = urlObj.origin;
    const isLocalhost = urlObj.hostname === 'localhost';

    if (isLocalhost) { // Different Content-Security-Policy in header when localhost
        responseHeaders = {
            'Content-Security-Policy': `default-src 'none' ; script-src 'self' ; connect-src https: ${origin} ; img-src https: blob: data: ${origin} ; style-src 'self' ; frame-ancestors 'none' ; form-action 'self' ; base-uri 'none'`,
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'X-Content-Type-Options': 'nosniff'
        };
        responseHeadersArr = Object.entries(responseHeaders).map(([k, v]) => `${k}: ${v}`);
    }

    function remoteAddr(info) {
        if ('hostname' in info.remoteAddr) {
            return {
                remoteIp: info.remoteAddr.hostname,
                remotePort: info.remoteAddr.port
            };
        }
        return {};
    }

    function skipLog(req) {
        return /\.[a-zA-Z]{2,3}$/.test(req.url) // skip logging files with 2-3 characters extension (a very quick filtering of log😉)
            // || ( // and got tired of this stupid client constant visiting...
            //     req.url === 'https://feedbender.com:443/'
            //     && req.headers?.get('referer') === 'http://feedbender.com'
            //     && req.headers?.get('user-agent') === 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
            // )
            ;
    }


    /* *** The "Router"... *** */

    if (req.method === 'GET') {

        /* Feed: Canon Rumors - Essential posts only */
        let feedType = crPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (crPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for CRNEWS by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await canonRumors(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for CRNEWS ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: Y.M. Cinema - Canon related only */
        feedType = ymcPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (ymcPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for YMCINEMA by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await ymCinema(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for YMCINEMA ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: CineD - Canon related only */
        feedType = cinedPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (cinedPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for CINED by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await cineD(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for CINED ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: OpticalLimits - Canon mount lens reviews */
        feedType = opticallimitsPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (opticallimitsPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for OPTLIMITS by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await opticalLimits(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for OPTLIMITS ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: Image Sensor World - Canon related only */
        feedType = iswPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (iswPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for ISWORLD by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await isWorld(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for ISWORLD ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: Photons to Photos (Sensor updates) - Canon related only */
        feedType = p2psensorPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (p2psensorPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for P2PSENSOR by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await p2pSensor(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for P2PSENSOR ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: EOS Magazine News */
        feedType = eosmagPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (eosmagPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for EOSMAG by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await eosMagazine(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for EOSMAG ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: DPReview */
        feedType = dpreviewPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (dpreviewPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for DPREVIEW by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await dpreview(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for DPREVIEW ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: NEW DPReview Forums ALL */
        feedType = dprforumallPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (dprforumallPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for DPRFORUMALL by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await dprForumAll(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for DPRFORUMALL ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: Nikkei Asia */
        feedType = nikkeiPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (nikkeiPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for NIKKEI by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await nikkeiAsia(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for NIKKEI ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Feed: ASUSWRT Forums */
        feedType = asuswrtPathPattern.exec(urlObj)?.pathname?.groups?.type;
        if (feedType) { // if (asuswrtPathPattern.test(urlObj)) ...
            console.log(` 🤖 * ${feedType.toUpperCase()} feed request for ASUSWRT by: ${req.headers?.get('User-Agent') ?? ''}`);
            const result = await asuswrtForum(feedType, req.headers, info, isLocalhost);
            console.log(` 🤖 Complete ${feedType.toUpperCase()} feed for ASUSWRT ready to be served.`);
            return new Response(result.body, { headers: responseHeaders, ...result.options });
        }

        /* Static content */
        if (!skipLog(req)) {
            console.log(` 👀 ${remoteAddr(info).remoteIp} - ${req.url} - Referer: ${req.headers?.get('referer') ?? '(none)'}\n - User-Agent: ${req.headers?.get('user-agent')}`);
        }
        // console.log('responseHeadersArr: ', responseHeadersArr);
        return await serveDir(req, {
            urlRoot: '',
            fsRoot: 'static',
            showDirListing: false,
            showDotfiles: false,
            showIndex: true, // index.html
            enableCors: false, // CORS not allowed/enabled (no CORS headers)
            quiet: true, // logging of errors
            headers: responseHeadersArr
        });

    } else {

        /* Unexpected request */
        return new Response('Not found', {
            status: 404,
            statusText: `Not found or method '${req.method}' not supported here`,
            headers: responseHeaders
        });

    }
}
