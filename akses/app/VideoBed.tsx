import { useEffect, useRef, useState } from 'react';

/**
 * Latar video sinematik, satu klip pendek yang berulang di belakang semua panel.
 *
 * Empat aturan yang menjaganya agar tidak jadi beban:
 *  - poster dicat lebih dulu, jadi tidak pernah ada kedipan hitam
 *  - prefers-reduced-motion mendapat poster, bukan loop bergerak
 *  - berhenti saat tab disembunyikan (tidak ada decode sia-sia)
 *  - scrim di atasnya, jadi kontras teks tidak bergantung pada frame saat ini
 */
type Props = {
  src?: string;
  poster: string;
  /** Menggelapkan frame supaya teks tetap terbaca di area terang. */
  scrim?: number;
};

export function VideoBed({ src, poster, scrim = 0.55 }: Props) {
  const [reduced, setReduced] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reduced || !src) return;

    const play = () => {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    };

    play();

    const onVisibility = () => {
      if (document.hidden) video.pause();
      else play();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      video.pause();
    };
  }, [reduced, src]);

  return (
    <div className="videobed" aria-hidden="true">
      {reduced || !src ? (
        <img className="videobed__media" src={poster} alt="" />
      ) : (
        <video
          ref={videoRef}
          className="videobed__media"
          data-playing={playing}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="metadata"
        />
      )}
      <div className="videobed__scrim" style={{ opacity: scrim }} />
    </div>
  );
}
