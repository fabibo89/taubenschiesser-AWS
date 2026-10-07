import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * Progress as logo scene: robot+gun (left) → water bar → pigeon+crosshair (right).
 * Assets: /images/Roboter.png (mirrored to shoot right), /images/Taube.png (mirrored to face left).
 */
const ShootProgressBar = ({ value = 0, max = 10, height = 72, showLabel = true }) => {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Math.min(safeMax, Number(value) || 0));
  const pct = (safeValue / safeMax) * 100;

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
        <Box
          component="img"
          src="/images/Roboter.png"
          alt="Roboter mit Pistole"
          sx={{
            height,
            width: 'auto',
            flexShrink: 0,
            transform: 'scaleX(-1)',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
        />

        <Box
          sx={{
            position: 'relative',
            flex: 1,
            height: 16,
            borderRadius: 999,
            bgcolor: 'grey.200',
            overflow: 'visible',
            mx: 0.5
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              width: `${pct}%`,
              borderRadius: 999,
              background: 'linear-gradient(90deg, #a8d4f0 0%, #4aa3e0 55%, #3b8fd0 100%)',
              transition: 'width 45ms linear'
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              left: `calc(${pct}% - 4px)`,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              transition: 'left 45ms linear',
              pointerEvents: 'none'
            }}
          >
            <Box
              sx={{
                width: 11,
                height: 15,
                bgcolor: '#4aa3e0',
                borderRadius: '45% 45% 55% 55%',
                transform: 'rotate(-28deg)'
              }}
            />
            <Box
              sx={{
                width: 8,
                height: 11,
                bgcolor: '#7eb8e8',
                borderRadius: '45% 45% 55% 55%',
                transform: 'rotate(-22deg)'
              }}
            />
          </Box>
        </Box>

        <Box
          component="img"
          src="/images/Taube.png"
          alt="Taube mit Fadenkreuz"
          sx={{
            height,
            width: 'auto',
            flexShrink: 0,
            transform: 'scaleX(-1)',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
        />
      </Box>
      {showLabel && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, textAlign: 'center' }}>
          {safeValue} / {safeMax}
        </Typography>
      )}
    </Box>
  );
};

export default ShootProgressBar;
