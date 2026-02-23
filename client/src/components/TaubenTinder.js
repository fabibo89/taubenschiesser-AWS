import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  CardContent,
  CircularProgress,
  Chip,
  IconButton,
  Paper,
  Alert
} from '@mui/material';
import {
  Favorite as FavoriteIcon,
  Close as CloseIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';

const TaubenTinder = () => {
  const [detections, setDetections] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swiping, setSwiping] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [renderedImageSize, setRenderedImageSize] = useState({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  const [flyAwayDirection, setFlyAwayDirection] = useState(null);
  const [loadingNext, setLoadingNext] = useState(false);

  const cardRef = useRef(null);
  const touchStartRef = useRef(null);
  const mouseStartRef = useRef(null);
  const imageRef = useRef(null);
  const containerRef = useRef(null);
  const actionPromiseRef = useRef(null);
  const FLY_AWAY_DURATION_MS = 350;

  useEffect(() => {
    fetchUnclassifiedDetections();
  }, []);

  // Reset rendered image size when detection changes
  useEffect(() => {
    setRenderedImageSize({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  }, [currentIndex]);

  // Recalculate image size on window resize
  useEffect(() => {
    const handleResize = () => {
      if (imageRef.current && containerRef.current && detections.length > 0 && currentIndex < detections.length) {
        const currentDet = detections[currentIndex];
        const imgInfo = currentDet.zoomed_image?.url 
          ? currentDet.image_info?.zoomed_size 
          : currentDet.image_info?.original_size;
        
        if (!imgInfo) return;
        
        const img = imageRef.current;
        const container = containerRef.current;
        
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const imgNaturalWidth = imgInfo.width || img.naturalWidth;
        const imgNaturalHeight = imgInfo.height || img.naturalHeight;
        
        const containerAspect = containerWidth / containerHeight;
        const imageAspect = imgNaturalWidth / imgNaturalHeight;
        
        let renderedWidth, renderedHeight, offsetX, offsetY;
        
        if (imageAspect > containerAspect) {
          renderedWidth = containerWidth;
          renderedHeight = containerWidth / imageAspect;
          offsetX = 0;
          offsetY = (containerHeight - renderedHeight) / 2;
        } else {
          renderedWidth = containerHeight * imageAspect;
          renderedHeight = containerHeight;
          offsetX = (containerWidth - renderedWidth) / 2;
          offsetY = 0;
        }
        
        setRenderedImageSize({ width: renderedWidth, height: renderedHeight, offsetX, offsetY });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [detections, currentIndex]);

  const fetchUnclassifiedDetections = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/cv/detections/unclassified?limit=50');
      setDetections(response.data.detections);
      setCurrentIndex(0);
    } catch (error) {
      console.error('Error fetching detections:', error);
      toast.error('Fehler beim Laden der Erkennungen');
    } finally {
      setLoading(false);
    }
  };

  /** Only performs API call + toast. Does not advance index. Returns promise. */
  const performSwipeAction = async (action) => {
    if (detections.length === 0 || currentIndex >= detections.length) return;

    const detection = detections[currentIndex];

    if (action === 'delete') {
      await axios.delete(`/api/cv/detections/${detection._id}`);
      toast.success('Erkennung gelöscht');
    } else {
      const actionMap = {
        'confirm_pigeon': 'confirm_pigeon',
        'no_pigeon': 'no_pigeon'
      };
      await axios.patch(`/api/cv/detections/${detection._id}/classify`, {
        action: actionMap[action]
      });
      toast.success(
        action === 'confirm_pigeon'
          ? 'Als Taube bestätigt'
          : 'Keine Taube'
      );
    }
  };

  const advanceToNext = async () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= detections.length) {
      await fetchUnclassifiedDetections();
    } else {
      setCurrentIndex(nextIndex);
    }
  };

  const handleSwipeAction = async (action) => {
    if (detections.length === 0 || currentIndex >= detections.length) return;
    try {
      await performSwipeAction(action);
      await advanceToNext();
    } catch (error) {
      console.error('Error processing swipe action:', error);
      toast.error('Fehler beim Verarbeiten der Aktion');
    }
  };

  const getFlyAwayTarget = (direction) => {
    const el = cardRef.current;
    const w = el?.clientWidth ?? 600;
    const h = el?.clientHeight ?? 600;
    const margin = 80;
    if (direction === 'right') return { x: w + margin, y: 0 };
    if (direction === 'left') return { x: -(w + margin), y: 0 };
    if (direction === 'up') return { x: 0, y: -(h + margin) };
    return { x: 0, y: 0 };
  };

  const handleFlyAwayComplete = () => {
    setLoadingNext(true);
    setOffset({ x: 0, y: 0 });
    setFlyAwayDirection(null);
    setSwipeDirection(null);
    const promise = actionPromiseRef.current;
    if (promise) {
      promise
        .then(() => advanceToNext())
        .catch((err) => {
          console.error('Error processing swipe action:', err);
          toast.error('Fehler beim Verarbeiten der Aktion');
        })
        .finally(() => setLoadingNext(false));
      actionPromiseRef.current = null;
    } else {
      setLoadingNext(false);
    }
  };

  // Touch handlers for mobile swipe
  const handleTouchStart = (e) => {
    if (flyAwayDirection || loadingNext) return;
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
  };

  const handleTouchMove = (e) => {
    if (!touchStartRef.current || flyAwayDirection || loadingNext) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    
    setSwiping(true);
    setOffset({ x: deltaX, y: deltaY });
    
    // Determine swipe direction
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      setSwipeDirection(deltaX > 0 ? 'right' : 'left');
    } else if (deltaY < -50) {
      setSwipeDirection('up');
    } else {
      setSwipeDirection(null);
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchStartRef.current || flyAwayDirection || loadingNext) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;

    const threshold = 100;
    const velocityThreshold = 0.3;
    const velocity = Math.sqrt(deltaX ** 2 + deltaY ** 2) / deltaTime;

    setSwiping(false);

    const committed = velocity > velocityThreshold || Math.abs(deltaX) > threshold || deltaY < -threshold;
    let action = null;
    if (committed) {
      if (deltaY < -threshold) action = 'delete';
      else if (deltaX > threshold) action = 'confirm_pigeon';
      else if (deltaX < -threshold) action = 'no_pigeon';
    }

    if (committed && action) {
      const direction = action === 'delete' ? 'up' : action === 'confirm_pigeon' ? 'right' : 'left';
      setFlyAwayDirection(direction);
      setSwipeDirection(direction);
      setOffset(getFlyAwayTarget(direction));
      actionPromiseRef.current = performSwipeAction(action);
    } else {
      setOffset({ x: 0, y: 0 });
      setSwipeDirection(null);
    }
    touchStartRef.current = null;
  };

  // Mouse handlers for desktop (optional)
  const handleMouseDown = (e) => {
    if (flyAwayDirection || loadingNext) return;
    mouseStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now()
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!mouseStartRef.current || flyAwayDirection || loadingNext) return;

    const deltaX = e.clientX - mouseStartRef.current.x;
    const deltaY = e.clientY - mouseStartRef.current.y;

    if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
      setSwiping(true);
      setOffset({ x: deltaX, y: deltaY });

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        setSwipeDirection(deltaX > 0 ? 'right' : 'left');
      } else if (deltaY < -50) {
        setSwipeDirection('up');
      }
    }
  };

  const handleMouseUp = (e) => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    if (!mouseStartRef.current || flyAwayDirection || loadingNext) {
      mouseStartRef.current = null;
      return;
    }

    const deltaX = e.clientX - mouseStartRef.current.x;
    const deltaY = e.clientY - mouseStartRef.current.y;
    const threshold = 100;

    setSwiping(false);

    const committed = Math.abs(deltaX) > threshold || deltaY < -threshold;
    let action = null;
    if (committed) {
      if (deltaY < -threshold) action = 'delete';
      else if (deltaX > threshold) action = 'confirm_pigeon';
      else if (deltaX < -threshold) action = 'no_pigeon';
    }

    if (committed && action) {
      const direction = action === 'delete' ? 'up' : action === 'confirm_pigeon' ? 'right' : 'left';
      setFlyAwayDirection(direction);
      setSwipeDirection(direction);
      setOffset(getFlyAwayTarget(direction));
      actionPromiseRef.current = performSwipeAction(action);
    } else {
      setOffset({ x: 0, y: 0 });
      setSwipeDirection(null);
    }
    mouseStartRef.current = null;
  };

  const getRotation = () => {
    if (!swipeDirection && !flyAwayDirection) return 0;
    const rot = offset.x / 10;
    return Math.max(-30, Math.min(30, rot));
  };

  const getOpacity = () => {
    if (flyAwayDirection) return 1;
    if (!swiping) return 1;
    const dist = Math.sqrt(offset.x ** 2 + offset.y ** 2);
    return Math.max(0.3, 1 - dist / 500);
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  if (detections.length === 0 || currentIndex >= detections.length) {
    return (
      <Box>
        <Typography variant="h4" gutterBottom>
          Tauben-Tinder
        </Typography>
        <Alert severity="info" sx={{ mb: 3 }}>
          Keine unklassifizierten Erkennungen vorhanden. Alle Erkennungen wurden bereits klassifiziert!
        </Alert>
      </Box>
    );
  }

  const currentDetection = detections[currentIndex];
  const displayImage = currentDetection.zoomed_image?.url || currentDetection.image?.url;
  const imageInfo = currentDetection.zoomed_image?.url 
    ? currentDetection.image_info?.zoomed_size 
    : currentDetection.image_info?.original_size;

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Tauben-Tinder
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 2 }}>
        {currentIndex + 1} / {detections.length} - Rechts: Taube ✓ | Links: Keine Taube ✗ | Hoch: Löschen ✗
      </Typography>

      <Box
        sx={{
          position: 'relative',
          maxWidth: '600px',
          margin: '0 auto',
          height: { xs: '70vh', sm: '600px' },
          touchAction: 'none',
          userSelect: 'none'
        }}
      >
        {loadingNext && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
              borderRadius: 3
            }}
          >
            <CircularProgress sx={{ color: 'white' }} size={56} />
          </Box>
        )}
        <Paper
          ref={cardRef}
          elevation={8}
          sx={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            borderRadius: 3,
            overflow: 'hidden',
            transform: `translate(${offset.x}px, ${offset.y}px) rotate(${getRotation()}deg)`,
            opacity: getOpacity(),
            transition: swiping && !flyAwayDirection ? 'none' : `transform ${FLY_AWAY_DURATION_MS}ms ease-out, opacity ${FLY_AWAY_DURATION_MS}ms ease-out`,
            cursor: flyAwayDirection || loadingNext ? 'default' : 'grab',
            pointerEvents: loadingNext ? 'none' : 'auto',
            '&:active': {
              cursor: flyAwayDirection || loadingNext ? 'default' : 'grabbing'
            },
            backgroundColor: '#000'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'transform' && flyAwayDirection) {
              handleFlyAwayComplete();
            }
          }}
        >
          {/* Image with bounding boxes */}
          {displayImage && (
            <Box
              ref={containerRef}
              sx={{
                position: 'relative',
                width: '100%',
                height: '70%',
                backgroundColor: '#000',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Box
                ref={imageRef}
                component="img"
                src={displayImage}
                alt="Detection"
                onLoad={(e) => {
                  const img = e.target;
                  const container = containerRef.current;
                  if (!container || !imageInfo) return;
                  
                  const containerWidth = container.clientWidth;
                  const containerHeight = container.clientHeight;
                  const imgNaturalWidth = imageInfo.width || img.naturalWidth;
                  const imgNaturalHeight = imageInfo.height || img.naturalHeight;
                  
                  // Calculate actual rendered size with objectFit: contain
                  const containerAspect = containerWidth / containerHeight;
                  const imageAspect = imgNaturalWidth / imgNaturalHeight;
                  
                  let renderedWidth, renderedHeight, offsetX, offsetY;
                  
                  if (imageAspect > containerAspect) {
                    // Image is wider - fit to width
                    renderedWidth = containerWidth;
                    renderedHeight = containerWidth / imageAspect;
                    offsetX = 0;
                    offsetY = (containerHeight - renderedHeight) / 2;
                  } else {
                    // Image is taller - fit to height
                    renderedWidth = containerHeight * imageAspect;
                    renderedHeight = containerHeight;
                    offsetX = (containerWidth - renderedWidth) / 2;
                    offsetY = 0;
                  }
                  
                  setRenderedImageSize({ width: renderedWidth, height: renderedHeight, offsetX, offsetY });
                }}
                sx={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />
              
              {/* Draw bounding boxes */}
              {imageInfo && renderedImageSize.width > 0 && currentDetection.detections?.map((detection, index) => {
                if (!detection.bbox && !detection.position) return null;
                
                const imgWidth = imageInfo.width || 1;
                const imgHeight = imageInfo.height || 1;
                
                let bboxLeft, bboxTop, bboxWidth, bboxHeight;
                
                if (currentDetection.zoomed_image?.url && detection.position) {
                  const { center_x, center_y, width, height } = detection.position;
                  bboxLeft = center_x - width / 2;
                  bboxTop = center_y - height / 2;
                  bboxWidth = width;
                  bboxHeight = height;
                } else if (detection.bbox) {
                  const { x, y, width, height } = detection.bbox;
                  bboxLeft = x;
                  bboxTop = y;
                  bboxWidth = width;
                  bboxHeight = height;
                } else {
                  return null;
                }
                
                // Convert from image coordinates to rendered coordinates
                const scaleX = renderedImageSize.width / imgWidth;
                const scaleY = renderedImageSize.height / imgHeight;
                
                const leftPx = bboxLeft * scaleX + renderedImageSize.offsetX;
                const topPx = bboxTop * scaleY + renderedImageSize.offsetY;
                const widthPx = bboxWidth * scaleX;
                const heightPx = bboxHeight * scaleY;
                
                return (
                  <Box
                    key={index}
                    sx={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      width: `${widthPx}px`,
                      height: `${heightPx}px`,
                      border: '3px solid #ff1744',
                      boxShadow: '0 0 0 2px rgba(255, 23, 68, 0.5)',
                      pointerEvents: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                );
              })}
            </Box>
          )}

          {/* Detection Info */}
          <CardContent sx={{ height: '30%', overflow: 'auto', backgroundColor: '#fff' }}>
            <Typography variant="h6" gutterBottom>
              Erkennung #{currentIndex + 1}
            </Typography>
            
            <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
              <Chip
                label={`Gerät: ${currentDetection.device?.name || 'Unbekannt'}`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={`${new Date(currentDetection.processedAt).toLocaleString()}`}
                size="small"
                variant="outlined"
              />
              <Chip
                label={`${currentDetection.detections?.length || 0} Objekte`}
                size="small"
                variant="outlined"
                color="primary"
              />
            </Box>

            <Typography variant="subtitle2" gutterBottom>
              Erkannte Objekte:
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {currentDetection.detections?.map((detection, index) => (
                <Chip
                  key={index}
                  label={`${detection.class} (${(detection.confidence * 100).toFixed(1)}%)`}
                  size="small"
                  color="primary"
                />
              ))}
            </Box>

            {currentDetection.processingTime && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                Verarbeitungszeit: {currentDetection.processingTime.toFixed(0)}ms
              </Typography>
            )}
          </CardContent>

          {/* Swipe direction indicator (while dragging or flying away) */}
          {(swiping || flyAwayDirection) && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 10,
                pointerEvents: 'none'
              }}
            >
              {(swipeDirection || flyAwayDirection) === 'right' && (
                <FavoriteIcon sx={{ fontSize: 80, color: '#4caf50', opacity: 0.8 }} />
              )}
              {(swipeDirection || flyAwayDirection) === 'left' && (
                <CloseIcon sx={{ fontSize: 80, color: '#ff9800', opacity: 0.8 }} />
              )}
              {(swipeDirection || flyAwayDirection) === 'up' && (
                <DeleteIcon sx={{ fontSize: 80, color: '#f44336', opacity: 0.8 }} />
              )}
            </Box>
          )}
        </Paper>

        {/* Action Buttons (fallback for desktop) */}
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            justifyContent: 'center',
            gap: 2,
            mt: 4
          }}
        >
          <IconButton
            size="large"
            color="warning"
            disabled={loadingNext}
            onClick={() => handleSwipeAction('no_pigeon')}
            sx={{ width: 64, height: 64 }}
            title="Keine Taube (Links swipen)"
          >
            <CloseIcon fontSize="large" />
          </IconButton>
          <IconButton
            size="large"
            color="error"
            disabled={loadingNext}
            onClick={() => handleSwipeAction('delete')}
            sx={{ width: 64, height: 64 }}
            title="Löschen (Hoch swipen)"
          >
            <DeleteIcon fontSize="large" />
          </IconButton>
          <IconButton
            size="large"
            color="success"
            disabled={loadingNext}
            onClick={() => handleSwipeAction('confirm_pigeon')}
            sx={{ width: 64, height: 64 }}
            title="Taube bestätigen (Rechts swipen)"
          >
            <FavoriteIcon fontSize="large" />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

export default TaubenTinder;
