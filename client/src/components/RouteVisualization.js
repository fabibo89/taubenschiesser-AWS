import React, { useState } from 'react';
import { Box, Typography, Slider } from '@mui/material';
import { calculateRoutePosition } from '../utils/routeUtils';

/**
 * Gemeinsame Route-Visualisierungs-Komponente
 * Wird von Devices.js und DeviceDetail.js verwendet
 */
const RouteVisualization = ({ coordinates, height = 300, showLabels = true }) => {
  const baseImageSize = 120; // Basis-Größe des Bildes in Pixeln bei zoom=1
  const [imageScale, setImageScale] = useState(1); // Skalierungsfaktor für alle Bilder

  return (
    <Box>
      {/* Bildgrößen-Schieber */}
      <Box sx={{ mb: 2, px: 2 }}>
        <Typography variant="caption" gutterBottom sx={{ display: 'block', color: '#666' }}>
          Bildgröße: {imageScale.toFixed(1)}x
        </Typography>
        <Slider
          value={imageScale}
          onChange={(e, newValue) => setImageScale(newValue)}
          min={0.5}
          max={10}
          step={0.5}
          marks={[
            { value: 0.5, label: '0.5x' },
            { value: 1, label: '1x' },
            { value: 5, label: '5x' },
            { value: 10, label: '10x' }
          ]}
          valueLabelDisplay="auto"
          size="small"
        />
      </Box>

      {/* Visualisierungs-Container */}
      <Box 
        sx={{ 
          width: '100%', 
          height, 
          border: '1px solid #e0e0e0',
          borderRadius: 1,
          position: 'relative',
          backgroundColor: '#f9f9f9',
          overflow: 'hidden'
        }}
      >
      {/* Route-Punkte und Verbindungslinien */}
      {coordinates.map((coord, index) => {
        // Verwende Utility-Funktion für Position-Berechnung
        const { xPercent, yPercent } = calculateRoutePosition(coord);
        
        // Berechne Bildgröße basierend auf Zoom und globalem Skalierungsfaktor
        // zoom=1: 120px, zoom=2: 60px, dann multipliziert mit imageScale
        const zoom = coord.zoom || 1;
        const imageSize = (baseImageSize / zoom) * imageScale;
        
        return (
          <Box key={index}>
            {/* Bild mit radialem Gradienten hinter dem Koordinatenpunkt */}
            {coord.image && (
              <Box
                sx={{
                  position: 'absolute',
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  transform: 'translate(-50%, -50%)',
                  width: imageSize,
                  height: imageSize,
                  zIndex: 0,
                  pointerEvents: 'none',
                  borderRadius: '50%',
                  overflow: 'hidden'
                }}
              >
                <img
                  src={coord.image}
                  alt={`Waypoint ${index + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block'
                  }}
                />
              </Box>
            )}
            
            {/* Verbindungslinie zum nächsten Punkt */}
            {index < coordinates.length - 1 && (() => {
              const nextCoord = coordinates[index + 1];
              const { xPercent: nextXPercent, yPercent: nextYPercent } = calculateRoutePosition(nextCoord);
              
              return (
                <svg
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 1,
                    pointerEvents: 'none'
                  }}
                >
                  <line
                    x1={`${xPercent}%`}
                    y1={`${yPercent}%`}
                    x2={`${nextXPercent}%`}
                    y2={`${nextYPercent}%`}
                    stroke="#1976d2"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                  />
                </svg>
              );
            })()}
            
            {/* Verbindungslinie vom letzten zum ersten Punkt */}
            {index === coordinates.length - 1 && coordinates.length > 2 && (() => {
              const firstCoord = coordinates[0];
              const { xPercent: firstXPercent, yPercent: firstYPercent } = calculateRoutePosition(firstCoord);
              
              return (
                <svg
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 1,
                    pointerEvents: 'none'
                  }}
                >
                  <defs>
                    <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" style={{ stopColor: '#1976d2', stopOpacity: 1 }} />
                      <stop offset="100%" style={{ stopColor: '#1976d2', stopOpacity: 0.1 }} />
                    </linearGradient>
                  </defs>
                  <line
                    x1={`${xPercent}%`}
                    y1={`${yPercent}%`}
                    x2={`${firstXPercent}%`}
                    y2={`${firstYPercent}%`}
                    stroke="url(#routeGradient)"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                  />
                </svg>
              );
            })()}
            
            {/* Route-Punkt */}
            <Box
              sx={{
                position: 'absolute',
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                transform: 'translate(-50%, -50%)',
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: index === 0 ? '#4caf50' : '#1976d2',
                border: '2px solid white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                color: 'white',
                zIndex: 2,
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
            >
              {index + 1}
            </Box>
            
          </Box>
        );
      })}
      
      {/* Achsen-Labels */}
      {showLabels && (
        <>
          <Typography 
            variant="caption" 
            sx={{ 
              position: 'absolute', 
              left: 10, 
              top: 10, 
              color: '#666' 
            }}
          >
            Start
          </Typography>
          <Typography 
            variant="caption" 
            sx={{ 
              position: 'absolute', 
              right: 10, 
              bottom: 10, 
              color: '#666',
              fontWeight: 'bold'
            }}
          >
            {coordinates.length} Punkte
          </Typography>
        </>
      )}
      </Box>
    </Box>
  );
};

export default RouteVisualization;

