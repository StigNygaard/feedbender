import * as feeding from './../util/feeding.js';
import * as caching from './../util/caching.js';
import {shortDateTime} from "../static/datetime.js";

// XenForo forum system

// In RSS:
//  <category domain="https://www.snbforums.com/forums/asuswrt-official.51/"><![CDATA[ASUSWRT - Official]]></category>

// const sourceFeed = 'https://www.snbforums.com/forums/-/index.rss?order=post_date'; // all forums
const sourceFeed = 'https://www.snbforums.com/forums/51/index.rss?order=post_date'; // only /asuswrt-official.51/ (ASUSWRT - Official)
// const sourceFeed = 'https://www.snbforums.com/forums/asuswrt-official.51/index.rss?order=post_date'; // same as above
const sourceLabel = 'ASUSWRTFORUM';
const cacheId = 'asuswrt-cache';
const cacheMinutes = 120;
const feedLength = 6;

const matchAx88uRegex = feeding.wordMatchRegex('rt-ax88u');
const matchBe88uRegex = feeding.wordMatchRegex('rt-be88u'); // The successor to the RT-AX88U
// const matchAsuswrtRegex = feeding.wordMatchRegex('asuswrt - official');

/**
 * Returns a filtered list of new threads (topics) in forum, trying to avoid the
 * threads created to be a comment-section for a post on the main-site.
 * @param items
 * @param [maxLength=feedLength] {number} - maximum number of items to return, defaults to feedLength
 * @returns {Object[]}
 */
function filteredItemList(items, maxLength = feedLength) {
    const filteredList = [];
    for (const item of items) {
        if (matchAx88uRegex.test(item.title ?? '') || matchBe88uRegex.test(item.title ?? '')) {
            if (filteredList.length < maxLength) filteredList.push(item);
        }
    }
    return filteredList;
}

/**
 * Returns a list of relevant/filtered feed items
 * @returns {Promise<Object[]>}
 */
async function feedItems() {
    const feedRequestTime = new Date();
    let cachedTime = new Date('2000-01-01');
    let finalItems = [];
    const cached = await caching.get(cacheId);
    if (cached?.cachedTime) {
        cachedTime = new Date(cached.cachedTime);
    }
    if (cached?.cachedItems) {
        finalItems = filteredItemList(cached.cachedItems);
    }
    // console.log(` 🤖 CACHED FORUM-CONTENT FROM ${cachedTime} WAS READ. There was ${finalItems?.length} cached items.`);

    if (finalItems?.length && ((feedRequestTime.getTime() - cachedTime.getTime()) < (cacheMinutes * 60 * 1000))) {
        console.log(` 🤖 For ${sourceLabel}, just use the recently updated (${shortDateTime(cachedTime,'shortOffset')}) CACHED ITEMS`);
        return finalItems;
    }
    const highestGuid = finalItems.length ? finalItems[0].guid.value : 0;

    const sourceItems = await feeding.getParsedSourceItems(sourceFeed);
    let relevantSourceItems = [];
    if (sourceItems?.length) {
        sourceItems.sort((a, b) => {
            const va = Number(a.guid?.value);
            const vb = Number(b.guid?.value);
            return (Number.isNaN(vb) ? 0 : vb) - (Number.isNaN(va) ? 0 : va)
        });

        // console.log('\nsourceItems:\n', JSON.stringify(sourceItems));
        relevantSourceItems = filteredItemList(sourceItems);
    }
    const lengthOfCachedItems = finalItems.length;
    finalItems.unshift(...relevantSourceItems.filter(item => item.guid.value > highestGuid));
    if (finalItems?.length > lengthOfCachedItems) {
        console.log(` 🌟 ${finalItems?.length - lengthOfCachedItems} new thread(s) was added to the ${sourceLabel} feed!`);
    }
    if (finalItems.length) {
        let cached = {};
        try {
            cached = await caching.set(cacheId, {
                cachedTime: feedRequestTime,
                cachedItems: finalItems.slice(0, feedLength)
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
    return finalItems;
}

/**
 * Returns a filtered feed of new Canon Rumors Forum threads (topics), omitting the threads created
 * to be a "comment-section" for a news-posting on the main-site.
 * @param feedType {'json'|'rss'}
 * @param reqHeaders {Headers}
 * @param [info] {ServeHandlerInfo<Addr>}
 * @param [logging=false] {boolean} - if true, potentially extra logging for debugging
 * @returns {Promise<{body: string, options: {status: number, statusText: string, headers: Headers}}>}
 */
export async function asuswrtForum(feedType, reqHeaders, info, logging = false) {

    const CreateFeedTool = feeding.getCreateFeedTool(
        feedType,
        'ASUS WRT - New RT-AX88U or RT-BE88U firmware threads',
        'Keeping track of threads/topics about new firmwares for RT-AX88U or RT-BE88U in the "ASUSWRT - Official" forum',
        `${feeding.DeployedAt}/misc/asuswrtfeed.${feedType}`,
        'https://www.snbforums.com/forums/asuswrt-official.51/',
        'ASUS WRT Forum users',
        'https://www.snbforums.com/styles/snb_new_round.jpg',
        'daily',
        4 // every six hours
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
