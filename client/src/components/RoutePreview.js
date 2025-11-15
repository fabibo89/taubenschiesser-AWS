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

  // Bildgröße zurücksetzen, wenn sich das Vorschaubild ändert
  useEffect(() => {
    if (previewImage) {
      setImageDimensions({ width: 0, height: 0 });
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
              Rahmen: {Math.round(imageDimensions.naturalWidth / zoom)} × {Math.round(imageDimensions.naturalHeight / zoom)} px
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
            maxHeight: 240
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
              objectFit: 'contain',
              borderRadius: 1,
              display: 'block'
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
                }
              }, 10);
            }}
          />
          {/* Roter Rahmen für Zoom-Bereich */}
          {imageDimensions.width > 0 && imageDimensions.height > 0 && imageDimensions.naturalWidth > 0 && imageDimensions.naturalHeight > 0 && zoom && (() => {
            // Berechne Rahmen-Größe basierend auf Zoom
            // Bei Zoom 1x soll der Rahmen die natürliche Bildgröße haben
            // Skaliere die natürliche Bildgröße auf die gerenderte Bildgröße
            const scaleX = imageDimensions.width / imageDimensions.naturalWidth;
            const scaleY = imageDimensions.height / imageDimensions.naturalHeight;
            
            // Rahmen-Größe in natürlichen Pixeln
            const frameNaturalWidth = imageDimensions.naturalWidth / zoom;
            const frameNaturalHeight = imageDimensions.naturalHeight / zoom;
            
            // Skaliere auf gerenderte Größe
            const frameWidth = frameNaturalWidth * scaleX;
            const frameHeight = frameNaturalHeight * scaleY;
            
            return (
              <Box
                sx={{
                  position: 'absolute',
                  // Positioniere den Rahmen relativ zum gerenderten Bild, nicht zum Container
                  left: `${imageDimensions.left + (imageDimensions.width / 2)}px`,
                  top: `${imageDimensions.top + (imageDimensions.height / 2)}px`,
                  transform: 'translate(-50%, -50%)',
                  // Verwende berechnete Größe - skaliert von natürlicher auf gerenderte Größe
                  width: `${frameWidth}px`,
                  height: `${frameHeight}px`,
                  border: '3px solid',
                  borderColor: 'error.main',
                  borderRadius: 1,
                  pointerEvents: 'none',
                  boxSizing: 'border-box',
                  transition: 'width 0.2s ease, height 0.2s ease, left 0.2s ease, top 0.2s ease',
                  boxShadow: '0 0 0 2px rgba(211, 47, 47, 0.3)'
                }}
              />
            );
          })()}
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

