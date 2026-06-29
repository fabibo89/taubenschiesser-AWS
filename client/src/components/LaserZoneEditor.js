import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  FormControlLabel,
  Checkbox,
  Alert,
  Divider
} from '@mui/material';
import {
  DEFAULT_POLYGON_POINTS,
  normalizeLaserZone,
  getZoomCropRect,
  updatePointAtIndex,
  insertPointOnEdge,
  removePointAtIndex,
  buildLaserZonePayload,
  hitTestVertexIndex,
  hitTestEdge,
  MIN_POLYGON_POINTS,
  MAX_POLYGON_POINTS
} from '../utils/laserZone';

const HANDLE_SIZE = 12;
const SELECTED_HANDLE_SIZE = 14;
const VERTEX_HIT_PX = 20;
const EDGE_HIT_PX = 14;

const LaserZoneEditor = ({
  open,
  onClose,
  image,
  zoom = 1,
  laserZone,
  audioEnabled: audioEnabledProp = false,
  routePointIndex,
  onSave
}) => {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);
  const [laserEnabled, setLaserEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [points, setPoints] = useState(DEFAULT_POLYGON_POINTS.map((p) => ({ ...p })));
  const [layout, setLayout] = useState({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 });
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const dragRef = useRef(null);

  const getCanvasBounds = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    return bounds;
  }, []);

  const clientToNormRaw = useCallback((clientX, clientY) => {
    const bounds = getCanvasBounds();
    if (!bounds) return null;
    return {
      x: (clientX - bounds.left) / bounds.width,
      y: (clientY - bounds.top) / bounds.height
    };
  }, [getCanvasBounds]);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingIndex(null);
    const canvas = canvasRef.current;
    if (canvas && drag?.pointerId != null && canvas.hasPointerCapture(drag.pointerId)) {
      try {
        canvas.releasePointerCapture(drag.pointerId);
      } catch {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeLaserZone(laserZone);
    if (normalized) {
      setLaserEnabled(normalized.laserEnabled);
      setPoints(normalized.points.map((p) => ({ ...p })));
    } else {
      setLaserEnabled(true);
      setPoints(DEFAULT_POLYGON_POINTS.map((p) => ({ ...p })));
    }
    setSelectedIndex(null);
    setAudioEnabled(
      audioEnabledProp === true || laserZone?.audioEnabled === true
    );
  }, [open, laserZone, audioEnabledProp]);

  const measureLayout = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.complete || img.naturalWidth === 0) return;

    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    const aspect = naturalWidth / naturalHeight;
    const containerWidth = container.clientWidth;
    let width = containerWidth;
    let height = width / aspect;
    const maxHeight = 480;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspect;
    }

    setLayout({ width, height, naturalWidth, naturalHeight });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(measureLayout, 50);
    window.addEventListener('resize', measureLayout);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measureLayout);
    };
  }, [open, image, measureLayout]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || layout.width === 0) return;

    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toPx = (normX, normY) => ({
      x: normX * canvas.width,
      y: normY * canvas.height
    });

    const addPolygonPath = () => {
      points.forEach((point, index) => {
        const p = toPx(point.x, point.y);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    };

    if (laserEnabled) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      addPolygonPath();
      ctx.fill('evenodd');

      ctx.beginPath();
      addPolygonPath();
      ctx.fillStyle = 'rgba(76, 175, 80, 0.25)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(76, 175, 80, 0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();

      points.forEach((point, index) => {
        const p = toPx(point.x, point.y);
        const isSelected = index === selectedIndex || index === draggingIndex;
        const size = isSelected ? SELECTED_HANDLE_SIZE : HANDLE_SIZE;
        const half = size / 2;
        ctx.fillStyle = isSelected ? '#c8e6c9' : '#fff';
        ctx.strokeStyle = isSelected ? '#1b5e20' : 'rgba(76, 175, 80, 1)';
        ctx.lineWidth = isSelected ? 2.5 : 2;
        ctx.fillRect(p.x - half, p.y - half, size, size);
        ctx.strokeRect(p.x - half, p.y - half, size, size);
      });
    }

    const crop = getZoomCropRect(zoom);
    const c0 = toPx(crop.x, crop.y);
    const cw = crop.width * canvas.width;
    const ch = crop.height * canvas.height;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255, 152, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(c0.x, c0.y, cw, ch);
    ctx.restore();
  }, [laserEnabled, points, layout, zoom, selectedIndex, draggingIndex]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointIndex == null) return;
      const norm = clientToNormRaw(event.clientX, event.clientY);
      if (!norm) return;
      setPoints((prev) => updatePointAtIndex(prev, drag.pointIndex, norm.x, norm.y));
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [clientToNormRaw, endDrag]);

  const handlePointerDown = (event) => {
    if (!laserEnabled) return;
    const bounds = getCanvasBounds();
    if (!bounds) return;

    const vertexIndex = hitTestVertexIndex(points, bounds, event.clientX, event.clientY, VERTEX_HIT_PX);
    if (vertexIndex >= 0) {
      if (event.button === 2) {
        event.preventDefault();
        setPoints((prev) => removePointAtIndex(prev, vertexIndex));
        setSelectedIndex(null);
        return;
      }
      dragRef.current = { pointIndex: vertexIndex, pointerId: event.pointerId };
      setDraggingIndex(vertexIndex);
      setSelectedIndex(vertexIndex);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button === 0) {
      const edge = hitTestEdge(points, bounds, event.clientX, event.clientY, EDGE_HIT_PX);
      if (edge && points.length < MAX_POLYGON_POINTS) {
        setPoints((prev) => insertPointOnEdge(prev, edge.edgeIndex, edge.x, edge.y));
        setSelectedIndex(edge.edgeIndex + 1);
        event.preventDefault();
      }
    }
  };

  const handleContextMenu = (event) => {
    event.preventDefault();
  };

  const handleRemoveSelectedPoint = () => {
    if (selectedIndex == null) return;
    setPoints((prev) => removePointAtIndex(prev, selectedIndex));
    setSelectedIndex(null);
  };

  const handleSave = () => {
    const zone = buildLaserZonePayload(laserEnabled, points);
    if (!zone && !audioEnabled) {
      onSave({ laserZone: null, audioEnabled: false });
      return;
    }
    onSave({ laserZone: zone, audioEnabled });
  };

  const handleClearAll = () => {
    setLaserEnabled(false);
    setAudioEnabled(false);
    setSelectedIndex(null);
    onSave({ laserZone: null, audioEnabled: false });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Routenpunkt {routePointIndex != null ? `#${routePointIndex + 1}` : ''}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Punkte ziehen · Kante anklicken = Punkt hinzufügen · Rechtsklick auf Punkt = entfernen (min. {MIN_POLYGON_POINTS}).
        </Typography>
        {!image && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Bitte zuerst ein Route-Bild für diesen Punkt aufnehmen.
          </Alert>
        )}
        {image && (
          <Box
            ref={containerRef}
            sx={{
              position: 'relative',
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              maxHeight: 480,
              userSelect: 'none'
            }}
          >
            <Box sx={{ position: 'relative', width: layout.width || '100%', height: layout.height || 'auto' }}>
              <Box
                ref={imgRef}
                component="img"
                src={image}
                alt="Route snapshot"
                onLoad={measureLayout}
                sx={{
                  width: layout.width || '100%',
                  height: layout.height || 'auto',
                  display: 'block',
                  borderRadius: 1
                }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: layout.width || '100%',
                  height: layout.height || '100%',
                  cursor: draggingIndex != null ? 'grabbing' : (laserEnabled ? 'crosshair' : 'default'),
                  touchAction: 'none'
                }}
                onPointerDown={handlePointerDown}
                onContextMenu={handleContextMenu}
              />
            </Box>
          </Box>
        )}

        {laserEnabled && (
          <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {points.length} Punkte (max. {MAX_POLYGON_POINTS})
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={handleRemoveSelectedPoint}
              disabled={selectedIndex == null || points.length <= MIN_POLYGON_POINTS}
            >
              Punkt entfernen
            </Button>
          </Box>
        )}

        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
          <FormControlLabel
            sx={{ alignItems: 'flex-start', mr: 0 }}
            control={
              <Checkbox
                checked={laserEnabled}
                onChange={(e) => setLaserEnabled(e.target.checked)}
                sx={{ pt: 0.25 }}
              />
            }
            label="Laser-Zone aktiv (außerhalb kein Laser beim Schuss)"
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <FormControlLabel
          sx={{ alignItems: 'flex-start', mr: 0 }}
          control={
            <Checkbox
              checked={audioEnabled}
              onChange={(e) => setAudioEnabled(e.target.checked)}
              sx={{ pt: 0.25 }}
            />
          }
          label="Audio aktiv (Schuss mit Audio für dieses Bild / diesen Routenpunkt)"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClearAll} color="warning" disabled={!image}>
          Alles entfernen
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Abbrechen</Button>
        <Button onClick={handleSave} variant="contained" disabled={!image}>
          Übernehmen
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LaserZoneEditor;
