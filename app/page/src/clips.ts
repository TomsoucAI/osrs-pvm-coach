// Where the browser loads a Clip from (ADR 2 in spec #72). Each host here is one the UI server's security headers allow:
// media and images from the OSRS Wiki, thumbnails from YouTube's image host, frames from YouTube's no-cookie player.
const WIKI_IMAGES = 'https://oldschool.runescape.wiki/images/';

export function wikiClipUrl(file: string): string {
  return `${WIKI_IMAGES}${encodeURIComponent(file)}`;
}

/** Muted, so the player may start on its own after the click; `end` stops it at the Clip's end. */
export function youTubeEmbedUrl({ videoId, start, end }: { videoId: string; start: number; end: number }): string {
  const query = new URLSearchParams({
    start: String(start), end: String(end), autoplay: '1', mute: '1', rel: '0', playsinline: '1',
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${query}`;
}

export function youTubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}
