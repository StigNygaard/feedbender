import { parseRssFeed, parseRdfFeed, generateJsonFeed, generateRssFeed } from 'feedsmith';
import { DomParser } from '@thednp/domparser';

const corsAllowHostnames = Deno.env.get('feedbender_cors_allow_hostnames')?.toLowerCase()?.split(/\s*(?:[,;]|$)\s*/) ?? [];
const parser = DomParser();
export const DeployedAt = 'https://feedbender.com'; // TODO Or via env?
export const fetcherUserAgent = Deno.env.get('feedbender_fetcher_useragent');
const feedFetcherHeaders = new Headers({});
if (fetcherUserAgent) {
    feedFetcherHeaders.set('User-Agent', fetcherUserAgent);
    // feedFetcherHeaders.set('Accept', 'application/rss+xml');
}

/**
 * Returns a RegExp for checking if an exact "token" (not just part of a longer word/token) is in a string
 * @param word {string}
 * @param [modifier='iu'] {string}
 * @returns {RegExp}
 */
export function wordMatchRegex(word, modifier = 'iu') {
    return new RegExp(`\\b${RegExp.escape ? RegExp.escape(word) : word}\\b`, modifier); // RegExp.escape() supported in Deno 2.3.2+
}

/**
 * Check if the content of arrays differs.
 * (Comparing as JSON values - with the limitations of that method)
 */
export function arraysDiffers(arr1 = [], arr2=[]) {
    if (arr1.length !== arr2.length) return true;
    return JSON.stringify(arr1) !== JSON.stringify(arr2);
    // Other ways: https://www.syncfusion.com/blogs/post/deep-compare-javascript-objects
}


/**
 * Checks if str is a date in RFC 2822 date format
 * @param str {string}
 * @returns {boolean}
 */
export function isRFC2822DateString(str) {
    return /^(?:(Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s+)?(0[1-9]|[1-2]?[0-9]|3[01])\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(19[0-9]{2}|[2-9][0-9]{3})\s+(2[0-3]|[0-1][0-9]):([0-5][0-9])(?::(60|[0-5][0-9]))?\s+([-+][0-9]{2}[0-5][0-9]|(?:UT|GMT|(?:E|C|M|P)(?:ST|DT)|[A-IK-Z]))(\s+|\(([^()]+|\\\(|\\\))*\))*$/.test(str);
}


function extractTextContent(root) {
    const retVal = root?.querySelector('html')?.textContent ?? ''; // TODO fail if 'html' tags is not found?
    // let retVal = doc?.body?.textContent ?? ''; // Wish I could do something like this instead?!
    // Far from W3C/browser's .textContent property, but somehow useful with following hack applied...
    return retVal.trim().replaceAll(/(\S)\n/gu, '$1 \n')
        .replaceAll(/([^\n])\n([^\n])/gu, '$1$2') // If it is a *single* newline, then remove it!
        .replaceAll(/\n{2,}/gu, '\n') // collapse groups of newlines to single newlines
        .replaceAll(/\s+\n/gu, '\n');
}

function extractImageSrc(root, imgSelector= 'img', srcRegex) {
    if (!root) return null;
    if (srcRegex) {
        const imgs = root.querySelectorAll(imgSelector);
        for (const img of imgs) {
            const src = img.getAttribute('src'); // or srcset, currentSrc ?
            if (srcRegex.test(src)) {
                return src;
            }
        }
        return null;
    } else {
        const img = root.querySelector(imgSelector);
        return img?.getAttribute('src'); // or srcset, currentSrc ?
    }
}

export function extract(htmlStr, imgSelector= 'img', srcRegex) {
    const root = parser.parseFromString(htmlStr, 'text/html')?.root; // TODO: can throw error!
    return { textContent: extractTextContent(root), imageSrc: extractImageSrc(root, imgSelector, srcRegex) };
}

/**
 * Returns a string with the HTML tags stripped from it. Content in the htmlStr parameter needs to be within <html> tags (?!)
 * @param htmlStr {string}
 * @returns {string}
 */
export function stripHtml(htmlStr) {
    const doc = parser.parseFromString(htmlStr, 'text/html')?.root; // TODO: can throw error!
    return extractTextContent(doc);
}

/**
 * Returns the src attribute of the first "relevant" image found in htmlStr.
 * @param htmlStr {string}
 * @param [imgSelector='img'] {string}
 * @param [srcRegex] {RegExp}
 * @returns {?string}
 */
export function findImageSrc(htmlStr, imgSelector= 'img', srcRegex) {
    // const { components, tags, root } = parser.parseFromString(content, 'text/html');

    // console.log(`html to parse (length=${htmlStr.length}) : \n${htmlStr}`);
    let root;
    try {
        root = parser.parseFromString(htmlStr, 'text/html')?.root;
    } catch (e) {
        console.error('Error parsing html when trying to extract images', e);
        return null;
    }
    return extractImageSrc(root, imgSelector, srcRegex);
}

/**
 * Checks if the origin is allowed for CORS
 * @param origin
 * @returns {boolean}
 */
export function isAllowedForCors(origin) {
    const originHostname = URL.parse(origin)?.hostname?.toLowerCase();
    if (originHostname != null) {
        for (const corsAllowedHostname of corsAllowHostnames) {
            if (
                corsAllowedHostname.length &&
                (originHostname === corsAllowedHostname || originHostname.endsWith(`.${corsAllowedHostname}`))
            ) {
                return true;
            }
        }
    }
    return false;
}

export function tryJSONParse(str) {
    let parsed = null;
    try {
        parsed = JSON.parse(str);
    } catch (error_) {
        return {value: str, valid: false};
    }
    return {value: parsed, valid: true};
}

export function tryJSONStringify(o) {
    let parsed = null;
    try {
        parsed = JSON.stringify(o);
    } catch (error_) {
        return {value: o, valid: false};
    }
    return {value: parsed, valid: true};
}

/**
 * Fetches a text response from a URL
 * @param request
 * @param options
 * @returns {Promise<string>}
 */
async function fetchText(request, options) {
    const response = await fetch(request, options);
    if (!response.ok) {
        throw new Error(`fetch '${request.url ?? request}' response status: ${response.status}: \n${response.statusText}`);
    }
    return await response.text();
}

/**
 * Fetches a JSON response from a URL
 * @param request
 * @param options
 * @returns {Promise<any>}
 */
async function fetchJson(request, options) {
    const response = await fetch(request, options);
    if (!response.ok) {
        throw new Error(`fetch '${request.url ?? request}' response status: ${response.status}: \n${response.statusText}`);
    }
    return await response.json();
}

/**
 * Fetches and parses the source items from a provided RSS feed URL.
 *
 * @param req {string} - The URL of the RSS feed to fetch and parse.
 * @param [timeout=15000] {number} - The maximum time (in milliseconds) to wait for the fetch request to complete before timing out. Defaults to 15 seconds.
 * @return {Promise<Object[]>} - A promise that resolves to an array of parsed source items from the RSS feed. If an error occurs, it returns an empty array.
 */
export async function getParsedSourceItems(req, timeout = 15000) {
    let items = [];
    let text;
    try {
        text = await fetchText(
            req,
            {
                headers: feedFetcherHeaders,
                signal: AbortSignal.timeout(timeout) // timeout after (default) 15 seconds
            }
        );
        const feed = req.includes('asia.nikkei.com') ? parseRdfFeed(text) : parseRssFeed(text); // A hack because parseFeed "misbehaves".
        // const feed = parseFeed(text); // TODO: I wish I could just do this instead?!
        // console.log(`The full feed:\n${JSON.stringify(feed)}`);

        items = feed.items ?? [];
        console.log(` 🤖 FEED ${req} WAS READ`);

        for (const item of items) {
            if (!item.pubDate) item.pubDate = new Date().toUTCString()
        }
    } catch (e) {
        if (text?.length) {
            console.log('Response body:\n', text);
        }
        console.error(e);
    }
    return items;
}

/**
 * Returns a "tool" to create a new feed (RSS or JSONFeed) based on the provided parameters.
 * @param feedType {'json'|'rss'}
 * @param feedTitle {string}
 * @param feedDescription {string}
 * @param feedUrl {string} - "self" link to the feed
 * @param siteUrl {string}
 * @param genericAuthorName {string} - A "global" feed/site authorname. Could just be sitename or some general term like "users".
 * @param logoUrl {string}
 * @param updatePeriod {'hourly'|'daily'|'weekly'|'monthly'|'yearly'} - update period
 * @param updateFrequency {number} - number to set the update frequency relative to the update period.
 * @returns {{title, description, home_page_url, language: string, feed_url, authors: [{name, url}], items: *[]}|{title, description, link, atom: {links: [{href, rel: string, type: string}]}, language: string, generator: string, items: *[]}|string|{readonly contentType: string, readonly template: {title: *, description: *, home_page_url: *, language: string, feed_url: *, authors: [{name: *, url: *}], items: []}|{title: *, description: *, link: *, atom: {links: [{href: *, rel: string, type: string}]}, language: string, generator: string, items: []}, createItem: {(*): {id: (*|string), title: string, content_html: string, author: {name: (*|string)}, authors: [{name: (*|string)}], url: string, date_published: Date}, (*): {guid: {value: (*|string), isPermaLink: boolean}, title: string, link: string, description: string, pubDate: *, dc: {creators: [(*|string)]}}}, createResponseBody: {(*): string, (*): *}}}
 */
export function getCreateFeedTool(feedType, feedTitle, feedDescription, feedUrl, siteUrl, genericAuthorName, logoUrl, updatePeriod = 'hourly', updateFrequency = 1) {

    const contentType = (feedType === 'json' ?
        'application/feed+json; charset=utf-8'
        : 'application/rss+xml; charset=utf-8');

    // FAR from perfect, but while waiting for https://github.com/macieklamberski/feedsmith/issues/6 ?
    const matchEmailRegexp = /(?:^|\s|<|\()([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63})(?:$|\s|>|\))/gu;
    function authorName(item) {
        // Quick fix to return an item-author *without* an eventual email-address included in value.
        // TODO skulle være overflødig nu (https://feedsmith.dev/migration/v2-to-v3#rss-person-fields-changed-from-strings-to-objects) medmindre dc.creators stadig kan indeholde email og <([])> ?
        let name = (item.dc?.creators?.at(0) ?? item.authors?.at(0)?.name ?? genericAuthorName ?? '').replaceAll(matchEmailRegexp, '');
        name = name.replaceAll(/[><)(\]\[]*/gu, '');
        return name.trim();
    }

    function createJsonItem(item) {
        const publishDate = new Date(item.pubDate);
        const newItem = {
            id: item.guid?.value ?? item.link ?? siteUrl,
            title: item.title ?? '(No title)',
            // CONSIDER: If '', just set content_text to '' instead of setting content_html !?
            content_html: item.content?.encoded ?? item.description ?? '', // This or content_text must be specified in JSON Feed (But empty string is ok)
            author: {
                name: authorName(item)
            },
            authors: [
                {
                    name: authorName(item)
                }
            ],
            url: item.link ?? siteUrl,
            // RFC 2822 Date format (like "Sun, 13 Jul 2025 07:17:55 +0000") is supported as constructor-value, even if it's not part of ECMAScript standard
            // date_published: isRFC2822DateString(item.pubDate ?? '') ? new Date(item.pubDate) : new Date() // TODO this is too late for new Date() - do it on read of feed if missing
            date_published: Number.isNaN(publishDate.valueOf()) ? item.pubDate : publishDate
        };
        if (item.enclosures?.length) {
            // newItem.image only used when creating a JSON Feed
            newItem.image = item.enclosures.find(enclosure => enclosure.type?.startsWith('image/'))?.url;
            // newItem.attachments are used for both RSS and JSON Feeds
            newItem.attachments = [];
            for (const enclosure of item.enclosures) {
                const attachment = {
                    url: enclosure.url,
                    mime_type: enclosure.type
                }
                if (enclosure.length) {
                    attachment.size_in_bytes = enclosure.length;
                }
                newItem.attachments.push(attachment);
            }
        }
        if (item.media?.thumbnails?.length) {
            if (!newItem.image) {
                newItem.image = item.media.thumbnails[0].url;
            }
        }
        if (!newItem.image && item._image) {
            // item._image is a "custom property", which might be defined when parsing/tweaking the original feed.
            newItem.image = item._image;
        }
        if (item.categories?.length) {
            newItem.tags = [];
            for (const category of item.categories) {
                newItem.tags.push(category.name);
            }
        }
        return newItem;
    }

    function createRssItem(item) {
        const newItem = {
            guid: {
                value: item.guid?.value ?? item.link ?? siteUrl,
                isPermaLink: false
            },
            title: item.title ?? '(No title)',
            link: item.link ?? siteUrl,
            description: item.content?.encoded ?? item.description, // Can be undefined in RSS, if the title is specified
            pubDate: item.pubDate, // RFC 2822 Date format (like "Sun, 13 Jul 2025 07:17:55 +0000") is supported as constructor-value, even if it's not part of ECMAScript standard
            dc: {
                creators: [authorName(item)]
            }
        };
        if (item.enclosures?.length) {
            newItem.enclosures = [];
            for (const enclosure of item.enclosures) {
                const newEnclosure = {
                    url: enclosure.url,
                    type: enclosure.type
                }
                if (enclosure.length) {
                    newEnclosure.length = enclosure.length;
                }
                newItem.enclosures.push(newEnclosure);
            }
        }
        if (item.media?.thumbnails?.length) {
            newItem.media = {thumbnails: []};
            for (const thumbnail of item.media.thumbnails) {
                const newThumb = {
                    url: thumbnail.url,
                }
                if (thumbnail.width) {
                    newThumb.width = thumbnail.width;
                }
                if (thumbnail.height) {
                    newThumb.height = thumbnail.height;
                }
                newItem.media.thumbnails.push(newThumb);
            }
        }
        if (item.categories?.length) {
            newItem.categories = [];
            for (const category of item.categories) {
                newItem.categories.push({name: category.name});
            }
        }
        return newItem;
    }

    function createJsonResponseBody(feedData, options = {}) {
        const jsonFeedObj = generateJsonFeed(feedData, options);
        return JSON.stringify(jsonFeedObj);
    }

    function createRssResponseBody(feedData, options = {}) {
        return generateRssFeed(feedData, options);
    }


    return {
        get contentType() {
            return contentType;
        },
        get template() {
            return feedType === 'json' ?
                {
                    title: feedTitle,
                    description: feedDescription,
                    home_page_url: siteUrl,
                    language: 'en-US',
                    feed_url: feedUrl,
                    authors: [
                        {
                            name: genericAuthorName,
                            url: siteUrl
                        }
                    ],
                    items: []
                } :
                {
                    title: feedTitle,
                    description: feedDescription,
                    link: siteUrl,
                    atom: {
                        links: [{
                            href: feedUrl,
                            rel: 'self',
                            type: 'application/rss+xml'
                        }]
                    },
                    language: 'en-US',
                    generator: 'https://feedbender.com/',
                    sy: {
                        updatePeriod: updatePeriod,
                        updateFrequency: updateFrequency
                    },
                    items: []
                }
        },
        createItem: feedType === 'json' ? createJsonItem : createRssItem,
        createResponseBody: feedType === 'json' ? createJsonResponseBody : createRssResponseBody
    }

}
