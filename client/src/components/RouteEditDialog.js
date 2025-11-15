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
  CircularProgress
} from '@mui/material';
import {
  Route as RouteIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PhotoCamera as PhotoCameraIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import RouteVisualization from './RouteVisualization';
import RoutePreview from './RoutePreview';

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
  maxZoom = 3 // Standard ist 3, kann überschrieben werden
}) => {
  const handleCoordinateImageUpdate = (index) => {
    onUpdateImage(index);
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

