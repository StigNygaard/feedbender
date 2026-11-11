import * as feeding from '../util/feeding.js';
import * as caching from '../util/caching.js';
import { shortDateTime } from '../static/datetime.js';

const sourceFeed = 'https://www.cined.com/feed';
const sourceLabel = 'CINED';
const cacheId = 'cined-cache';
const cacheMinutes = 120;
const feedLength = 12;

const matchCanonRegex = feeding.wordMatchRegex('canon');
const matchEosRegex = feeding.wordMatchRegex('eos');
const matchRfRegex = feeding.wordMatchRegex('rf');
const matchLensRegex = feeding.wordMatchRegex('lens');
const matchMountRegex = feeding.wordMatchRegex('mount');
const matchMountsRegex = feeding.wordMatchRegex('mounts');

/**
 * Unwanted categories of posts to be ignored (lowercase)
 * @type {string[]}
 */
const skipCategories = [
    'deal'
];

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
 * Returns a filtered list of items looking related to Canon
 * @param items {Object[]}
 * @param [maxLength=feedLength] {number} - maximum number of items to return, defaults to feedLength
 * @returns {Object[]}
 */
function filteredItemList(items, maxLength = feedLength) {
    const filteredList = [];
    for (const item of items) {
        const title = item.title?.toLowerCase() ?? '';
        const hasCanonReference = item.categories?.some(category => category?.name.trim().toLowerCase() === 'canon')
            || matchCanonRegex.test(title) || matchEosRegex.test(title)
            || matchRfRegex.test(title) && (matchLensRegex.test(title) || matchMountRegex.test(title));
        if (hasCanonReference && !inUnwantedCategory(item)) {
            if (filteredList.length < maxLength) filteredList.push(item);
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
    const srcRegExp = /^https:\/\/www\.cined\.com\/content\/uploads\/[^"'>]+\.(webp|jpg|jpeg|avif|jxl)/;
    for (const item of items) {
        if (item.description && item.content) {
            // "Backup image" to use if none is attached in enclosures
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
export async function cineD(feedType, reqHeaders, info, logging = false) {

    const CreateFeedTool = feeding.getCreateFeedTool(
        feedType,
        'CineD - Canon related post only',
        'This is a filtered version of the official news feed from CineD with only the Canon related posts.',
        `${feeding.DeployedAt}/canon/cinedfeed.${feedType}`,
        'https://cined.com/',
        'CineD',
        'https://www.cined.com/content/themes/cinemad/assets/images/favicons/android-icon-192x192.png',
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
