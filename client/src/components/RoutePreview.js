import React, { useState, useEffect, useRef } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';

/**
 * Komponente für die Route-Vorschau mit Zoom-Rahmen
 * Zeigt ein Vorschaubild an und zeichnet einen roten Rahmen, der den Zoom-Bereich darstellt
 */
const RoutePreview = ({ previewImage, previewLoading, previewError, zoom }) => {
  const previewImageRef = useRef(null);
  const containerRef = useRef(null);
  const [imageDimensions, setImageDimensions] = useState({ 
    width: 0, 
    height: 0, 
    left: 0, 
    top: 0, 
    aspectRatio: 1,
    naturalWidth: 0,
    naturalHeight: 0
  });
  const [containerAspectRatio, setContainerAspectRatio] = useState(null);

  // Bildgröße zurücksetzen, wenn sich das Vorschaubild ändert
  useEffect(() => {
    if (previewImage) {
      setImageDimensions({ width: 0, height: 0 });
      setContainerAspectRatio(null);
    }
  }, [previewImage]);

  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        borderRadius: 1,
        border: '1px dashed',
        borderColor: 'divider',
        textAlign: 'center'
      }}
    >
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle2">
          Live-Vorschau
        </Typography>
        <Box display="flex" gap={2} alignItems="center">
          {imageDimensions.naturalWidth > 0 && imageDimensions.naturalHeight > 0 && (
            <Typography variant="caption" color="text.secondary">
              Bild: {imageDimensions.naturalWidth} × {imageDimensions.naturalHeight} px
            </Typography>
          )}
          {imageDimensions.naturalWidth > 0 && imageDimensions.naturalHeight > 0 && zoom && (
            <Typography variant="caption" color="text.secondary">
              Sichtbar: {Math.round(imageDimensions.naturalWidth / zoom)} × {Math.round(imageDimensions.naturalHeight / zoom)} px
            </Typography>
          )}
        </Box>
      </Box>
      {previewLoading ? (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight={160}>
          <CircularProgress size={32} />
        </Box>
      ) : previewImage ? (
        <Box
          ref={containerRef}
          sx={{
            position: 'relative',
            display: 'inline-block',
            width: '100%',
            maxHeight: 240,
            overflow: 'hidden',
            borderRadius: 1,
            // Stelle sicher, dass der Container die Bildproportionen hat
            ...(containerAspectRatio && {
              aspectRatio: containerAspectRatio,
              maxHeight: 240,
              width: 'auto',
              maxWidth: '100%'
            })
          }}
        >
          <Box
            ref={previewImageRef}
            component="img"
            src={previewImage}
            alt="Route preview"
            sx={{
              maxHeight: 240,
              width: '100%',
              height: 'auto',
              objectFit: 'contain',
              borderRadius: 1,
              display: 'block',
              // Zoom mit gleichmäßiger Skalierung - behält Proportionen bei
              transform: zoom && zoom > 1 ? `scale(${zoom})` : 'scale(1)',
              transformOrigin: 'center center',
              transition: 'transform 0.2s ease',
              // Stelle sicher, dass das Bild seine natürlichen Proportionen behält
              objectPosition: 'center'
            }}
            onLoad={(e) => {
              // Bildgröße und Position nach dem Laden messen
              const img = e.target;
              const container = containerRef.current;
              
              // Warte kurz, damit das Layout vollständig gerendert ist
              setTimeout(() => {
                // WICHTIG: Berechne die tatsächliche gerenderte BILD-Größe
                // Das Bild hat objectFit: 'contain', daher muss die Größe basierend auf
                // dem natürlichen Seitenverhältnis und dem verfügbaren Platz berechnet werden
                const naturalWidth = img.naturalWidth;
                const naturalHeight = img.naturalHeight;
                const naturalAspectRatio = naturalWidth / naturalHeight;
                
                if (container) {
                  const containerRect = container.getBoundingClientRect();
                  const imgRect = img.getBoundingClientRect();
                  
                  // Container-Größe (verfügbarer Platz)
                  const containerWidth = containerRect.width;
                  const containerHeight = containerRect.height;
                  
                  // Berechne die tatsächliche gerenderte Bildgröße mit objectFit: 'contain'
                  // Das Bild wird so skaliert, dass es in den Container passt, aber das Seitenverhältnis beibehält
                  let actualImageWidth, actualImageHeight;
                  
                  if (containerWidth / containerHeight > naturalAspectRatio) {
                    // Container ist breiter - Höhe ist der limitierende Faktor
                    actualImageHeight = Math.min(containerHeight, 240); // maxHeight: 240
                    actualImageWidth = actualImageHeight * naturalAspectRatio;
                  } else {
                    // Container ist höher - Breite ist der limitierende Faktor
                    actualImageWidth = containerWidth;
                    actualImageHeight = actualImageWidth / naturalAspectRatio;
                    // Prüfe maxHeight
                    if (actualImageHeight > 240) {
                      actualImageHeight = 240;
                      actualImageWidth = actualImageHeight * naturalAspectRatio;
                    }
                  }
                  
                  // Berechne die Position (zentriert wegen objectFit: 'contain')
                  const relativeLeft = (containerWidth - actualImageWidth) / 2;
                  const relativeTop = (containerHeight - actualImageHeight) / 2;
                  
                  console.log('Image dimensions:', {
                    naturalWidth,
                    naturalHeight,
                    naturalAspectRatio,
                    containerWidth,
                    containerHeight,
                    actualImageWidth,
                    actualImageHeight,
                    relativeLeft,
                    relativeTop
                  });
                  
                  setImageDimensions({
                    width: actualImageWidth,
                    height: actualImageHeight,
                    left: relativeLeft,
                    top: relativeTop,
                    aspectRatio: naturalAspectRatio,
                    naturalWidth: naturalWidth,
                    naturalHeight: naturalHeight
                  });
                  
                  // Setze Container-Seitenverhältnis basierend auf natürlicher Bildgröße
                  setContainerAspectRatio(naturalAspectRatio);
                } else {
                  // Fallback: verwende getBoundingClientRect
                  const imgRect = img.getBoundingClientRect();
                  setImageDimensions({
                    width: imgRect.width,
                    height: imgRect.height,
                    left: 0,
                    top: 0,
                    aspectRatio: naturalAspectRatio,
                    naturalWidth: naturalWidth,
                    naturalHeight: naturalHeight
                  });
                  
                  // Setze Container-Seitenverhältnis basierend auf natürlicher Bildgröße
                  setContainerAspectRatio(naturalAspectRatio);
                }
              }, 10);
            }}
          />
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Noch keine Vorschau angefordert
        </Typography>
      )}
      {previewError && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {previewError}
        </Typography>
      )}
    </Box>
  );
};

export default RoutePreview;

