import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Paper,
  Slider,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  CheckCircle as OnlineIcon,
  Error as OfflineIcon,
  Warning as WarningIcon,
  Route as RouteIcon,
  PhotoCamera as PhotoCameraIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { DataGrid } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-toastify';
import { 
  calculateRoutePosition, 
  calculateConnectionLine, 
  validateCoordinate,
  sortCoordinatesByOrder,
  createNewCoordinate,
  updateCoordinateOrder,
  removeCoordinate,
  addCoordinate,
  updateCoordinate
} from '../utils/routeUtils';

// API URL with fallback for development proxy
// Use empty string for relative URLs (works with proxy in package.json)
const API_URL = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) || '';

const Devices = () => {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingDevice, setEditingDevice] = useState(null);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [routeDeviceId, setRouteDeviceId] = useState(null);
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
  const [formData, setFormData] = useState({
    name: '',
    location: { name: '', coordinates: { lat: 0, lng: 0 } },
    taubenschiesser: { ip: '' },
    camera: { 
      type: 'tapo',
      directUrl: '',
      rtspUrl: '',
      tapo: { ip: '', username: '', password: '', stream: 'stream1' },
      useLocalImage: false,
      localImagePath: ''
    }
  });
  const navigate = useNavigate();

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    try {
      const response = await axios.get('/api/devices');
      setDevices(response.data);
    } catch (error) {
      toast.error('Fehler beim Laden der Geräte');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (device = null) => {
    if (device) {
      setEditingDevice(device);
      setFormData({
        name: device.name,
        location: device.location || { name: '', coordinates: { lat: 0, lng: 0 } },
        taubenschiesser: device.taubenschiesser || { ip: '' },
        camera: device.camera || { 
          type: 'tapo',
          directUrl: '',
          rtspUrl: '',
          tapo: { ip: '', username: '', password: '', stream: 'stream1' },
          useLocalImage: false,
          localImagePath: ''
        }
      });
    } else {
      setEditingDevice(null);
      setFormData({
        name: '',
        location: { name: '', coordinates: { lat: 0, lng: 0 } },
        taubenschiesser: { ip: '' },
        camera: { 
          type: 'tapo',
          directUrl: '',
          rtspUrl: '',
          tapo: { ip: '', username: '', password: '', stream: 'stream1' },
          useLocalImage: false,
          localImagePath: ''
        }
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingDevice(null);
  };

  const fetchActionsConfig = async (deviceId) => {
    try {
      const response = await axios.get(`/api/devices/${deviceId}/actions`);
      setActionsConfig(response.data);
    } catch (error) {
      console.error('Error fetching actions config:', error);
    }
  };

  const handleRouteDialogOpen = (deviceId) => {
    setRouteDeviceId(deviceId);
    fetchActionsConfig(deviceId);
    setRouteDialogOpen(true);
  };

  const handleRouteDialogClose = () => {
    setRouteDialogOpen(false);
    setRouteDeviceId(null);
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
    console.log('🔧 Device ID:', routeDeviceId);
    console.log('🔧 Token exists:', !!localStorage.getItem('token'));
    
    setUpdatingImages(prev => new Set(prev).add(index));
    
    try {
      console.log(`Updating image for coordinate ${index}`);
      
      // Call API to update route image
      const url = `${API_URL}/api/devices/${routeDeviceId}/update-route-image/${index}`;
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
    
    // TODO: Implement actual bulk image capture functionality
    console.log('Updating all images');
    
    // Simulate API call
    setTimeout(() => {
      setUpdatingImages(new Set());
    }, 3000);
  };

  const handleSaveActionsConfig = async () => {
    try {
      console.log('Saving actions config:', actionsConfig);
      const response = await axios.put(`/api/devices/${routeDeviceId}/actions`, actionsConfig);
      console.log('Save response:', response.data);
      handleRouteDialogClose();
      toast.success('Route-Konfiguration gespeichert');
    } catch (error) {
      console.error('Error saving actions config:', error);
      console.error('Error response:', error.response?.data);
      
      // Show detailed error message
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          'Fehler beim Speichern der Route-Konfiguration';
      toast.error(`Fehler: ${errorMessage}`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingDevice) {
        await axios.put(`/api/devices/${editingDevice._id}`, formData);
        toast.success('Gerät erfolgreich aktualisiert');
      } else {
        await axios.post('/api/devices', formData);
        toast.success('Gerät erfolgreich erstellt');
      }
      fetchDevices();
      handleCloseDialog();
    } catch (error) {
      toast.error('Fehler beim Speichern des Geräts');
    }
  };

  const handleDelete = async (deviceId) => {
    if (window.confirm('Gerät wirklich löschen?')) {
      try {
        await axios.delete(`/api/devices/${deviceId}`);
        toast.success('Gerät erfolgreich gelöscht');
        fetchDevices();
      } catch (error) {
        toast.error('Fehler beim Löschen des Geräts');
      }
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

  const columns = [
    {
      field: 'name',
      headerName: 'Name',
      width: 200,
      renderCell: (params) => (
        <Box display="flex" alignItems="center">
          {getStatusIcon(params.row.status)}
          <Typography sx={{ ml: 1 }}>{params.value}</Typography>
        </Box>
      )
    },
    {
      field: 'status',
      headerName: 'Gesamt-Status',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={getStatusColor(params.value)}
        />
      )
    },
    {
      field: 'taubenschiesserStatus',
      headerName: 'Taubenschiesser',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={getStatusColor(params.value)}
        />
      )
    },
    {
      field: 'cameraStatus',
      headerName: 'Kamera',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          color={getStatusColor(params.value)}
        />
      )
    },
    {
      field: 'lastSeen',
      headerName: 'Letztes Signal',
      width: 180,
      renderCell: (params) => (
        <Typography variant="body2">
          {new Date(params.value).toLocaleString()}
        </Typography>
      )
    },
    {
      field: 'actions',
      headerName: 'Aktionen',
      width: 250,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <IconButton
            size="small"
            onClick={() => navigate(`/devices/${params.row._id}`)}
            title="Gerät anzeigen"
          >
            <ViewIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleRouteDialogOpen(params.row._id)}
            title="Route bearbeiten"
          >
            <RouteIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleOpenDialog(params.row)}
            title="Gerät bearbeiten"
          >
            <EditIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleDelete(params.row._id)}
            color="error"
            title="Gerät löschen"
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      )
    }
  ];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          Geräte
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Neues Gerät
        </Button>
      </Box>

      <Card>
        <CardContent>
          <DataGrid
            rows={devices}
            columns={columns}
            loading={loading}
            getRowId={(row) => row._id}
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: {
                paginationModel: { pageSize: 10 }
              }
            }}
            disableRowSelectionOnClick
          />
        </CardContent>
      </Card>

      {/* Add/Edit Device Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingDevice ? 'Gerät bearbeiten' : 'Neues Gerät'}
        </DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <TextField
              autoFocus
              margin="dense"
              label="Name"
              fullWidth
              variant="outlined"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <TextField
              margin="dense"
              label="Standort"
              fullWidth
              variant="outlined"
              value={formData.location.name}
              onChange={(e) => setFormData({
                ...formData,
                location: { ...formData.location, name: e.target.value }
              })}
            />
            {/* Taubenschiesser Configuration */}
            <TextField
              margin="dense"
              label="Taubenschiesser IP"
              fullWidth
              variant="outlined"
              value={formData.taubenschiesser.ip}
              onChange={(e) => setFormData({
                ...formData,
                taubenschiesser: { ...formData.taubenschiesser, ip: e.target.value }
              })}
              placeholder="192.168.1.100"
              required
            />

            {/* Camera Configuration */}
            <FormControl fullWidth margin="dense">
              <InputLabel>Kamera-Typ</InputLabel>
              <Select
                value={formData.camera.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  const updatedCamera = { 
                    ...formData.camera, 
                    type: newType,
                    // Set useLocalImage based on type (keep path for easy switching)
                    useLocalImage: newType === 'local'
                  };
                  setFormData({
                    ...formData,
                    camera: updatedCamera
                  });
                }}
                label="Kamera-Typ"
              >
                <MenuItem value="direct">Direkter RTSP-Link</MenuItem>
                <MenuItem value="tapo">Tapo Kamera</MenuItem>
                <MenuItem value="local">Lokales Bild (Test)</MenuItem>
              </Select>
            </FormControl>

            {/* Tapo Camera Configuration */}
            {formData.camera.type === 'tapo' && (
              <>
                <TextField
                  margin="dense"
                  label="Kamera IP"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.tapo.ip}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { ...formData.camera.tapo, ip: e.target.value }
                    }
                  })}
                  placeholder="192.168.1.101"
                />
                <TextField
                  margin="dense"
                  label="Benutzername"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.tapo.username}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { ...formData.camera.tapo, username: e.target.value }
                    }
                  })}
                />
                <TextField
                  margin="dense"
                  label="Passwort"
                  fullWidth
                  variant="outlined"
                  type="text"
                  value={formData.camera.tapo.password}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: {
                      ...formData.camera,
                      tapo: { ...formData.camera.tapo, password: e.target.value }
                    }
                  })}
                  helperText="Passwort ist sichtbar für Bearbeitung"
                />
                <FormControl fullWidth margin="dense">
                  <InputLabel>Stream</InputLabel>
                  <Select
                    value={formData.camera.tapo.stream}
                    onChange={(e) => setFormData({
                      ...formData,
                      camera: {
                        ...formData.camera,
                        tapo: { ...formData.camera.tapo, stream: e.target.value }
                      }
                    })}
                    label="Stream"
                  >
                    <MenuItem value="stream1">Stream 1 (1920x1080, 30fps)</MenuItem>
                    <MenuItem value="stream2">Stream 2 (640x480, 30fps)</MenuItem>
                  </Select>
                </FormControl>
              </>
            )}

            {/* Direct RTSP URL */}
            {formData.camera.type === 'direct' && (
              <TextField
                margin="dense"
                label="RTSP URL"
                fullWidth
                variant="outlined"
                value={formData.camera.directUrl}
                onChange={(e) => setFormData({
                  ...formData,
                  camera: { ...formData.camera, directUrl: e.target.value }
                })}
                placeholder="rtsp://user:pass@ip:port/stream"
              />
            )}

            {/* Local Image Configuration */}
            {formData.camera.type === 'local' && (
              <>
                <TextField
                  margin="dense"
                  label="Pfad zum Bild"
                  fullWidth
                  variant="outlined"
                  value={formData.camera.localImagePath || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    camera: { 
                      ...formData.camera, 
                      useLocalImage: true,
                      localImagePath: e.target.value 
                    }
                  })}
                  placeholder="/Users/name/Documents/test.jpg oder images/bird.jpg"
                  helperText="Absoluter Pfad oder relativ zum Arbeitsordner"
                />
              </>
            )}

            {/* Legacy RTSP URL for backward compatibility */}
            <TextField
              margin="dense"
              label="Legacy RTSP URL (für Rückwärtskompatibilität)"
              fullWidth
              variant="outlined"
              value={formData.camera.rtspUrl}
              onChange={(e) => setFormData({
                ...formData,
                camera: { ...formData.camera, rtspUrl: e.target.value }
              })}
              placeholder="rtsp://user:pass@ip:port/stream"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Abbrechen</Button>
            <Button type="submit" variant="contained">
              {editingDevice ? 'Aktualisieren' : 'Erstellen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

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
                        max={2}
                        step={0.1}
                        marks={[
                          { value: 1, label: '1x' },
                          { value: 1.5, label: '1.5x' },
                          { value: 2, label: '2x' }
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
                  <Box 
                    sx={{ 
                      width: '100%', 
                      height: 300, 
                      border: '1px solid #e0e0e0',
                      borderRadius: 1,
                      position: 'relative',
                      backgroundColor: '#f9f9f9',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Route-Punkte und Verbindungslinien */}
                    {actionsConfig.route.coordinates.map((coord, index) => {
                      // Verwende Utility-Funktion für Position-Berechnung
                      const { xPercent, yPercent } = calculateRoutePosition(coord);
                      
                      return (
                        <Box key={index}>
                          {/* Verbindungslinie zum nächsten Punkt */}
                          {index < actionsConfig.route.coordinates.length - 1 && (() => {
                            const nextCoord = actionsConfig.route.coordinates[index + 1];
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
                          {index === actionsConfig.route.coordinates.length - 1 && actionsConfig.route.coordinates.length > 2 && (() => {
                            const firstCoord = actionsConfig.route.coordinates[0];
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
                        color: '#666' 
                      }}
                    >
                      {actionsConfig.route.coordinates.length} Punkte
                    </Typography>
                  </Box>
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
                                  objectFit: 'cover',
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

export default Devices;
