import * as feeding from './../util/feeding.js';
import * as caching from './../util/caching.js';
import { shortDateTime } from '../static/datetime.js';

const sourceFeed = 'https://www.canonrumors.com/feed/';
const sourceLabel = 'CRNEWS';
const cacheId = 'cr-cache';
const cacheMinutes = 90;
const feedLength = 12;

const matchCanonRegex = feeding.wordMatchRegex('canon');
const matchEosRegex = feeding.wordMatchRegex('eos');
const matchRfRegex = feeding.wordMatchRegex('rf');
// const matchEfRegex = feeding.wordMatchRegex('ef');

/**
 * Unwanted categories of posts to be ignored (lowercase)
 * @type {string[]}
 */
const unwantedCategories = [
    'deal zone',
    'dealzone',
    'featured deal',
    'exclusive deals',
    'prime day',
    'black friday',
    'buyers guide',
    'buying guide',
    'smart picks',
    'third party cameras'
    // 'canon reviews', // What I have seen is not really reviews, but more spec. analysis or comparisons
];

const conditionalCategories = [
    'industry news',
    'industry rumors',
    'business general',
    'third party lenses', // also count "aps-c" as a "canon reference"?
    'third party software'
    // 'from the vault' // Do I want to exclude this?
];

const stopWord = [
    feeding.wordMatchRegex('terramaster'),
    feeding.wordMatchRegex('amazon'),
    feeding.wordMatchRegex('b&h')
];

/**
 * Return if item is unwanted
 * @param item {Object}
 * @returns {boolean}
 */
function isUnwanted(item) {

    function unwantedCategory(item) {
        return unwantedCategories.some(unwantedCategory => item.categories.some(cat => cat.name.trim().toLowerCase().includes(unwantedCategory)));
    }

    function canonReference(str) {
        return matchCanonRegex.test(str) || matchEosRegex.test(str) || matchRfRegex.test(str);
    }

    function unwantedConditional(item) {
        const title = item.title ?? '';
        const description = item.description ?? '';
        const hasCanonReference = canonReference(title) || canonReference(description);
        // console.log(`"${item.title}" hasCanonReference=${hasCanonReference}`);
        return conditionalCategories.some(conditionalCategory => item.categories.some(cat => cat.name.trim().toLowerCase().includes(conditionalCategory) && !hasCanonReference));
    }

    function hasStopWord(item) {
        return stopWord.some(stop => stop.test(item.title ?? ''));
    }

    let unwanted = unwantedCategory(item) || unwantedConditional(item) || hasStopWord(item);
    // console.log(`"${item.title}" is unwanted=${unwanted}`);
    return unwanted;
}

/**
 * Returns a filtered list of items, omitting items in unwanted categories
 * @param items
 * @param [maxLength=feedLength] {number} - maximum number of items to return, defaults to feedLength
 * @returns {Object[]}
 */
function filteredItemList(items, maxLength = feedLength) {
    const filteredList = [];
    for (const item of items) {
        if (!isUnwanted(item)) {
            if (filteredList.length < maxLength) filteredList.push(item);
        }
    }
    return filteredList;
}

/**
 * Tweak items...
 * @param items {Object[]}
 * @returns {Object[]} */
function tweakItems(items) {
    for (const item of items) {
        if (!item.description?.trim()) {
            if (item.content?.encoded) {
                const textContent = feeding.stripHtml(`<html>${item.content.encoded}</html>`);
                // const { textContent, imageSrc } = feeding.extract(`<html>${item.content.encoded}</html>`);
                if (textContent?.length) {
                    item.description = textContent.substring(0, 500);
                }
                // if (imageSrc && !item._image) {
                //     item._image = imageSrc;
                // }
            }
        }
        delete item.content;
        item.description ??= '';
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
        cachedItems = tweakItems(filteredItemList(cached.cachedItems));
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

    for (const item of cachedItems) {
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
 * Returns a filtered feed of Canon Rumors posts, omitting posts in unwanted categories
 * @param feedType {'json'|'rss'}
 * @param reqHeaders {Headers}
 * @param [info] {ServeHandlerInfo<Addr>}
 * @param [logging=false] {boolean} - if true, potentially extra logging for debugging
 * @returns {Promise<{body: string, options: {status: number, statusText: string, headers: Headers}}>}
 */
export async function canonRumors(feedType, reqHeaders, info, logging = false) {

    const CreateFeedTool = feeding.getCreateFeedTool(
        feedType,
        'Canon Rumors - Essential posts only',
        'This is a filtered version of the official news feed from Canon Rumors. Posts in some categories are omitted',
        `${feeding.DeployedAt}/canon/crfeed.${feedType}`,
        'https://www.canonrumors.com/',
        'Canon Rumors',
        'https://www.canonrumors.com/wp-content/uploads/2022/05/logo-alt.png'
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
