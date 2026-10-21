import { useId, type CSSProperties, type ReactNode } from 'react';

/**
 * Permukaan kaca dengan refraksi sungguhan.
 *
 * Blur saja terbaca sebagai plastik buram. Yang membuatnya terbaca sebagai
 * kaca adalah pembelokan latar: feTurbulence membuat medan noise halus,
 * feGaussianBlur melembutkannya, lalu feDisplacementMap membelokkan latar
 * melalui medan itu. Terlihat di Chromium sebagai tepi yang membiaskan.
 *
 * Setiap instance butuh id filter sendiri. Tanpa itu, permukaan pertama yang
 * dipasang menang dan semua permukaan lain diam-diam kehilangan refraksinya.
 */

type Props = {
  children: ReactNode;
  /** Kekuatan pembelokan, px. Di bawah 40 sub-piksel dan tak terlihat;
   *  50-70 terbaca sebagai kaca tebal; di atas 90 seperti air beriak. */
  refract?: number;
  /** Blur dasar, px. Jaga rendah: pembelokan yang bekerja. */
  blur?: number;
  /** Warna dasar panel. */
  tint?: string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'section' | 'aside' | 'article';
};

export function Glass({
  children,
  refract = 55,
  blur = 3,
  tint = 'rgba(10, 13, 20, 0.72)',
  radius = 24,
  className = '',
  style,
  as: Tag = 'div',
}: Props) {
  const uid = useId().replace(/:/g, '');
  const filterId = `kaca-${uid}`;

  return (
    <Tag
      className={`glass ${className}`}
      style={{
        borderRadius: radius,
        background: tint,
        backdropFilter: `blur(${blur}px) url(#${filterId}) saturate(160%)`,
        WebkitBackdropFilter: `blur(${blur}px) url(#${filterId}) saturate(160%)`,
        ...style,
      }}
    >
      <svg className="glass__defs" aria-hidden="true" focusable="false">
        <filter
          id={filterId}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          {/* baseFrequency rendah = belokan besar dan halus seperti lensa;
              tinggi = riak halus seperti air. 0.0045 terbaca sebagai kaca
              tebal pada skala UI. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.0045 0.007"
            numOctaves={2}
            seed={11}
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation={9} result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale={refract}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>

      {/* Rim specular: terang di tepi atas, pantulan di bawah. Inilah petunjuk
          yang membuat permukaan terbaca sebagai keping fisik, bukan kotak
          berwarna. */}
      <span className="glass__rim" aria-hidden="true" />
      <div className="glass__content">{children}</div>
    </Tag>
  );
}
