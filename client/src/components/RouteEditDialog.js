import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Paper,
  Grid,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  IconButton,
  CircularProgress,
  Collapse,
  Alert,
  AlertTitle,
  Checkbox,
  FormControlLabel,
  Chip
} from '@mui/material';
import {
  Route as RouteIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PhotoCamera as PhotoCameraIcon,
  Refresh as RefreshIcon,
  Panorama as PanoramaIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Download as DownloadIcon
} from '@mui/icons-material';
import RouteVisualization from './RouteVisualization';
import RoutePreview from './RoutePreview';

/**
 * Komponente für Panorama mit Canvas-Overlay für Rahmen
 */
const PanoramaWithBorders = ({ panoramaImage, transformationMatrices, imageSizes, showBorders }) => {
  const canvasRef = React.useRef(null);
  const imgRef = React.useRef(null);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    if (!panoramaImage || !showBorders || !transformationMatrices || transformationMatrices.length === 0) {
      // Lösche Canvas wenn keine Rahmen angezeigt werden sollen
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
      return;
    }

    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const drawBorders = () => {
      if (!img.complete || img.naturalWidth === 0) return;

      // Canvas auf Panorama-Größe setzen (natürliche Größe für präzise Koordinaten)
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      // CSS-Größe wird durch das Container-Layout bestimmt
      const container = containerRef.current;
      if (container) {
        const containerWidth = container.offsetWidth;
        const scale = containerWidth / img.naturalWidth;
        const scaledHeight = img.naturalHeight * scale;
        canvas.style.width = `${containerWidth}px`;
        canvas.style.height = `${scaledHeight}px`;
      }

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Farben für verschiedene Bilder
      const colors = [
        '#FF0000', // Rot
        '#00FF00', // Grün
        '#0000FF', // Blau
        '#FFFF00', // Cyan
        '#FF00FF', // Magenta
        '#00FFFF', // Gelb
        '#800080', // Lila
        '#FFA500', // Orange
      ];

      // Zeichne Rahmen für jedes Bild
      transformationMatrices.forEach((matrix, i) => {
        if (!imageSizes || !imageSizes[i]) return;

        const { width: w_img, height: h_img } = imageSizes[i];

        // Anzahl der Punkte pro Kante (mehr = glattere Kurven, zeigt Verzerrung besser)
        // Mehr Punkte zeigen die perspektivische Verzerrung besser
        const pointsPerEdge = 50;

        // Generiere Punkte entlang der 4 Kanten des Originalbildes
        const edgePoints = [];

        // Obere Kante (von links nach rechts)
        for (let j = 0; j <= pointsPerEdge; j++) {
          const x = (w_img / pointsPerEdge) * j;
          edgePoints.push([x, 0]);
        }

        // Rechte Kante (von oben nach unten)
        for (let j = 1; j <= pointsPerEdge; j++) {
          const y = (h_img / pointsPerEdge) * j;
          edgePoints.push([w_img, y]);
        }

        // Untere Kante (von rechts nach links)
        for (let j = pointsPerEdge - 1; j >= 0; j--) {
          const x = (w_img / pointsPerEdge) * j;
          edgePoints.push([x, h_img]);
        }

        // Linke Kante (von unten nach oben)
        for (let j = pointsPerEdge - 1; j > 0; j--) {
          const y = (h_img / pointsPerEdge) * j;
          edgePoints.push([0, y]);
        }

        // Transformiere alle Punkte mit Homographie-Matrix
        const transformedPoints = edgePoints.map(([x, y]) => {
          const x_t = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2];
          const y_t = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2];
          const w = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
          return [x_t / w, y_t / w];
        });

        // Zeichne Rahmen mit allen transformierten Punkten (zeigt Verzerrung)
        // LineWidth muss größer sein, da Canvas per CSS skaliert wird
        // Canvas hat natürliche Größe, wird aber visuell kleiner dargestellt
        ctx.strokeStyle = colors[i % colors.length];
        ctx.lineWidth = 10; // Größere Linienbreite für bessere Sichtbarkeit
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(transformedPoints[0][0], transformedPoints[0][1]);
        for (let j = 1; j < transformedPoints.length; j++) {
          ctx.lineTo(transformedPoints[j][0], transformedPoints[j][1]);
        }
        ctx.closePath();
        ctx.stroke();

        // Zeichne Bildnummer (Zentrum aus allen transformierten Punkten)
        const centerX = transformedPoints.reduce((sum, [x]) => sum + x, 0) / transformedPoints.length;
        const centerY = transformedPoints.reduce((sum, [, y]) => sum + y, 0) / transformedPoints.length;
        ctx.fillStyle = colors[i % colors.length];
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`#${i + 1}`, centerX, centerY);
      });
    };

    if (img.complete) {
      drawBorders();
    } else {
      img.onload = drawBorders;
    }

    // Resize-Handler für Container-Größenänderungen
    const handleResize = () => {
      if (showBorders && img.complete) {
        drawBorders();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [panoramaImage, showBorders, transformationMatrices, imageSizes]);

  if (!panoramaImage) return null;

  return (
    <Box 
      ref={containerRef}
      sx={{ 
        position: 'relative', 
        width: '100%',
        borderRadius: 4,
        overflow: 'hidden'
      }}
    >
      <img
        ref={imgRef}
        src={panoramaImage}
        alt="Panorama"
        style={{
          width: '100%',
          borderRadius: 4,
          maxHeight: '600px',
          objectFit: 'contain',
          display: 'block'
        }}
      />
      {showBorders && transformationMatrices && transformationMatrices.length > 0 && (
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            borderRadius: 4
          }}
        />
      )}
    </Box>
  );
};

/**
 * Gemeinsame Komponente für den Route-Bearbeitungs-Dialog
 * Wird von Devices.js und DeviceDetail.js verwendet
 */
const RouteEditDialog = ({
  open,
  onClose,
  onSave,
  actionsConfig,
  newCoordinate,
  setNewCoordinate,
  editingIndex,
  updatingImages,
  previewImage,
  previewLoading,
  previewError,
  onModeChange,
  onAddCoordinate,
  onUpdateCoordinate,
  onCancelEdit,
  onRemoveCoordinate,
  onEditCoordinate,
  onUpdateImage,
  onUpdateAllImages,
  onPreviewCoordinate,
  onCoordinateSubmit,
  onReorderCoordinates,
  maxZoom = 3, // Standard ist 3, kann überschrieben werden
  stitchingInProgress = false,
  stitchingError = null,
  panoramaImage = null,
  panoramaStatistics = null,
  panoramaTransformationMatrices = null,
  panoramaImageSizes = null,
  onStitchPanorama = null,
  onSavePanorama = null
}) => {
  const [panoramaExpanded, setPanoramaExpanded] = React.useState(false);
  const [showBorders, setShowBorders] = React.useState(false);
  
  const handleCoordinateImageUpdate = (index) => {
    onUpdateImage(index);
  };

  const [savingPanorama, setSavingPanorama] = React.useState(false);

  const handleSavePanorama = async () => {
    if (!panoramaImage || !onSavePanorama) return;

    setSavingPanorama(true);
    try {
      const result = await onSavePanorama();
      if (result.success) {
        // Erfolg - könnte hier eine Toast-Nachricht anzeigen
        console.log(result.message);
      } else {
        // Fehler - könnte hier eine Fehlermeldung anzeigen
        console.error(result.message);
      }
    } catch (error) {
      console.error('Fehler beim Speichern:', error);
    } finally {
      setSavingPanorama(false);
    }
  };

  const handlePreviewCoordinateRequest = () => {
    onPreviewCoordinate();
  };

  const handleCoordinateSubmit = () => {
    if (editingIndex !== null) {
      onUpdateCoordinate();
    } else {
      onAddCoordinate();
    }
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <RouteIcon />
          Route bearbeiten
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 4, pb: 2 }}>
        <Box mb={5}>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel id="mode-select-label" sx={{ fontSize: '1rem' }}>Modus</InputLabel>
            <Select
              labelId="mode-select-label"
              value={actionsConfig.mode}
              onChange={onModeChange}
              label="Modus"
              sx={{ minHeight: '56px' }}
            >
              <MenuItem value="impulse">Impuls</MenuItem>
              <MenuItem value="route">Route</MenuItem>
            </Select>
          </FormControl>
        </Box>

        {actionsConfig.mode === 'route' && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Winkel-Koordinaten
            </Typography>
            
            {/* Neue Koordinate hinzufügen */}
            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                {editingIndex !== null ? `Koordinate #${editingIndex + 1} bearbeiten` : 'Neue Koordinate hinzufügen'}
              </Typography>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} sm={2.5}>
                  <TextField
                    fullWidth
                    label="Rotation (°)"
                    type="number"
                    value={newCoordinate.rotation}
                    onChange={(e) => setNewCoordinate(prev => ({ ...prev, rotation: parseInt(e.target.value) || 0 }))}
                    inputProps={{ min: 0, max: 360 }}
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={2.5}>
                  <TextField
                    fullWidth
                    label="Kippung (°)"
                    type="number"
                    value={newCoordinate.tilt}
                    onChange={(e) => setNewCoordinate(prev => ({ ...prev, tilt: parseInt(e.target.value) || 0 }))}
                    inputProps={{ min: -180, max: 180 }}
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={2.5}>
                  <Box>
                    <Typography variant="body2" gutterBottom>
                      Zoom: {newCoordinate.zoom}x
                    </Typography>
                    <Slider
                      value={newCoordinate.zoom}
                      onChange={(e, value) => setNewCoordinate(prev => ({ ...prev, zoom: value }))}
                      min={1}
                      max={maxZoom}
                      step={0.1}
                      marks={[
                        { value: 1, label: '1x' },
                        ...(maxZoom >= 2 ? [{ value: maxZoom === 2 ? 1.5 : 2, label: maxZoom === 2 ? '1.5x' : '2x' }] : []),
                        { value: maxZoom, label: `${maxZoom}x` }
                      ]}
                      size="small"
                    />
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4.5}>
                  <Box display="flex" gap={1}>
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={handleCoordinateSubmit}
                      sx={{ flex: 1 }}
                    >
                      {editingIndex !== null ? 'Aktualisieren' : 'Hinzufügen'}
                    </Button>
                    {editingIndex !== null && (
                      <Button
                        variant="outlined"
                        onClick={onCancelEdit}
                        sx={{ flex: 1 }}
                      >
                        Abbrechen
                      </Button>
                    )}
                  </Box>
                </Grid>
                <Grid item xs={12}>
                  <Button
                    variant="outlined"
                    startIcon={<PhotoCameraIcon />}
                    onClick={handlePreviewCoordinateRequest}
                    disabled={previewLoading}
                    fullWidth
                  >
                    {previewLoading ? 'Vorschau wird geladen…' : 'Vorschau anzeigen'}
                  </Button>
                </Grid>
                <Grid item xs={12}>
                  <RoutePreview
                    previewImage={previewImage}
                    previewLoading={previewLoading}
                    previewError={previewError}
                    zoom={newCoordinate.zoom}
                  />
                </Grid>
              </Grid>
            </Paper>

            {/* Route-Diagramm */}
            {actionsConfig.route.coordinates.length > 0 && (
              <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
                  Route-Visualisierung
                </Typography>
                <RouteVisualization coordinates={actionsConfig.route.coordinates} />
              </Paper>
            )}

            {/* Panorama Stitching Section */}
            {actionsConfig.route.coordinates.length > 0 && (
              <Paper sx={{ p: 3, mb: 3 }}>
                <Box 
                  display="flex" 
                  justifyContent="space-between" 
                  alignItems="center"
                  sx={{ cursor: 'pointer' }}
                  onClick={() => setPanoramaExpanded(!panoramaExpanded)}
                >
                  <Box display="flex" alignItems="center" gap={1}>
                    <PanoramaIcon />
                    <Typography variant="subtitle2">
                      Panorama-Erstellung
                    </Typography>
                  </Box>
                  <IconButton size="small">
                    {panoramaExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  </IconButton>
                </Box>
                
                <Collapse in={panoramaExpanded}>
                  <Box sx={{ mt: 2 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                      <Box>
                        <Typography variant="body2" color="textSecondary">
                          Erstelle ein Panorama aus allen Route-Bildern
                        </Typography>
                        {panoramaStatistics && (
                          <Box display="flex" gap={1} mt={1}>
                            <Chip 
                              label={`${panoramaStatistics.total_used} verwendet`}
                              color="success"
                              size="small"
                            />
                            {panoramaStatistics.total_failed > 0 && (
                              <Chip 
                                label={`${panoramaStatistics.total_failed} fehlgeschlagen`}
                                color="error"
                                size="small"
                              />
                            )}
                          </Box>
                        )}
                      </Box>
                      <Button
                        variant="contained"
                        startIcon={<PanoramaIcon />}
                        onClick={() => onStitchPanorama && onStitchPanorama(showBorders)}
                        disabled={stitchingInProgress || !onStitchPanorama || actionsConfig.route.coordinates.filter(c => c.image).length < 2}
                        size="small"
                      >
                        Panorama erstellen
                      </Button>
                    </Box>
                    
                    {panoramaStatistics && (
                      <Box mb={2}>
                        <Typography variant="caption" color="textSecondary" display="block" gutterBottom>
                          Statistik:
                        </Typography>
                        <Box display="flex" gap={1} flexWrap="wrap">
                          <Chip 
                            label={`${panoramaStatistics.total_requested} angefragt`}
                            size="small"
                            variant="outlined"
                          />
                          <Chip 
                            label={`${panoramaStatistics.total_loaded} geladen`}
                            color="success"
                            size="small"
                            variant="outlined"
                          />
                          {panoramaStatistics.total_failed > 0 && (
                            <Chip 
                              label={`${panoramaStatistics.total_failed} fehlgeschlagen`}
                              color="error"
                              size="small"
                              variant="outlined"
                            />
                          )}
                          <Chip 
                            label={`${panoramaStatistics.total_used} verwendet`}
                            color="primary"
                            size="small"
                          />
                        </Box>
                      </Box>
                    )}
                    
                    {panoramaImage && !stitchingInProgress && (
                      <Box mb={2}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={showBorders}
                              onChange={(e) => {
                                setShowBorders(e.target.checked);
                                // KEIN Neurendern mehr - nur State ändern!
                              }}
                              size="small"
                            />
                          }
                          label="Rahmen der Originalbilder anzeigen"
                        />
                        {panoramaTransformationMatrices && panoramaTransformationMatrices.length > 0 && (
                          <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 1 }}>
                            Transformations-Matrizen verfügbar ({panoramaTransformationMatrices.length} Bilder)
                          </Typography>
                        )}
                      </Box>
                    )}
                    
                    {stitchingInProgress && (
                      <Box textAlign="center" py={3}>
                        <CircularProgress />
                        <Typography variant="body2" sx={{ mt: 2 }}>
                          Panorama wird erstellt...
                        </Typography>
                      </Box>
                    )}
                    
                    {stitchingError && (
                      <Alert severity="error" sx={{ mt: 2 }}>
                        <AlertTitle>Fehler beim Erstellen des Panoramas</AlertTitle>
                        {stitchingError}
                      </Alert>
                    )}
                    
                    {panoramaImage && !stitchingInProgress && (
                      <Box mt={2}>
                        <PanoramaWithBorders
                          panoramaImage={panoramaImage}
                          transformationMatrices={panoramaTransformationMatrices}
                          imageSizes={panoramaImageSizes}
                          showBorders={showBorders}
                        />
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={savingPanorama ? <CircularProgress size={16} /> : <DownloadIcon />}
                          onClick={handleSavePanorama}
                          disabled={savingPanorama || !onSavePanorama}
                          sx={{ mt: 1 }}
                          fullWidth
                        >
                          {savingPanorama ? 'Wird gespeichert...' : 'Panorama speichern'}
                        </Button>
                      </Box>
                    )}
                  </Box>
                </Collapse>
              </Paper>
            )}

            {/* Bestehende Koordinaten */}
            {actionsConfig.route.coordinates.length > 0 && (
              <Box>
                <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2">
                    Konfigurierte Koordinaten ({actionsConfig.route.coordinates.length})
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={onUpdateAllImages}
                    disabled={updatingImages.size > 0}
                    size="small"
                  >
                    Alle Bilder aktualisieren
                  </Button>
                </Box>
                {actionsConfig.route.coordinates.map((coord, index) => (
                  <Paper 
                    key={index} 
                    sx={{ 
                      p: 2, 
                      mb: 1,
                      cursor: 'move',
                      '&:hover': {
                        backgroundColor: 'action.hover'
                      }
                    }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', index.toString());
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'));
                      const dropIndex = index;
                      
                      if (draggedIndex !== dropIndex && onReorderCoordinates) {
                        onReorderCoordinates(draggedIndex, dropIndex);
                      }
                    }}
                  >
                    <Grid container spacing={2} alignItems="center">
                      <Grid item xs={12} md={6}>
                        <Box display="flex" alignItems="center" gap={2}>
                          <Typography variant="body2" fontWeight="bold" color="primary">
                            #{index + 1}
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Rotation: {coord.rotation}°
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Kippung: {coord.tilt}°
                          </Typography>
                          <Typography variant="body2" color="textSecondary">
                            Zoom: {coord.zoom || 1}x
                          </Typography>
                        </Box>
                      </Grid>
                      <Grid item xs={12} md={3}>
                        {/* Bildplatzhalter */}
                        <Box 
                          sx={{ 
                            width: '100%', 
                            height: 120, 
                            border: coord.image ? 'none' : '2px dashed #ccc',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: coord.image ? 'transparent' : '#f5f5f5',
                            borderRadius: 1,
                            overflow: 'hidden'
                          }}
                        >
                          {updatingImages.has(index) ? (
                            <Box textAlign="center">
                              <CircularProgress size={24} />
                              <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                                Bild wird aktualisiert...
                              </Typography>
                            </Box>
                          ) : coord.image ? (
                            <img 
                              src={coord.image} 
                              alt={`Route point ${index + 1}`}
                              style={{ 
                                width: '100%', 
                                height: '100%', 
                                objectFit: 'contain',
                                borderRadius: '4px'
                              }}
                            />
                          ) : (
                            <Box textAlign="center">
                              <PhotoCameraIcon sx={{ fontSize: 32, color: '#ccc' }} />
                              <Typography variant="caption" display="block" sx={{ mt: 1, color: '#666' }}>
                                Kein Bild verfügbar
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <Box display="flex" gap={1} flexDirection="column">
                          <Button
                            variant="outlined"
                            startIcon={<PhotoCameraIcon />}
                            onClick={() => handleCoordinateImageUpdate(index)}
                            disabled={updatingImages.has(index)}
                            size="small"
                            fullWidth
                          >
                            Bild aktualisieren
                          </Button>
                          <Box display="flex" gap={1}>
                            <IconButton
                              size="small"
                              onClick={() => onEditCoordinate(index)}
                              color="primary"
                              title="Bearbeiten"
                            >
                              <EditIcon />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => onRemoveCoordinate(index)}
                              color="error"
                              title="Löschen"
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Box>
                        </Box>
                      </Grid>
                    </Grid>
                  </Paper>
                ))}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          Abbrechen
        </Button>
        <Button 
          onClick={onSave}
          variant="contained"
        >
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RouteEditDialog;

