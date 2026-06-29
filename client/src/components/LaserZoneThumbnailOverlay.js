import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { hasActiveLaserZone, normalizeLaserZone } from '../utils/laserZone';

/**
 * Route thumbnail with laser zone overlay aligned to the actual rendered image
 * (object-fit: contain), not the surrounding container.
 */
const LaserZoneThumbnailOverlay = ({ image, laserZone }) => {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [imageLayout, setImageLayout] = useState(null);

  const zone = normalizeLaserZone(laserZone);
  const showZone = hasActiveLaserZone(zone);

  const measureImageLayout = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.complete || img.naturalWidth === 0) return;

    const naturalAspect = img.naturalWidth / img.naturalHeight;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    let width;
    let height;
    if (containerWidth / containerHeight > naturalAspect) {
      height = containerHeight;
      width = height * naturalAspect;
    } else {
      width = containerWidth;
      height = width / naturalAspect;
    }

    setImageLayout({
      left: (containerWidth - width) / 2,
      top: (containerHeight - height) / 2,
      width,
      height
    });
  }, []);

  useEffect(() => {
    measureImageLayout();
    window.addEventListener('resize', measureImageLayout);
    return () => window.removeEventListener('resize', measureImageLayout);
  }, [image, measureImageLayout]);

  const polygonAttr = showZone
    ? zone.points.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')
    : '';

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      <Box
        ref={imgRef}
        component="img"
        src={image}
        alt="Route thumbnail"
        onLoad={measureImageLayout}
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          borderRadius: '4px',
          display: 'block'
        }}
      />
      {showZone && imageLayout && (
        <Box
          component="svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          sx={{
            position: 'absolute',
            left: imageLayout.left,
            top: imageLayout.top,
            width: imageLayout.width,
            height: imageLayout.height,
            pointerEvents: 'none'
          }}
        >
          <polygon
            points={polygonAttr}
            fill="rgba(76, 175, 80, 0.2)"
            stroke="rgba(76, 175, 80, 0.9)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </Box>
      )}
    </Box>
  );
};

export default LaserZoneThumbnailOverlay;
