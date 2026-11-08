import '@std/dotenv/load';

const kv = await Deno.openKv(Deno.env.get('feedbender_kv_path')?.trim());

export async function get(key) {
    if (!Array.isArray(key)) {
        key = [key];
    }
    const content = await kv.get(key);
    return JSON.parse(content?.value ?? '[]');
}

/**
 * Set a value. Throws error if failing.
 * @param key
 * @param value
 * @returns {Promise<Deno.KvCommitResult>}
 */
export async function set(key, value) {
    if (!Array.isArray(key)) {
        key = [key];
    }
    const jsonValue = JSON.stringify(value);
    if (jsonValue.length >= 32768) {
        const err = `Value for key '${key}' is ${jsonValue.length} 'code units' long, and larger than allowed`;
        console.error(err);
        throw new Error(err);
    }
    const retVal = await kv.set(key, JSON.stringify(value));
    retVal.info = `String value of length ${jsonValue.length} is saved on key '${key}'`;
    return retVal;
}
