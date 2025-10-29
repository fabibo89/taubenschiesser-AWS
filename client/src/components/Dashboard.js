import React, { useState, useEffect, useMemo } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Button,
  ButtonGroup,
  Paper,
  Avatar,
  Tooltip,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Devices as DevicesIcon,
  Visibility as VisibilityIcon,
  CheckCircle as OnlineIcon,
  Error as OfflineIcon,
  Warning as WarningIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Stop as StopIcon,
  RotateLeft as RotateLeftIcon,
  RotateRight as RotateRightIcon,
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
  Camera as CameraIcon,
  Settings as SettingsIcon,
  Refresh as RefreshIcon,
  PlayCircleOutline as StartIcon,
  PauseCircleOutline as PauseIcon2
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import axios from 'axios';

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalDevices: 0,
    onlineDevices: 0,
    totalDetections: 0,
    recentDetections: []
  });
  const [devices, setDevices] = useState([]);
  const [devicePositions, setDevicePositions] = useState({}); // { [deviceId]: { rot, tilt } }
  const [deviceStatuses, setDeviceStatuses] = useState({}); // { [deviceId]: { status, message, timestamp } }
  const [loading, setLoading] = useState(true);
  const [streamingDevices, setStreamingDevices] = useState({});
  const navigate = useNavigate();
  const { socket, connected } = useSocket();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  // Subscribe to hardware monitor events for all loaded devices to track live rot/tilt
  useEffect(() => {
    if (!socket || !connected || devices.length === 0) return;

    const roomsJoined = new Set();

    const handleMonitorEvent = (event) => {
      const { deviceId, eventType, data } = event || {};
      if (!deviceId || !data) return;

      // Try to extract rotation/tilt from several possible shapes
      const rot = (data?.position?.rot ?? data?.rot ?? data?.rotation);
      const tilt = (data?.position?.tilt ?? data?.tilt);

      if (typeof rot === 'number' || typeof tilt === 'number') {
        setDevicePositions(prev => ({
          ...prev,
          [deviceId]: {
            rot: typeof rot === 'number' ? rot : (prev[deviceId]?.rot ?? 0),
            tilt: typeof tilt === 'number' ? tilt : (prev[deviceId]?.tilt ?? 0)
          }
        }));
      }

      // Update device status for hardware monitor events
      if (eventType && data?.message) {
        setDeviceStatuses(prev => ({
          ...prev,
          [deviceId]: {
            status: eventType,
            message: data.message,
            timestamp: new Date()
          }
        }));
      }
    };

    // Join all monitor rooms for current devices
    devices.forEach(d => {
      if (d?._id && !roomsJoined.has(d._id)) {
        const monitorRoom = `monitor-${d._id}`;
        socket.emit('join', monitorRoom);
        roomsJoined.add(d._id);
      }
    });

    socket.on('hardware-monitor-event', handleMonitorEvent);

    return () => {
      socket.off('hardware-monitor-event', handleMonitorEvent);
      // Leave rooms
      roomsJoined.forEach(id => {
        const monitorRoom = `monitor-${id}`;
        socket.emit('leave', monitorRoom);
      });
    };
  }, [socket, connected, devices]);

  const fetchDashboardData = async () => {
    try {
      const [devicesResponse, detectionsResponse] = await Promise.all([
        axios.get('/api/devices'),
        axios.get('/api/cv/detections?limit=5')
      ]);

      const devicesData = devicesResponse.data;
      const detections = detectionsResponse.data.detections || [];

      // Ensure monitorStatus is set for all devices
      const devicesWithStatus = devicesData.map(device => ({
        ...device,
        monitorStatus: device.monitorStatus || 'paused'
      }));

      setDevices(devicesWithStatus);
      setStats({
        totalDevices: devicesWithStatus.length,
        onlineDevices: devicesWithStatus.filter(d => d.status === 'online').length,
        totalDetections: detections.length,
        recentDetections: detections.slice(0, 5)
      });
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Socket-Events für Echtzeit-Updates
  useEffect(() => {
    if (socket && connected) {
      socket.on('device-update', (device) => {
        setDevices(prevDevices => 
          prevDevices.map(d => d._id === device._id ? device : d)
        );
      });

      // Sofortige Status-Änderungen
      socket.on('device-status-change', (statusChange) => {
        console.log('Device status changed:', statusChange);
        
        // Visuelles Feedback für Status-Änderung
        const device = devices.find(d => d._id === statusChange.deviceId);
        if (device) {
          const componentName = statusChange.component === 'taubenschiesser' ? 'Taubenschiesser' : 'Kamera';
          const statusText = statusChange.status === 'online' ? 'online' : 'offline';
          console.log(`🔄 ${device.name}: ${componentName} ist jetzt ${statusText}`);
        }
        
        setDevices(prevDevices => 
          prevDevices.map(d => {
            if (d._id === statusChange.deviceId) {
              const updated = { ...d };
              if (statusChange.component === 'taubenschiesser') {
                updated.taubenschiesserStatus = statusChange.status;
              } else if (statusChange.component === 'camera') {
                updated.cameraStatus = statusChange.status;
              }
              // Recalculate overall status
              updated.status = calculateOverallStatus(updated.taubenschiesserStatus, updated.cameraStatus);
              return updated;
            }
            return d;
          })
        );
      });

      return () => {
        socket.off('device-update');
        socket.off('device-status-change');
      };
    }
  }, [socket, connected]);

  // Helper function to calculate overall status
  const calculateOverallStatus = (taubenschiesserStatus, cameraStatus) => {
    if (taubenschiesserStatus === 'online' && cameraStatus === 'online') return 'online';
    if (taubenschiesserStatus === 'online' || cameraStatus === 'online') return 'maintenance';
    return 'offline';
  };

  // Geräte-Steuerung
  const handleDeviceControl = async (deviceId, action) => {
    try {
      if (action === 'refresh') {
        // Status aktualisieren
        const response = await axios.post(`/api/device-control/${deviceId}/refresh`);
        console.log(`Refreshing device ${deviceId}:`, response.data);
        
        // Erfolgsmeldung anzeigen
        if (response.data.success) {
          console.log('Device status updated successfully');
        }
        return;
      }

      if (action === 'start') {
        // Geräte-Überwachung starten
        const response = await axios.post(`/api/device-control/${deviceId}/start`);
        console.log(`Starting device monitoring ${deviceId}:`, response.data);
        
        if (response.data.success) {
          console.log('Device monitoring started');
          // Update device status in state
          setDevices(prevDevices => 
            prevDevices.map(d => 
              d._id === deviceId 
                ? { ...d, monitorStatus: 'running' }
                : d
            )
          );
        }
        return;
      }

      if (action === 'pause') {
        // Geräte-Überwachung pausieren
        const response = await axios.post(`/api/device-control/${deviceId}/pause`);
        console.log(`Pausing device monitoring ${deviceId}:`, response.data);
        
        if (response.data.success) {
          console.log('Device monitoring paused');
          // Update device status in state
          setDevices(prevDevices => 
            prevDevices.map(d => 
              d._id === deviceId 
                ? { ...d, monitorStatus: 'paused' }
                : d
            )
          );
        }
        return;
      }


      // MQTT-Befehl senden
      const response = await axios.post(`/api/device-control/${deviceId}/control`, {
        action
      });

      console.log(`Command '${action}' sent to device ${deviceId}:`, response.data);
      
      // Erfolgsmeldung anzeigen (optional)
      // toast.success(`Befehl '${action}' gesendet`);
      
    } catch (error) {
      console.error('Error controlling device:', error);
      
      // Spezifische Fehlermeldungen
      if (error.response?.data?.error) {
        console.error('Server error:', error.response.data.error);
        if (error.response.data.details) {
          console.error('Details:', error.response.data.details);
        }
        
        // MQTT-spezifische Fehlermeldungen
        if (error.response.data.error.includes('MQTT')) {
          console.error('MQTT connection issue. Check MQTT settings in Profile → Settings');
        }
      } else {
        console.error('Network error:', error.message);
      }
      
      // toast.error(`Fehler beim Senden des Befehls: ${error.response?.data?.error || error.message}`);
    }
  };

  // RTSP-Stream starten/stoppen (nur Frontend-Toggle, keine Server-Konvertierung)
  const toggleStream = async (deviceId) => {
    try {
      const isStreaming = streamingDevices[deviceId];
      
      // Direkter Frontend-Toggle - keine Server-Konvertierung nötig
      setStreamingDevices(prev => ({ ...prev, [deviceId]: !isStreaming }));
      
      console.log(`RTSP Stream ${!isStreaming ? 'gestartet' : 'gestoppt'} für Gerät ${deviceId} (direkt im Browser)`);
      
    } catch (error) {
      console.error('Error toggling RTSP stream:', error);
    }
  };

  // RTSP-Stream-Status ist immer verfügbar (keine Server-Abfrage nötig)
  // const getStreamStatus = async (deviceId) => {
  //   // Nicht mehr nötig - RTSP-Streams sind direkt verfügbar
  //   return { active: streamingDevices[deviceId] };
  // };

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
      // Hardware Monitor Status Colors
      case 'device_waiting':
        return 'info';
      case 'device_moving':
        return 'warning';
      case 'device_stopped':
      case 'device_stabilizing':
        return 'success';
      case 'device_busy':
        return 'warning';
      case 'analysis_started':
      case 'analyzing':
      case 'analyzing_cv':
      case 'capturing':
        return 'primary';
      case 'cv_analysis_complete':
      case 'birds_detected':
        return 'success';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  // Geräte-Komponente
  const DeviceCard = ({ device }) => {
    const [streamUrl, setStreamUrl] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [currentImage, setCurrentImage] = useState(null);
    const isStreaming = streamingDevices[device._id];
    const position = devicePositions[device._id] || { rot: 0, tilt: 0 };
    const deviceStatus = deviceStatuses[device._id];

    // Normalize helpers for bar fill (rot assumed 0-360, tilt assumed -90..90; clamp as safety)
    const normalized = useMemo(() => {
      const rot = Math.max(0, Math.min(360, Number(position.rot) || 0));
      const tiltVal = Math.max(-90, Math.min(90, Number(position.tilt) || 0));
      const rotPct = rot / 360; // 0..1
      const tiltPct = (tiltVal + 90) / 180; // -90..90 -> 0..1
      return { rotPct, tiltPct, rot, tilt: tiltVal };
    }, [position]);
    
  // Einfache Bild-Updates mit automatischer Aktualisierung
  useEffect(() => {
    if (isStreaming && device) {
      // Einfache Bild-URL verwenden (kein Video-Stream)
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
      const imageUrl = `${API_URL}/api/device-image/${device._id}`;
      
      console.log(`Setting image URL for device ${device._id}:`, imageUrl);
      setStreamUrl(imageUrl);
      setCurrentImage(imageUrl);
      
      // Automatische Aktualisierung alle 3 Sekunden
      const interval = setInterval(() => {
        if (isStreaming && !isLoading) {
          // URL mit Timestamp für Cache-Busting
          const timestamp = Date.now();
          const updatedUrl = `${imageUrl}?t=${timestamp}`;
          console.log(`Updating image for device ${device._id}:`, updatedUrl);
          setIsLoading(true);
          setStreamUrl(updatedUrl);
          
          // Loading-Indikator für mindestens 500ms anzeigen
          setTimeout(() => {
            setIsLoading(false);
          }, 500);
        }
      }, 3000);
      
      return () => clearInterval(interval);
    } else {
      setStreamUrl(null);
    }
  }, [isStreaming, device]);

    return (
      <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <CardContent sx={{ flexGrow: 1 }}>
          {/* Geräte-Header */}
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center">
              <Avatar 
                sx={{ 
                  bgcolor: getStatusColor(device.status) + '.main', 
                  mr: 1,
                  width: 48,
                  height: 48
                }}
              >
                <img 
                  src="/images/icon.png" 
                  alt="Taubenschiesser" 
                  style={{ 
                    width: '36px', 
                    height: '36px',
                    objectFit: 'contain',
                    filter: 'brightness(0) invert(1)',
                    opacity: 0.95
                  }}
                />
              </Avatar>
              <Box>
                <Typography variant="h6">{device.name}</Typography>
                <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                  <Tooltip title={`Taubenschiesser: ${device.taubenschiesserStatus || 'offline'}`}>
                    <Chip 
                      icon={<DevicesIcon />}
                      label={device.taubenschiesserStatus || 'offline'}
                      size="small"
                      color={getStatusColor(device.taubenschiesserStatus)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </Tooltip>
                  <Tooltip title={`Kamera: ${device.cameraStatus || 'offline'}`}>
                    <Chip 
                      icon={<CameraIcon />}
                      label={device.cameraStatus || 'offline'}
                      size="small"
                      color={getStatusColor(device.cameraStatus)}
                      sx={{ fontSize: '0.75rem' }}
                    />
                  </Tooltip>
                </Box>
              </Box>
            </Box>
            <Box display="flex" gap={1}>
              <Tooltip title="Gerät-Einstellungen">
                <IconButton onClick={() => navigate(`/devices/${device._id}`)}>
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Status aktualisieren">
                <IconButton onClick={() => handleDeviceControl(device._id, 'refresh')}>
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Live-Stream Bereich */}
                <Paper 
                  sx={{ 
                    width: '100%',
                    aspectRatio: '16/9',
                    mb: 2, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    bgcolor: 'grey.100',
                    position: 'relative',
                    maxHeight: '400px' // Fallback für ältere Browser
                  }}
                >
            {isStreaming ? (
              <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
                {/* Loading-Indikator */}
                {isLoading && (
                  <Box sx={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    zIndex: 1,
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}>
                    Aktualisiere...
                  </Box>
                )}
                {streamUrl ? (
                  <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
                    {/* Altes Bild - bleibt sichtbar */}
                    {currentImage && (
                    <img
                      src={currentImage}
                      alt="Previous Device Stream"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover', // Ändert zu 'cover' für 16:9 Füllung
                        borderRadius: '4px',
                        zIndex: 1
                      }}
                    />
                    )}
                    
                    {/* Neues Bild - lädt im Hintergrund */}
                    <img
                      key={streamUrl}
                      src={streamUrl}
                      alt="Device Stream"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover', // Ändert zu 'cover' für 16:9 Füllung
                        borderRadius: '4px',
                        opacity: isLoading ? 0 : 1,
                        transition: 'opacity 0.3s ease',
                        zIndex: 2
                      }}
                      onError={(e) => {
                        console.error('Image load error:', e);
                        console.error('Image URL:', streamUrl);
                        setIsLoading(false);
                        setStreamingDevices(prev => ({ ...prev, [device._id]: false }));
                      }}
                      onLoad={() => {
                        console.log('Image loaded for:', streamUrl);
                        // Neues Bild ist fertig - ersetze das alte
                        setCurrentImage(streamUrl);
                        // setIsLoading(false) wird jetzt über setTimeout gesteuert
                      }}
                      onLoadStart={() => {
                        console.log('Image loading started for:', streamUrl);
                      }}
                    />
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <CircularProgress size={40} />
                    <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                      Stream wird vorbereitet...
                    </Typography>
                  </Box>
                )}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    bgcolor: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    fontSize: '0.75rem'
                  }}
                >
                  LIVE
                </Box>
              </Box>
            ) : (
              <Box textAlign="center">
                <CameraIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
                <Typography variant="body2" color="textSecondary">
                  Stream nicht aktiv
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<PlayIcon />}
                  onClick={() => toggleStream(device._id)}
                  sx={{ mt: 1 }}
                >
                  Stream starten
                </Button>
              </Box>
            )}
          </Paper>

          {/* Bewegungs-Steuerung */}
          <Box mb={2}>
            <Typography variant="subtitle2" gutterBottom>
              Steuerung
            </Typography>
            
            {/* D-Pad Layout with live position bars */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {/* Vertical Tilt Bar (left of D-Pad) */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ position: 'relative', width: 8, height: 110, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                  <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${Math.round(normalized.tiltPct * 100)}%`, bgcolor: '#1976d2' }} />
                </Box>
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666', minWidth: '20px', textAlign: 'center' }}>
                  {normalized.tilt.toFixed(0)}°
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                {/* Horizontal Rot Bar (above D-Pad) */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ position: 'relative', width: 190, height: 8, borderRadius: 4, bgcolor: '#eee', overflow: 'hidden' }}>
                    <Box sx={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${Math.round(normalized.rotPct * 100)}%`, bgcolor: '#1976d2' }} />
                  </Box>
                  <Typography variant="caption" sx={{ fontSize: '0.65rem', color: '#666' }}>
                    {normalized.rot.toFixed(0)}°
                  </Typography>
                </Box>
              {/* Top Row - Up */}
              <Button 
                variant="outlined" 
                size="small"
                onClick={() => handleDeviceControl(device._id, 'move_up')}
                sx={{ minWidth: 60 }}
              >
                <ArrowUpIcon />
              </Button>
              
              {/* Middle Row - Left, Shoot, Right */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => handleDeviceControl(device._id, 'rotate_left')}
                  sx={{ minWidth: 60 }}
                >
                  <RotateLeftIcon />
                </Button>
                
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => handleDeviceControl(device._id, 'shoot')}
                  sx={{ minWidth: 60 }}
                >
                  ✚
                </Button>
                
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => handleDeviceControl(device._id, 'rotate_right')}
                  sx={{ minWidth: 60 }}
                >
                  <RotateRightIcon />
                </Button>
              </Box>
              
              {/* Bottom Row - Down */}
              <Button 
                variant="outlined" 
                size="small"
                onClick={() => handleDeviceControl(device._id, 'move_down')}
                sx={{ minWidth: 60 }}
              >
                <ArrowDownIcon />
              </Button>
              
              {/* Reset Button */}
              <Button 
                variant="outlined" 
                color="warning"
                size="small"
                onClick={() => handleDeviceControl(device._id, 'reset')}
                sx={{ mt: 1, minWidth: 60 }}
              >
                Reset
              </Button>
              </Box>
            </Box>
          </Box>

          {/* Hardware Monitor Status */}
          <Box mb={2}>
            <Typography variant="caption" color="textSecondary" gutterBottom sx={{ display: 'block' }}>
              Hardware Monitor Status:
            </Typography>
            {deviceStatus ? (
              <>
                <Chip
                  label={deviceStatus.message}
                  color={getStatusColor(deviceStatus.status)}
                  size="small"
                  sx={{ fontSize: '0.7rem' }}
                />
                <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                  {deviceStatus.timestamp.toLocaleTimeString()}
                </Typography>
              </>
            ) : (
              <Chip
                label="Kein Status verfügbar"
                color="default"
                size="small"
                sx={{ fontSize: '0.7rem' }}
              />
            )}
          </Box>

          {/* Steuerungs-Buttons */}
          <Box mb={2}>
            <Typography variant="subtitle2" gutterBottom>
              Geräte-Steuerung
            </Typography>
            <ButtonGroup variant="outlined" size="small" fullWidth>
              <Tooltip title="Überwachung starten">
                <Button 
                  onClick={() => handleDeviceControl(device._id, 'start')}
                  color={device.monitorStatus === 'running' ? 'success' : 'primary'}
                  variant={device.monitorStatus === 'running' ? 'contained' : 'outlined'}
                >
                  <StartIcon />
                </Button>
              </Tooltip>
              <Tooltip title="Überwachung pausieren">
                <Button 
                  onClick={() => handleDeviceControl(device._id, 'pause')}
                  color={device.monitorStatus === 'paused' ? 'warning' : 'primary'}
                  variant={device.monitorStatus === 'paused' ? 'contained' : 'outlined'}
                >
                  <PauseIcon2 />
                </Button>
              </Tooltip>
            </ButtonGroup>
            
            {/* Status-Anzeige */}
            <Box mt={1} textAlign="center">
              <Chip 
                label={device.monitorStatus === 'running' ? 'Läuft' : device.monitorStatus === 'paused' ? 'Pausiert' : 'Gestoppt'}
                color={device.monitorStatus === 'running' ? 'success' : device.monitorStatus === 'paused' ? 'warning' : 'default'}
                size="small"
              />
            </Box>
          </Box>

          {/* Geräte-Info */}
          <Box>
            <Typography variant="caption" color="textSecondary">
              IP: {device.taubenschiesser?.ip || 'Nicht gesetzt'}
            </Typography>
            <br />
            <Typography variant="caption" color="textSecondary">
              Letztes Signal: {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Nie'}
            </Typography>
          </Box>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return <LinearProgress />;
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Taubenschiesser Dashboard
      </Typography>
      
      {/* Status-Alert */}
      {!connected && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Verbindung zum Server unterbrochen. Echtzeit-Updates sind nicht verfügbar.
        </Alert>
      )}
      
      <Grid container spacing={3}>
        {/* Statistics Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <DevicesIcon color="primary" sx={{ mr: 1 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Gesamt Geräte
                  </Typography>
                  <Typography variant="h4">
                    {stats.totalDevices}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <OnlineIcon color="success" sx={{ mr: 1 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Online Geräte
                  </Typography>
                  <Typography variant="h4">
                    {stats.onlineDevices}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <VisibilityIcon color="info" sx={{ mr: 1 }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Erkennungen
                  </Typography>
                  <Typography variant="h4">
                    {stats.totalDetections}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <Typography color="textSecondary" gutterBottom>
                  Online Rate
                </Typography>
                <Typography variant="h4">
                  {stats.totalDevices > 0 
                    ? Math.round((stats.onlineDevices / stats.totalDevices) * 100)
                    : 0}%
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Detections */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Letzte Erkennungen
              </Typography>
              {stats.recentDetections.length > 0 ? (
                <List>
                  {stats.recentDetections.map((detection, index) => (
                    <ListItem key={index}>
                      <ListItemIcon>
                        <VisibilityIcon />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${detection.device?.name || 'Unbekanntes Gerät'}`}
                        secondary={`${detection.detections?.length || 0} Objekte erkannt`}
                      />
                      <Chip
                        label={new Date(detection.processedAt).toLocaleDateString()}
                        size="small"
                        variant="outlined"
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

        {/* Quick Actions */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Schnellzugriff
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <IconButton
                  onClick={() => navigate('/devices')}
                  sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                >
                  <DevicesIcon sx={{ mr: 1 }} />
                  <Typography>Geräte verwalten</Typography>
                </IconButton>
                <IconButton
                  onClick={() => navigate('/detections')}
                  sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                >
                  <VisibilityIcon sx={{ mr: 1 }} />
                  <Typography>Alle Erkennungen anzeigen</Typography>
                </IconButton>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Taubenschiesser Geräte */}
        <Grid item xs={12}>
          <Typography variant="h5" gutterBottom>
            Taubenschiesser Geräte
          </Typography>
          {devices.length > 0 ? (
            <Grid container spacing={3}>
              {devices.map((device) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={device._id}>
                  <DeviceCard device={device} />
                </Grid>
              ))}
            </Grid>
          ) : (
            <Card>
              <CardContent>
                <Box textAlign="center" py={4}>
                  <DevicesIcon sx={{ fontSize: 64, color: 'grey.400', mb: 2 }} />
                  <Typography variant="h6" color="textSecondary" gutterBottom>
                    Keine Geräte gefunden
                  </Typography>
                  <Typography variant="body2" color="textSecondary" paragraph>
                    Erstelle dein erstes Taubenschiesser-Gerät, um es hier zu sehen.
                  </Typography>
                  <Button
                    variant="contained"
                    startIcon={<DevicesIcon />}
                    onClick={() => navigate('/devices')}
                  >
                    Gerät erstellen
                  </Button>
                </Box>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
