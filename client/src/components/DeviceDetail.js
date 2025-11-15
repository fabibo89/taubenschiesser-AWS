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
import RouteVisualization from './RouteVisualization';
import RouteEditDialog from './RouteEditDialog';
import { useRouteManagement } from '../hooks/useRouteManagement';

const DeviceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socket, joinDeviceRoom, leaveDeviceRoom } = useSocket();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tabValue, setTabValue] = useState(0);
  const [detections, setDetections] = useState([]);
  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const {
    actionsConfig,
    setActionsConfig,
    newCoordinate,
    setNewCoordinate,
    editingIndex,
    updatingImages,
    handleModeChange,
    handleAddCoordinate,
    handleRemoveCoordinate,
    handleEditCoordinate,
    handleUpdateCoordinate,
    handleCancelEdit,
    handleUpdateImage,
    handleUpdateAllImages,
    fetchActionsConfig,
    saveActionsConfig,
    previewImage,
    previewLoading,
    previewError,
    handlePreviewCoordinate,
    clearPreview
  } = useRouteManagement(id);

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
      await fetchActionsConfig(id);
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

  const handleRouteDialogOpen = async () => {
    const result = await fetchActionsConfig(id);
    if (!result.success && result?.message) {
      alert(`Fehler beim Laden der Route: ${result.message}`);
      return;
    }
    setRouteDialogOpen(true);
  };

  const handleRouteDialogClose = () => {
    setRouteDialogOpen(false);
    handleCancelEdit();
    clearPreview();
  };

  const handleSaveActionsConfig = async () => {
    const result = await saveActionsConfig(id);
    if (result.success) {
      handleRouteDialogClose();
    } else if (result?.message) {
      alert(`Fehler: ${result.message}`);
    }
  };

  const handleCoordinateImageUpdate = async (index) => {
    const result = await handleUpdateImage(index, id);
    if (!result?.success && result?.message) {
      alert(result.message);
    }
  };

  const handleAllImagesUpdate = async () => {
    const result = await handleUpdateAllImages(id);
    if (!result?.success && result?.message) {
      alert(result.message);
    }
  };

  const handleCoordinateSubmit = () => {
    if (editingIndex !== null) {
      handleUpdateCoordinate();
    } else {
      handleAddCoordinate();
    }
    clearPreview();
  };

  const handlePreviewCoordinateRequest = async () => {
    const result = await handlePreviewCoordinate(id, newCoordinate);
    if (!result?.success && result?.message) {
      alert(result.message);
    }
  };

  const handleReorderCoordinates = (draggedIndex, dropIndex) => {
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
      <RouteEditDialog
        open={routeDialogOpen}
        onClose={handleRouteDialogClose}
        onSave={handleSaveActionsConfig}
        actionsConfig={actionsConfig}
        newCoordinate={newCoordinate}
        setNewCoordinate={setNewCoordinate}
        editingIndex={editingIndex}
        updatingImages={updatingImages}
        previewImage={previewImage}
        previewLoading={previewLoading}
        previewError={previewError}
        onModeChange={handleModeChange}
        onAddCoordinate={handleAddCoordinate}
        onUpdateCoordinate={handleUpdateCoordinate}
        onCancelEdit={handleCancelEdit}
        onRemoveCoordinate={handleRemoveCoordinate}
        onEditCoordinate={handleEditCoordinate}
        onUpdateImage={(index) => handleCoordinateImageUpdate(index)}
        onUpdateAllImages={handleAllImagesUpdate}
        onPreviewCoordinate={handlePreviewCoordinateRequest}
        onReorderCoordinates={handleReorderCoordinates}
        maxZoom={3}
      />
    </Box>
  );
};

export default DeviceDetail;
