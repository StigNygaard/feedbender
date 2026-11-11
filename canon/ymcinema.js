import * as feeding from '../util/feeding.js';
import * as caching from '../util/caching.js';
import { shortDateTime } from '../static/datetime.js';

const sourceFeed = 'https://ymcinema.com/feed';
const sourceLabel = 'YMCINEMA';
const cacheId = 'ymc-cache';
const cacheMinutes = 120;
const feedLength = 12;

const matchCanonRegex = feeding.wordMatchRegex('canon');
const matchNikonRegex = feeding.wordMatchRegex('nikon');
const matchSonyRegex = feeding.wordMatchRegex('sony');

/**
 * Unwanted categories of posts to be ignored (lowercase)
 * @type {string[]}
 */
const skipCategories = [
    'deals',
    'amazon'
];

function hasUnwantedContent(item) {
    // Probably unwanted if mentions Nikon or Sony, But *not* Canon...
    return (matchNikonRegex.test(item.description) || matchSonyRegex.test(item.description))
        && !matchCanonRegex.test(item.description);
}

/**
 * Returns if a post/item belongs to some unwanted category
 * @param item {Object}
 * @returns {boolean}
 */
function inUnwantedCategory(item) {
    let unwanted = false;
    if (skipCategories.length) {
        for (const category of item.categories) {
            const categoryName = category.name.trim().toLowerCase();
            // Also unwanted if just a "substring" of a category-name matches a skipCategory:
            if (skipCategories.some(skipCategory => categoryName.includes(skipCategory))) {
                unwanted = true; // is an unwanted item
            }
        }
    }
    return unwanted;
}

/**
 * Returns a filtered list of canon-related items, omitting items in unwanted categories
 * @param items {Object[]}
 * @param [maxLength=feedLength] {number} - maximum number of items to return, defaults to feedLength
 * @returns {Object[]}
 */
function filteredItemList(items, maxLength = feedLength) {
    const filteredList = [];
    for (const item of items) {
        if (item.categories?.some(category => matchCanonRegex.test(category.name))) {
            if (!(inUnwantedCategory(item) || hasUnwantedContent(item))) {
                if (filteredList.length < maxLength) filteredList.push(item);
            }
        }
    }
    return filteredList;
}

/**
 * Removes the (typically) very big content.encoded field from the items, leaving only the shorter description field.
 * ...But first, eventually finding an image in content.encoded field and saving it in the "custom" _image field.
 * @param items {Object[]}
 * @returns {Object[]}
 */
function tweakItems(items) {
    const srcRegExp = /^https:\/\/ymcinema\.com\/wp-content\/uploads\/[^"'>]+\.(webp|jpg|jpeg|avif|jxl)/;
    for (const item of items) {
        if (item.description && item.content) {
            const imageSrc = feeding.findImageSrc(item.content.encoded, 'img', srcRegExp);
            if (imageSrc && !item._image) {
                item._image = imageSrc;
            }
            delete item.content;
        }
    }
    return items;
}

/**
 * Returns a list of relevant (filtered) feed items
 * @returns {Promise<Object[]>}
 */
async function feedItems() {
    const feedRequestTime = new Date();
    let cachedTime = new Date('2000-01-01');
    let cachedItems = [];
    const cached = await caching.get(cacheId);
    if (cached?.cachedTime) {
        cachedTime = new Date(cached.cachedTime);
    }
    if (cached?.cachedItems) {
        cachedItems = filteredItemList(cached.cachedItems);
    }
    // console.log(` 🤖 CACHED CONTENT FROM ${cachedTime} WAS READ`);

    if (cachedItems?.length && ((feedRequestTime.getTime() - cachedTime.getTime()) < (cacheMinutes * 60 * 1000))) {
        console.log(` 🤖 For ${sourceLabel}, just use the recently updated (${shortDateTime(cachedTime,'shortOffset')}) CACHED ITEMS`);
        return cachedItems;
    }

    const sourceItems = await feeding.getParsedSourceItems(sourceFeed);
    let relevantItems = [];
    if (sourceItems?.length) {
        relevantItems = tweakItems(filteredItemList(sourceItems));
    }

    for (const item of cachedItems) { // TODO: Add posttime check? See depreview.js (or dpreview-forum-all.js?)
        if (!relevantItems.some(relevant => relevant.guid?.value === item.guid?.value)) {
            relevantItems.push(item);
        }
    }
    if (relevantItems.length) {
        if (relevantItems.length > cachedItems.length) {
            console.log(` 🌟 New item(s) was added to the ${sourceLabel} feed at ${shortDateTime(new Date(), 'shortOffset')}!`);
        }
        let cached = {};
        try {
            cached = await caching.set(cacheId, {
                cachedTime: feedRequestTime,
                cachedItems: relevantItems.slice(0, feedLength)
            });
        } catch (err) {
            console.error(` 💣 Error when trying to update cache for ${sourceLabel}!`, err);
        }
        if (cached?.ok) {
            console.log(` 🤖 Cache for ${sourceLabel} was ${sourceItems?.length ? 'updated' : '"extended"'}. ${cached.info}.`);
        } else {
            console.warn(` 💣 Failed updating cache for ${sourceLabel}!`)
        }
    }
    return relevantItems;
}

/**
 * Returns a filtered feed, omitting posts in unwanted categories
 * @param feedType {'json'|'rss'}
 * @param reqHeaders {Headers}
 * @param [info] {ServeHandlerInfo<Addr>}
 * @param [logging=false] {boolean} - if true, potentially extra logging for debugging
 * @returns {Promise<{body: string, options: {status: number, statusText: string, headers: Headers}}>}
 */
export async function ymCinema(feedType, reqHeaders, info, logging = false) {

    const CreateFeedTool = feeding.getCreateFeedTool(
        feedType,
        'Y.M Cinema - Canon related post only',
        'This is a filtered version of the official news feed from Y.M Cinema with only the Canon related posts.',
        `${feeding.DeployedAt}/canon/ymcfeed.${feedType}`,
        'https://ymcinema.com/',
        'Y.M Cinema',
        'https://ymcinema.com/wp-content/uploads/2018/07/Company-Logo.png',
        'daily',
        8 // every three hours
    );

    const origin = reqHeaders.get('Origin');
    const respHeaders = new Headers({'Content-Type': CreateFeedTool.contentType});
    if (origin && feeding.isAllowedForCors(origin)) {
        respHeaders.set('Access-Control-Allow-Origin', origin);
        respHeaders.set('Vary', 'Origin');
    }
    const feedData = CreateFeedTool.template;
    const latestRelevantItems = await feedItems();
    for (const item of latestRelevantItems) {
        feedData.items.push(CreateFeedTool.createItem(item));
    }
    const responseBody = CreateFeedTool.createResponseBody(feedData, {});
    return {
        body: responseBody,
        options: {
            status: 200,
            statusText: 'OK',
            headers: respHeaders
        }
    };

}
