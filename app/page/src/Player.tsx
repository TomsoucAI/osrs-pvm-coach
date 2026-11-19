// The Briefing's player (ticket #78): the selected Mechanic's Clips, from prototype variant D (commit d976b26).
// A Wiki clip loops, muted, in the page. A YouTube Clip shows its thumbnail and loads the no-cookie player only on a
// click. The browser loads both from the hosts that the security headers allow (ADR 2 in spec #72).
import { useState } from 'react';
import type { Mechanic } from './api';
import { wikiClipUrl, youTubeEmbedUrl, youTubeThumbUrl } from './clips';
import { duration } from './duration';

type Clip = Mechanic['clips'][number];

function WikiClip({ clip }: { clip: Extract<Clip, { kind: 'wiki' }> }) {
  // `muted` is set on the element itself: autoplay starts only on a muted video, and React does not always write
  // the attribute before the browser decides.
  return (
    <div className="pl-screen">
      <video
        ref={(v) => { if (v) v.muted = true; }}
        src={wikiClipUrl(clip.file)} autoPlay loop muted playsInline preload="auto" aria-label={clip.label}
      />
      <span className="pl-badge">loop</span>
    </div>
  );
}

function YouTubeClip({ clip }: { clip: Extract<Clip, { kind: 'youtube' }> }) {
  const [open, setOpen] = useState(false);
  /** A new key loads the frame again: the player goes back to the Clip's start. */
  const [run, setRun] = useState(0);
  if (!open) {
    return (
      <button type="button" className="pl-screen pl-facade" onClick={() => setOpen(true)} aria-label={`Play the Clip: ${clip.label}`}>
        <img src={youTubeThumbUrl(clip.videoId)} alt="" />
        <span className="pl-play" aria-hidden="true">▶</span>
        <span className="pl-badge">{duration(clip.end - clip.start)}</span>
      </button>
    );
  }
  return (
    <div className="pl-screen">
      {/* The page sends no referrer (server header). YouTube's player refuses to play without one (error 153), so
          only this frame sets its own policy: the player gets the page's origin, never its path. */}
      <iframe
        key={run}
        src={youTubeEmbedUrl(clip)}
        title={clip.label}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <button type="button" className="pl-badge pl-replay" onClick={() => setRun(run + 1)}>↺ Replay</button>
    </div>
  );
}

/** One Mechanic's Clips: the player, a pill per Clip when there are several, the "Watch:" line and the credit. */
export function Player({ clips }: { clips: Clip[] }) {
  const [index, setIndex] = useState(0);
  const clip = clips[index];
  if (!clip) return <div className="pl-screen pl-none">No clip yet</div>;
  return (
    <figure className="pl">
      {clip.kind === 'wiki'
        ? <WikiClip key={clip.file} clip={clip} />
        : <YouTubeClip key={`${clip.videoId}-${clip.start}`} clip={clip} />}
      {clips.length > 1 && (
        <div className="pl-pills">
          {clips.map((c, i) => (
            <button key={c.label} type="button" className={`btn ${i === index ? 'on' : ''}`} aria-pressed={i === index} onClick={() => setIndex(i)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <figcaption>
        <b>Watch:</b> {clip.watch} <span className="pl-credit">· {clip.credit}</span>
      </figcaption>
    </figure>
  );
}
