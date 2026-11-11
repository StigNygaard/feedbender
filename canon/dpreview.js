import * as feeding from '../util/feeding.js';
import * as caching from '../util/caching.js';
import { shortDateTime } from '../static/datetime.js';

const sourceFeed = 'https://www.dpreview.com/feed/';
const sourceLabel = 'DPREVIEW';
const cacheId = 'dpr-cache';
const cacheMinutes = 90;
const feedLength = 12;

const matchCanonRegex = feeding.wordMatchRegex('Canon', 'u');
const matchRFRegex = feeding.wordMatchRegex('RF', 'u'); // also matches "RF-S"?
const matchEOSRegex = feeding.wordMatchRegex('EOS', 'u');
const matchAmazonRegex = feeding.wordMatchRegex('Amazon', 'u'); // unwanted
const matchBHRegex = feeding.wordMatchRegex('B&H', 'u'); // unwanted

const matchNikonRegex = feeding.wordMatchRegex('Nikon', 'u');
const matchSonyRegex = feeding.wordMatchRegex('Sony', 'u');

/**
 * Unwanted categories of posts to be ignored (lowercase)
 * @type {string[]}
 */
const skipCategories = [
];

/**
 * Returns if a post/item belongs to some unwanted category - or if it for some other reason is unwanted
 * @param item {Object}
 * @returns {boolean}
 */
function isUnwanted(item) {
    if (!item.comments) {
        return true; // no comments url => probably a sponsored article or a shopping guide
    }
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
    return( unwanted
        || (matchNikonRegex.test(item.title ?? '') || matchSonyRegex.test(item.title ?? '')) && !matchCanonRegex.test(item.title ?? '')
        || matchAmazonRegex.test(item.title ?? '')
        || matchBHRegex.test(item.title ?? '')
        || matchAmazonRegex.test(item.description ?? '')
        || matchBHRegex.test(item.description ?? '')
    );
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
        if (item.categories?.some(category => matchCanonRegex.test(category.name))
            || matchCanonRegex.test(item.title ?? '')
            || matchRFRegex.test(item.title ?? '')
            || matchEOSRegex.test(item.title ?? '')
            || matchCanonRegex.test(item.description ?? '')
            || matchRFRegex.test(item.description ?? '')
            || matchEOSRegex.test(item.description ?? '')
            || matchRFRegex.test(item.content?.encoded?.substring(0,5000) ?? '')
            || matchEOSRegex.test(item.content?.encoded?.substring(0,5000) ?? '')
        ) {
            if (!isUnwanted(item)) {
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
    for (const item of items) {
        delete item.content; // Delete large content.encoded field
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
        // cachedItems = filteredItemList(cached.cachedItems); // TODO: Kan ikke lave samme filtrering når .content er deleted !?!
        cachedItems = cached.cachedItems;
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

    const extrasShouldBeOlderThan = relevantItems.at(-1)?.pubDate ? new Date(relevantItems.at(-1).pubDate) : new Date();
    for (const item of cachedItems) {
        if (!relevantItems.some(relevant => relevant.guid?.value === item.guid?.value)) {
            if (new Date(item.pubDate) < extrasShouldBeOlderThan) { // This check could be part of array filtering above!
                relevantItems.push(item);
            }
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
export async function dpreview(feedType, reqHeaders, info, logging = false) {

    const CreateFeedTool = feeding.getCreateFeedTool(
        feedType,
        'DPReview - Canon related post only',
        'This is a filtered version of the official news feed from DPReview with only the Canon related posts.',
        `${feeding.DeployedAt}/canon/dpreviewfeed.${feedType}`,
        'https://www.dpreview.com/',
        'DPReview',
        'https://www.dpreview.com/wp-content/uploads/2026/07/cropped-DPREVIEW-SOCIAL-F_dce17d.avif?w=32',
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
