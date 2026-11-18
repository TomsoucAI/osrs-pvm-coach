// Item icons (ticket #10, ADR-3 in spec #1): fetched from the OSRS Wiki on first use, then kept on disk.
// The icons are Jagex's copyright. Tom accepted the risk under Jagex's Fan Content Policy clause 6.1.3
// (see docs/research/osrsbestinslot-ux.md §6). The page credits Jagex and the wiki.
//
// Privacy: the request names only the wiki file, which comes from the engine's item data, never from the page.
// It carries one header, a generic User-Agent: no player name, no contact data, no cookie.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findItem } from '../calc';

const WIKI_IMAGES = 'https://oldschool.runescape.wiki/images/';
/** The wiki asks for a descriptive User-Agent and blocks the library defaults (RuneScape:Real-time_Prices). */
const USER_AGENT = 'osrs-pvm-coach (local item icon cache)';
const FETCH_TIMEOUT_MS = 5_000;
/** An item icon is about 0.5 KiB. A bigger reply is not an icon. */
const MAX_ICON_BYTES = 64 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface IconCache {
  /** The PNG for an item id, or null when the item is unknown or the wiki gives no usable icon. */
  get(itemId: number): Promise<Buffer | null>;
}

export function createIconCache(dir: string, fetchIcon: typeof fetch): IconCache {
  // Icons that failed in this run. A restart tries them again; nothing bad is ever written to disk.
  const failed = new Set<number>();
  // One wiki request per icon, even when the page asks for it from both paperdolls at once.
  const pending = new Map<number, Promise<Buffer | null>>();

  async function download(id: number, image: string): Promise<Buffer | null> {
    const url = WIKI_IMAGES + encodeURIComponent(image.replaceAll(' ', '_'));
    try {
      const reply = await fetchIcon(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!reply.ok || !reply.headers.get('content-type')?.startsWith('image/png')) return null;
      const body = Buffer.from(await reply.arrayBuffer());
      if (body.length > MAX_ICON_BYTES || !body.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
      await mkdir(dir, { recursive: true });
      // Write, then rename: a crash never leaves half an icon in the cache.
      const file = join(dir, `${id}.png`);
      await writeFile(`${file}.tmp`, body);
      await rename(`${file}.tmp`, file);
      return body;
    } catch {
      return null;
    }
  }

  return {
    async get(itemId) {
      const item = findItem(itemId);
      if (!item?.image) return null;
      const cached = await readFile(join(dir, `${item.id}.png`)).catch(() => null);
      if (cached) return cached;
      if (failed.has(item.id)) return null;
      let job = pending.get(item.id);
      if (!job) {
        job = download(item.id, item.image).then((icon) => {
          if (!icon) failed.add(item.id);
          pending.delete(item.id);
          return icon;
        });
        pending.set(item.id, job);
      }
      return job;
    },
  };
}
