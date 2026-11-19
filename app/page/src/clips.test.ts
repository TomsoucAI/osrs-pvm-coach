// The Briefing's Clips: where the browser loads each one from. Each host here is one the security headers allow.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { wikiClipUrl, youTubeEmbedUrl, youTubeThumbUrl } from './clips';

test('a Wiki clip loads from the OSRS Wiki images path, its file name URL-encoded', () => {
  assert.equal(
    wikiClipUrl("Maggot_king_dh_stepback-drag-drag.webm"),
    'https://oldschool.runescape.wiki/images/Maggot_king_dh_stepback-drag-drag.webm',
  );
  assert.equal(wikiClipUrl("Dharok's punish (1).webm"), "https://oldschool.runescape.wiki/images/Dharok's%20punish%20(1).webm");
});

test('a YouTube Clip opens the no-cookie player at its start and end, muted, playing', () => {
  const url = new URL(youTubeEmbedUrl({ videoId: '0iIPIZTfsBU', start: 228, end: 258 }));

  assert.equal(url.origin, 'https://www.youtube-nocookie.com');
  assert.equal(url.pathname, '/embed/0iIPIZTfsBU');
  assert.equal(url.searchParams.get('start'), '228');
  assert.equal(url.searchParams.get('end'), '258');
  assert.equal(url.searchParams.get('autoplay'), '1');
  assert.equal(url.searchParams.get('mute'), '1');
});

test('before the click, a YouTube Clip shows its thumbnail from YouTube\'s image host', () => {
  assert.equal(youTubeThumbUrl('0iIPIZTfsBU'), 'https://i.ytimg.com/vi/0iIPIZTfsBU/hqdefault.jpg');
});
