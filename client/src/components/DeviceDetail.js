import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Paper,
  Divider,
  Slider
} from '@mui/material';
import {
  CheckCircle as OnlineIcon,
  Error as OfflineIcon,
  Warning as WarningIcon,
  Camera as CameraIcon,
  Visibility as DetectionIcon,
  Route as RouteIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PhotoCamera as PhotoCameraIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useSocket } from '../contexts/SocketContext';
import { 
  validateCoordinate,
  sortCoordinatesByOrder,
  createNewCoordinate,
  updateCoordinateOrder,
  removeCoordinate,
  addCoordinate,
  updateCoordinate
} from '../utils/routeUtils';
import RouteVisualization from './RouteVisualization';

// API URL with fallback for development proxy
// Use empty string for relative URLs (works with proxy in package.json)
const API_URL = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) || '';

const DeviceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socket, joinDeviceRoom, leaveDeviceRoom } = useSocket();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  const [detections, setDetections] = useState([]);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [actionsConfig, setActionsConfig] = useState({
    mode: 'impulse',
    route: { coordinates: [] }
  });
  const [newCoordinate, setNewCoordinate] = useState({
    rotation: 0,
    tilt: 0,
    order: 0,
    zoom: 1
  });
  const [editingIndex, setEditingIndex] = useState(null);
  const [updatingImages, setUpdatingImages] = useState(new Set());

  useEffect(() => {
    fetchDevice();
    return () => {
      if (socket) {
        leaveDeviceRoom(id);
      }
    };
  }, [id]);

  useEffect(() => {
    if (socket && device) {
      joinDeviceRoom(device._id);
      
      socket.on('device-update', (updatedDevice) => {
        if (updatedDevice._id === device._id) {
          setDevice(updatedDevice);
        }
      });
      
      socket.on('new-detection', (detection) => {
        if (detection.device._id === device._id) {
          setDetections(prev => [detection, ...prev.slice(0, 9)]);
        }
      });
    }
  }, [socket, device]);

  const fetchDevice = async () => {
    try {
      const response = await axios.get(`/api/devices/${id}`);
      setDevice(response.data);
      // Lade auch die Route-Konfiguration
      await fetchActionsConfig();
    } catch (error) {
      console.error('Error fetching device:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetections = async () => {
    try {
      const response = await axios.get(`/api/devices/${id}/detections?limit=10`);
      setDetections(response.data.detections);
    } catch (error) {
      console.error('Error fetching detections:', error);
    }
  };

  const fetchActionsConfig = async () => {
    try {
      const response = await axios.get(`/api/devices/${id}/actions`);
      setActionsConfig(response.data);
    } catch (error) {
      console.error('Error fetching actions config:', error);
    }
  };

  const handleRouteDialogOpen = () => {
    fetchActionsConfig();
    setRouteDialogOpen(true);
  };

  const handleRouteDialogClose = () => {
    setRouteDialogOpen(false);
    setNewCoordinate({
      rotation: 0,
      tilt: 0,
      order: 0,
      zoom: 1
    });
  };

  const handleModeChange = (event) => {
    setActionsConfig(prev => ({
      ...prev,
      mode: event.target.value
    }));
  };

  const handleAddCoordinate = () => {
    const updatedCoordinates = [...actionsConfig.route.coordinates, {
      ...newCoordinate,
      order: actionsConfig.route.coordinates.length
    }];
    
    setActionsConfig(prev => ({
      ...prev,
      route: {
        ...prev.route,
        coordinates: updatedCoordinates
      }
    }));
    
    setNewCoordinate({
      rotation: 0,
      tilt: 0,
      order: 0,
      zoom: 1
    });
  };

  const handleRemoveCoordinate = (index) => {
    const updatedCoordinates = actionsConfig.route.coordinates.filter((_, i) => i !== index);
    setActionsConfig(prev => ({
      ...prev,
      route: {
        ...prev.route,
        coordinates: updatedCoordinates
      }
    }));
  };

  const handleEditCoordinate = (index) => {
    const coordinate = actionsConfig.route.coordinates[index];
    setNewCoordinate({
      rotation: coordinate.rotation,
      tilt: coordinate.tilt,
      zoom: coordinate.zoom || 1,
      order: coordinate.order
    });
    setEditingIndex(index);
  };

  const handleUpdateCoordinate = () => {
    if (editingIndex !== null) {
      const updatedCoordinates = [...actionsConfig.route.coordinates];
      updatedCoordinates[editingIndex] = {
        ...newCoordinate,
        order: editingIndex
      };
      
      setActionsConfig(prev => ({
        ...prev,
        route: {
          ...prev.route,
          coordinates: updatedCoordinates
        }
      }));
      
      setEditingIndex(null);
      setNewCoordinate({
        rotation: 0,
        tilt: 0,
        order: 0,
        zoom: 1
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setNewCoordinate({
      rotation: 0,
      tilt: 0,
      order: 0,
      zoom: 1
    });
  };

  // Placeholder functions for image functionality (to be implemented later)
  const handleUpdateImage = async (index) => {
    console.log('🔧 handleUpdateImage called with index:', index);
    console.log('🔧 API_URL:', API_URL);
    console.log('🔧 Device ID:', id);
    console.log('🔧 Token exists:', !!localStorage.getItem('token'));
    
    setUpdatingImages(prev => new Set(prev).add(index));
    
    try {
      console.log(`Updating image for coordinate ${index}`);
      
      // Call API to update route image
      const url = `${API_URL}/api/devices/${id}/update-route-image/${index}`;
      console.log('Calling API:', url);
      console.log('Full URL would be:', window.location.origin + url);
      
      const response = await axios.post(
        url,
        {},
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      );
      
      console.log('✅ Response received:', response.data);
      
      if (response.data && response.data.image) {
        // Update the coordinate with new image
        const updatedCoordinates = [...actionsConfig.route.coordinates];
        updatedCoordinates[index] = {
          ...updatedCoordinates[index],
          image: response.data.image
        };
        
        setActionsConfig(prev => ({
          ...prev,
          route: {
            ...prev.route,
            coordinates: updatedCoordinates
          }
        }));
        
        console.log(`✅ Image updated successfully for coordinate ${index}`);
        alert('Bild erfolgreich aktualisiert!');
      }
    } catch (error) {
      console.error('❌ Error updating image:', error);
      console.error('❌ Error response:', error.response?.data);
      console.error('❌ Error status:', error.response?.status);
      alert(`Fehler beim Aktualisieren des Bildes: ${error.response?.data?.message || error.response?.data?.error || error.message}`);
    } finally {
      setUpdatingImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(index);
        return newSet;
      });
    }
  };

  const handleUpdateAllImages = async () => {
    const allIndices = actionsConfig.route.coordinates.map((_, index) => index);
    setUpdatingImages(new Set(allIndices));
    
    console.log('Updating all images');
    
    try {
      // Update images sequentially to avoid overloading the system
      for (const index of allIndices) {
        await handleUpdateImage(index);
      }
      
      console.log('All images updated successfully');
    } catch (error) {
      console.error('Error updating all images:', error);
      alert(`Fehler beim Aktualisieren aller Bilder: ${error.message}`);
    } finally {
      setUpdatingImages(new Set());
    }
  };


  const handleSaveActionsConfig = async () => {
    try {
      console.log('Saving actions config:', actionsConfig);
      const response = await axios.put(`/api/devices/${id}/actions`, actionsConfig);
      console.log('Save response:', response.data);
      handleRouteDialogClose();
    } catch (error) {
      console.error('Error saving actions config:', error);
      console.error('Error response:', error.response?.data);
      
      // Show detailed error message
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          'Fehler beim Speichern der Route-Konfiguration';
      alert(`Fehler: ${errorMessage}`);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'online':
        return <OnlineIcon color="success" />;
      case 'offline':
        return <OfflineIcon color="error" />;
      case 'maintenance':
        return <WarningIcon color="warning" />;
      default:
        return <OfflineIcon color="disabled" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'online':
        return 'success';
      case 'offline':
        return 'error';
      case 'maintenance':
        return 'warning';
      default:
        return 'default';
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!device) {
    return (
      <Alert severity="error">
        Gerät nicht gefunden
      </Alert>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          {device.name}
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="contained"
            startIcon={<RouteIcon />}
            onClick={handleRouteDialogOpen}
          >
            Route bearbeiten
          </Button>
          <Button
            variant="outlined"
            onClick={() => navigate('/devices')}
          >
            Zurück zu Geräten
          </Button>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Device Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Geräteinformationen
              </Typography>
              <Box display="flex" alignItems="center" mb={2}>
                {getStatusIcon(device.status)}
                <Typography sx={{ ml: 1 }}>
                  Status: <Chip label={device.status} color={getStatusColor(device.status)} />
                </Typography>
              </Box>
              <Typography variant="body2" color="textSecondary">
                <strong>Geräte-ID:</strong> {device.deviceId}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                <strong>Typ:</strong> {device.type}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                <strong>Letztes Signal:</strong> {new Date(device.lastSeen).toLocaleString()}
              </Typography>
              {device.location?.name && (
                <Typography variant="body2" color="textSecondary">
                  <strong>Standort:</strong> {device.location.name}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Camera Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Kamera
              </Typography>
              {device.camera ? (
                <Box>
                  <Typography variant="body2" color="textSecondary">
                    <strong>Typ:</strong> {device.camera.type || 'Nicht spezifiziert'}
                  </Typography>
                  {device.camera.rtspUrl && (
                    <Typography variant="body2" color="textSecondary">
                      <strong>RTSP URL:</strong> {device.camera.rtspUrl}
                    </Typography>
                  )}
                  {device.camera.directUrl && (
                    <Typography variant="body2" color="textSecondary">
                      <strong>Direct URL:</strong> {device.camera.directUrl}
                    </Typography>
                  )}
                  {device.camera.tapo?.ip && (
                    <Typography variant="body2" color="textSecondary">
                      <strong>Tapo IP:</strong> {device.camera.tapo.ip}
                    </Typography>
                  )}
                  <Typography variant="body2" color="textSecondary">
                    <strong>Streaming:</strong> {device.camera.isStreaming ? 'Aktiv' : 'Inaktiv'}
                  </Typography>
                  {device.camera.lastImage && (
                    <Typography variant="body2" color="textSecondary">
                      <strong>Letztes Bild:</strong> {new Date(device.camera.lastImage).toLocaleString()}
                    </Typography>
                  )}
                </Box>
              ) : (
                <Typography color="textSecondary">
                  Keine Kamera konfiguriert
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>


        {/* Recent Detections */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Letzte Erkennungen
              </Typography>
              {detections.length > 0 ? (
                <List>
                  {detections.map((detection, index) => (
                    <ListItem key={index}>
                      <ListItemIcon>
                        <DetectionIcon />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${detection.detections?.length || 0} Objekte erkannt`}
                        secondary={new Date(detection.processedAt).toLocaleString()}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography color="textSecondary">
                  Keine Erkennungen verfügbar
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Route Visualization */}
        {actionsConfig.route.coordinates.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Route-Visualisierung
                </Typography>
                <RouteVisualization coordinates={actionsConfig.route.coordinates} />
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Route Bearbeitungs Dialog */}
      <Dialog 
        open={routeDialogOpen} 
        onClose={handleRouteDialogClose}
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
                onChange={handleModeChange}
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
                        max={3}
                        step={0.1}
                        marks={[
                          { value: 1, label: '1x' },
                          { value: 2, label: '2x' },
                          { value: 3, label: '3x' }
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
                        onClick={editingIndex !== null ? handleUpdateCoordinate : handleAddCoordinate}
                        sx={{ flex: 1 }}
                      >
                        {editingIndex !== null ? 'Aktualisieren' : 'Hinzufügen'}
                      </Button>
                      {editingIndex !== null && (
                        <Button
                          variant="outlined"
                          onClick={handleCancelEdit}
                          sx={{ flex: 1 }}
                        >
                          Abbrechen
                        </Button>
                      )}
                    </Box>
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
                      onClick={handleUpdateAllImages}
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
                        
                        if (draggedIndex !== dropIndex) {
                          const newCoordinates = [...actionsConfig.route.coordinates];
                          const draggedItem = newCoordinates[draggedIndex];
                          newCoordinates.splice(draggedIndex, 1);
                          newCoordinates.splice(dropIndex, 0, draggedItem);
                          
                          // Update order values
                          const updatedCoordinates = newCoordinates.map((coord, idx) => ({
                            ...coord,
                            order: idx
                          }));
                          
                          setActionsConfig(prev => ({
                            ...prev,
                            route: {
                              ...prev.route,
                              coordinates: updatedCoordinates
                            }
                          }));
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
                              onClick={() => handleUpdateImage(index)}
                              disabled={updatingImages.has(index)}
                              size="small"
                              fullWidth
                            >
                              Bild aktualisieren
                            </Button>
                            <Box display="flex" gap={1}>
                              <IconButton
                                size="small"
                                onClick={() => handleEditCoordinate(index)}
                                color="primary"
                                title="Bearbeiten"
                              >
                                <EditIcon />
                              </IconButton>
                              <IconButton
                                size="small"
                                onClick={() => handleRemoveCoordinate(index)}
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
          <Button onClick={handleRouteDialogClose}>
            Abbrechen
          </Button>
          <Button 
            onClick={handleSaveActionsConfig}
            variant="contained"
          >
            Speichern
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DeviceDetail;
