import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
  List,
  ListItem,
  ListItemText,
  Divider
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  RadioButtonChecked as ActiveIcon,
  Error as ErrorIcon,
  PhotoCamera as CameraIcon,
  ZoomIn as ZoomIcon,
  Psychology as BrainIcon,
  Pause as PauseIcon,
  PlayArrow as PlayArrowIcon
} from '@mui/icons-material';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useSocket } from '../contexts/SocketContext';
import { formatWaitChipLine as formatWaitLine } from '../utils/waitDisplay';

const HardwareMonitor = () => {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [originalImage, setOriginalImage] = useState(null);
  const [cvResults, setCvResults] = useState(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [waitingInfo, setWaitingInfo] = useState(null);
  const [livePaused, setLivePaused] = useState(false);
  const livePausedRef = useRef(false);
  const { socket, connected } = useSocket();

  const steps = [
    { label: 'Warten', icon: <ActiveIcon /> },
    { label: 'Bewegen', icon: <ActiveIcon /> },
    { label: 'Bild aufnehmen', icon: <CameraIcon /> },
    { label: 'Zoom anwenden', icon: <ZoomIcon /> },
    { label: 'CV-Analyse', icon: <BrainIcon /> }
  ];

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

  const handleMonitorEvent = useCallback((event) => {
    if (livePausedRef.current) return;

    console.log('Hardware monitor event:', event);
    
    const { eventType, data, timestamp } = event;
    
    // Add to events list
    setEvents(prev => [{
      type: eventType,
      data,
      timestamp: new Date(timestamp)
    }, ...prev].slice(0, 50)); // Keep last 50 events

    // Update UI based on event type
    switch (eventType) {
      case 'device_waiting':
        setCurrentStep(0);
        setDeviceStatus('waiting');
        if (data?.threshold != null) {
          const holding = data?.holding === true;
          const dyn = data?.dynamic_threshold;
          const max = data?.max_threshold;
          const base = holding ? 'Halte Position' : 'Warte';
          const extra = max != null ? ` (max ${max}s)` : '';
          const anchorMs = data.wait_started_at
            ? Date.parse(data.wait_started_at)
            : Date.now();
          const t0 = Number.isNaN(anchorMs) ? Date.now() : anchorMs;
          const elapsed = Math.max(0, (Date.now() - t0) / 1000);
          setWaitingInfo({
            base,
            waitStartedAtMs: t0,
            threshold: Number(data.threshold),
            dynamicThreshold: dyn != null ? Number(dyn) : null,
            maxThreshold: max != null ? Number(max) : null,
            holding,
          });
          setStatusMessage(formatWaitLine(base, elapsed, data.threshold, extra));
        } else {
          setWaitingInfo(null);
          setStatusMessage(data.message);
        }
        break;
      
      case 'device_busy':
        setCurrentStep(0);
        setDeviceStatus('busy');
        setWaitingInfo(null);
        setStatusMessage(data.message);
        break;
      
      case 'device_moving':
        setCurrentStep(1);
        setDeviceStatus('moving');
        setWaitingInfo(null);
        setStatusMessage(data.message);
        break;
      
      case 'device_stopped':
        setCurrentStep(1);
        setDeviceStatus('stopped');
        setWaitingInfo(null);
        setStatusMessage(data.message);
        break;
      
      case 'device_stabilizing':
        setCurrentStep(1);
        setDeviceStatus('stabilizing');
        setWaitingInfo(null);
        if (data?.wait_time != null) {
          setStatusMessage(`Warte ${data.wait_time}s bis Kamera stabilisiert...`);
        } else {
          setStatusMessage(data.message);
        }
        break;
      
      case 'analysis_started':
        setCurrentStep(1);
        setOriginalImage(null);
        setCvResults(null);
        setDeviceStatus('analyzing');
        setWaitingInfo(null);
        setStatusMessage('Analyse gestartet');
        break;
      
      case 'capturing_image':
        setCurrentStep(2);
        setDeviceStatus('capturing');
        setWaitingInfo(null);
        const cameraName = data.camera === 'tapo' ? 'Tapo' : data.camera === 'raspberry-pi' ? 'Raspberry Pi' : '';
        setStatusMessage(cameraName ? `Bild wird aufgenommen (${cameraName})...` : 'Bild wird aufgenommen...');
        break;
      
      case 'image_captured':
        setCurrentStep(2);
        setOriginalImage(data.image);
        const camLabel = data.camera === 'tapo' ? 'Tapo' : data.camera === 'raspberry-pi' ? 'Raspberry Pi' : '';
        setStatusMessage(camLabel ? `${camLabel} Bild aufgenommen (${data.width}x${data.height}px)` : `Bild aufgenommen (${data.width}x${data.height}px)`);
        setDeviceStatus('captured');
        setWaitingInfo(null);
        break;
      
      case 'image_zoomed':
        setCurrentStep(3);
        const zoomCam = data.camera === 'tapo' ? 'Tapo' : data.camera === 'raspberry-pi' ? 'Raspberry Pi' : '';
        setStatusMessage(zoomCam ? `${zoomCam} Zoom ${data.zoom_factor}x` : `Zoom ${data.zoom_factor}x angewendet`);
        setDeviceStatus('zoomed');
        setWaitingInfo(null);
        break;
      
      case 'analyzing':
        setCurrentStep(4);
        setDeviceStatus('analyzing_cv');
        setWaitingInfo(null);
        const analyzingName = data.camera === 'tapo' ? 'Tapo' : data.camera === 'raspberry-pi' ? 'Raspberry Pi' : '';
        setStatusMessage(analyzingName ? `CV-Analyse (${analyzingName})...` : 'CV-Analyse läuft...');
        break;
      
      case 'cv_analysis_complete':
        setCurrentStep(4);
        setCvResults(data);
        setDeviceStatus('analysis_complete');
        setWaitingInfo(null);
        if (data.total_objects > 0) {
          const objectSummary = Object.entries(data.objects_by_class || {})
            .map(([className, count]) => `${count}x ${className}`)
            .join(', ');
          setStatusMessage(`${data.total_objects} Objekt(e) erkannt: ${objectSummary}`);
          if (data.birds_found) {
            toast.success(`🦅 ${data.bird_count} Vögel erkannt!`);
          } else {
            toast.info(`Objekte erkannt: ${objectSummary}`);
          }
        } else {
          setStatusMessage('Keine Objekte erkannt');
          toast.info('Keine Objekte erkannt');
        }
        break;
      
      case 'birds_detected':
        setWaitingInfo(null);
        toast.success(`${data.bird_count} Vögel erkannt! Konfidenz: ${(data.confidence * 100).toFixed(1)}%`);
        break;
      
      case 'error':
        setDeviceStatus('error');
        setWaitingInfo(null);
        setStatusMessage(`Fehler: ${data.message}`);
        toast.error(`Fehler: ${data.message}`);
        break;
      
      default:
        break;
    }
  }, []);

  // Locally tick wait elapsed every second (anchor: wait_started_at from server).
  useEffect(() => {
    if (deviceStatus !== 'waiting' || !waitingInfo || livePaused) return;

    const interval = setInterval(() => {
      setWaitingInfo((prev) => {
        if (!prev) return prev;
        const elapsed = Math.max(0, (Date.now() - prev.waitStartedAtMs) / 1000);

        const max = prev.maxThreshold;
        const extra = max != null ? ` (max ${max}s)` : '';
        setStatusMessage(formatWaitLine(prev.base, elapsed, prev.threshold, extra));
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [deviceStatus, waitingInfo, livePaused]);

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (socket && connected && selectedDevice) {
      console.log('Joining monitor room for device:', selectedDevice);
      
      // Join monitor room for selected device
      socket.emit('join-device', selectedDevice);
      
      // Join specific monitor room
      const monitorRoom = `monitor-${selectedDevice}`;
      console.log('Joining monitor room:', monitorRoom);
      socket.emit('join', monitorRoom);
      
      setIsMonitoring(true);

      // Listen for hardware monitor events
      socket.on('hardware-monitor-event', handleMonitorEvent);

      return () => {
        console.log('Leaving monitor room for device:', selectedDevice);
        socket.off('hardware-monitor-event', handleMonitorEvent);
        socket.emit('leave', monitorRoom);
        setIsMonitoring(false);
      };
    }
  }, [socket, connected, selectedDevice, handleMonitorEvent]);

  const handleDeviceChange = (event) => {
    const deviceId = event.target.value;
    setSelectedDevice(deviceId);
    setLivePaused(false);
    livePausedRef.current = false;
    setEvents([]);
    setCurrentStep(0);
    setOriginalImage(null);
    setCvResults(null);
    setDeviceStatus('idle');
    setStatusMessage('');
    setWaitingInfo(null);

    // Initialize UI immediately from persisted last hardware-monitor event (if available)
    const dev = devices.find((d) => d?._id === deviceId);
    const lastType = dev?.hardwareMonitor?.lastEventType;
    const lastData = dev?.hardwareMonitor?.lastEventData;
    const lastAt = dev?.hardwareMonitor?.lastEventAt;
    if (lastType && lastData) {
      handleMonitorEvent({
        eventType: lastType,
        data: lastData,
        timestamp: lastAt || new Date().toISOString(),
      });
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'waiting':
        return 'info';
      case 'moving':
        return 'warning';
      case 'stopped':
      case 'captured':
      case 'analysis_complete':
        return 'success';
      case 'busy':
        return 'warning';
      case 'error':
        return 'error';
      case 'analyzing':
      case 'analyzing_cv':
      case 'capturing':
      case 'stabilizing':
        return 'primary';
      default:
        return 'default';
    }
  };

  const getEventIcon = (eventType) => {
    switch (eventType) {
      case 'analysis_started':
        return <ActiveIcon color="primary" />;
      case 'image_captured':
        return <CameraIcon color="success" />;
      case 'image_zoomed':
        return <ZoomIcon color="info" />;
      case 'cv_analysis_complete':
        return <BrainIcon color="secondary" />;
      case 'birds_detected':
        return <CheckIcon color="success" />;
      case 'error':
        return <ErrorIcon color="error" />;
      default:
        return <ActiveIcon />;
    }
  };

  const getEventColor = (eventType) => {
    switch (eventType) {
      case 'analysis_started':
        return 'primary';
      case 'image_captured':
        return 'success';
      case 'image_zoomed':
        return 'info';
      case 'cv_analysis_complete':
        return 'secondary';
      case 'birds_detected':
        return 'success';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const formatEventMessage = (event) => {
    switch (event.type) {
      case 'analysis_started':
        return 'Analyse gestartet';
      case 'image_source':
        const src = event.data.source;
        const sourceLabel = src === 'local' ? 'Lokal' : src === 'tapo' ? 'Tapo Kamera' : src === 'raspberry-pi' ? 'Raspberry Pi Kamera' : (src || 'Kamera');
        return `Bildquelle: ${sourceLabel}`;
      case 'capturing_image':
        return 'Bild wird aufgenommen...';
      case 'image_captured':
        return `Bild aufgenommen (${event.data.width}x${event.data.height}px)`;
      case 'image_zoomed':
        return `Zoom angewendet: ${event.data.zoom_factor}x (${event.data.width}x${event.data.height}px)`;
      case 'analyzing':
        return 'CV-Analyse läuft...';
      case 'cv_analysis_complete':
        if (event.data.total_objects > 0) {
          const objectSummary = Object.entries(event.data.objects_by_class || {})
            .map(([className, count]) => `${count}x ${className}`)
            .join(', ');
          return `CV-Analyse: ${event.data.total_objects} Objekt(e) - ${objectSummary}`;
        }
        return `CV-Analyse: Keine Objekte erkannt`;
      case 'birds_detected':
        return `⚠️ ${event.data.bird_count} Vögel erkannt! Konfidenz: ${(event.data.confidence * 100).toFixed(1)}%`;
      case 'device_waiting':
        return event.data.message;
      case 'device_position':
        return `Position: Rot=${event.data?.rotation ?? '-'}, Tilt=${event.data?.tilt ?? '-'}`;
      case 'device_moving':
        return event.data.message;
      case 'device_stopped':
        return event.data.message;
      case 'device_stabilizing':
        return event.data.message;
      case 'device_busy':
        return event.data.message;
      case 'error':
        return `Fehler: ${event.data.message}`;
      default:
        return event.data.message || event.type;
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box mb={3}>
        <Typography variant="h4">
          Hardware Monitor Live-Ansicht
        </Typography>
      </Box>

      {/* Device Selection */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <FormControl fullWidth>
            <InputLabel>Gerät auswählen</InputLabel>
            <Select
              value={selectedDevice}
              onChange={handleDeviceChange}
              label="Gerät auswählen"
            >
              <MenuItem value="">
                <em>Kein Gerät ausgewählt</em>
              </MenuItem>
              {devices.map((device) => (
                <MenuItem key={device._id} value={device._id}>
                  {device.name} ({device.taubenschiesser?.ip || 'Keine IP'})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          
          {selectedDevice && isMonitoring && (
            <Box mt={2}>
              {livePaused && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  Live-Updates sind pausiert — die Anzeige bleibt eingefroren, bis du „Live fortsetzen“ wählst.
                </Alert>
              )}
              <Alert severity={getStatusColor(deviceStatus)} sx={{ mb: 1 }}>
                <strong>Status:</strong> {statusMessage || 'Warte auf Hardware Monitor Aktivität...'}
              </Alert>
            </Box>
          )}
        </CardContent>
      </Card>

      {selectedDevice && (
        <Grid container spacing={3}>
          {/* Process Steps */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Aktueller Prozess
                </Typography>
                <Stepper activeStep={currentStep} alternativeLabel>
                  {steps.map((step, index) => {
                    const isActive = index === currentStep;
                    const isCompleted = index < currentStep;
                    
                    return (
                      <Step key={step.label} completed={isCompleted}>
                        <StepLabel 
                          StepIconComponent={() => (
                            <Box 
                              sx={{ 
                                color: isCompleted ? 'success.main' : isActive ? 'primary.main' : 'grey.400',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              {step.icon}
                            </Box>
                          )}
                        >
                          {step.label}
                        </StepLabel>
                      </Step>
                    );
                  })}
                </Stepper>
              </CardContent>
            </Card>
          </Grid>

          {/* Image - single camera (Tapo or Raspberry Pi) */}
          {originalImage ? (
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Aktuelles Bild</Typography>
                  <Box
                    component="img"
                    src={originalImage}
                    alt="Kamerabild"
                    sx={{ width: '100%', maxWidth: 900, height: 'auto', borderRadius: 1, border: '1px solid #ddd' }}
                  />
                </CardContent>
              </Card>
            </Grid>
          ) : (
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Box
                    sx={{
                      width: '100%',
                      height: 300,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px dashed #ccc',
                      borderRadius: 1,
                      backgroundColor: '#f5f5f5'
                    }}
                  >
                    <Typography color="textSecondary">
                      Warte auf Bild...
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* CV Results - single camera */}
          {cvResults && (
            <Grid item xs={12}>
                  <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    CV-Analyse Ergebnisse
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={3}>
                      <Paper sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="h3">
                          {cvResults.total_objects || 0}
                        </Typography>
                        <Typography color="textSecondary">
                          Objekte gesamt
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <Paper sx={{ p: 2, textAlign: 'center', bgcolor: cvResults.bird_count > 0 ? '#fff3e0' : 'inherit' }}>
                        <Typography variant="h3" color={cvResults.bird_count > 0 ? 'error' : 'inherit'}>
                          {cvResults.bird_count}
                        </Typography>
                        <Typography color="textSecondary">
                          Vögel erkannt
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <Paper sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="h3" color="secondary">
                          {(cvResults.confidence_level * 100).toFixed(1)}%
                        </Typography>
                        <Typography color="textSecondary">
                          Konfidenz
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <Paper sx={{ p: 2, textAlign: 'center' }}>
                        <Typography variant="h3">
                          {(() => {
                            const sec = cvResults.processing_time_sec != null && cvResults.processing_time_sec !== ''
                              ? Number(cvResults.processing_time_sec)
                              : (cvResults.processing_time != null && cvResults.processing_time !== ''
                                ? Number(cvResults.processing_time) / 1000
                                : null);
                            return sec != null && Number.isFinite(sec) ? `${sec.toFixed(2)} s` : 'N/A';
                          })()}
                        </Typography>
                        <Typography color="textSecondary">
                          Verarbeitungszeit
                        </Typography>
                      </Paper>
                    </Grid>
                  </Grid>

                  {/* Objects by class */}
                  {cvResults.objects_by_class && Object.keys(cvResults.objects_by_class).length > 0 && (
                    <Box mt={3}>
                      <Typography variant="subtitle1" gutterBottom>
                        Erkannte Objektklassen:
                      </Typography>
                      <Grid container spacing={1}>
                        {Object.entries(cvResults.objects_by_class).map(([className, count]) => (
                          <Grid item key={className}>
                            <Chip 
                              label={`${className}: ${count}`}
                              color={className.toLowerCase() === 'bird' ? 'error' : 'default'}
                              variant={className.toLowerCase() === 'bird' ? 'filled' : 'outlined'}
                            />
                          </Grid>
                        ))}
                      </Grid>
                    </Box>
                  )}

                  {cvResults.detections && cvResults.detections.length > 0 && (
                    <Box mt={3}>
                      <Typography variant="subtitle1" gutterBottom>
                        Detektierte Objekte:
                      </Typography>
                      <List>
                        {cvResults.detections.map((detection, index) => (
                          <React.Fragment key={index}>
                            <ListItem
                              sx={detection.is_target_bird ? { bgcolor: 'action.selected', borderRadius: 1 } : {}}
                            >
                              <ListItemText
                                primary={
                                  <Box component="span" display="flex" alignItems="center" gap={1}>
                                    {detection.is_target_bird && (
                                      <Chip label="Ziel" size="small" color="primary" />
                                    )}
                                    {`${detection.class} - ${(detection.confidence * 100).toFixed(1)}%`}
                                  </Box>
                                }
                                secondary={
                                  <>
                                    {detection.position && `Position: (${detection.position.center_x?.toFixed(0)}, ${detection.position.center_y?.toFixed(0)})`}
                                    {(detection.esp_rot != null || detection.esp_tilt != null) && (
                                      <Typography component="span" display="block" variant="body2" color="textSecondary">
                                        ESP: Rot {detection.esp_rot ?? '–'}°, Tilt {detection.esp_tilt ?? '–'}°
                                      </Typography>
                                    )}
                                  </>
                                }
                              />
                            </ListItem>
                            {index < cvResults.detections.length - 1 && <Divider />}
                          </React.Fragment>
                        ))}
                      </List>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Event Log */}
          <Grid item xs={12}>
            <Box
              display="flex"
              justifyContent="flex-end"
              alignItems="center"
              flexWrap="wrap"
              gap={1}
              sx={{ mb: 1 }}
            >
              <Button
                variant={livePaused ? 'contained' : 'outlined'}
                color={livePaused ? 'primary' : 'inherit'}
                size="small"
                startIcon={livePaused ? <PlayArrowIcon /> : <PauseIcon />}
                onClick={() => {
                  setLivePaused((p) => {
                    const next = !p;
                    livePausedRef.current = next;
                    return next;
                  });
                }}
              >
                {livePaused ? 'Live fortsetzen' : 'Live pausieren'}
              </Button>
            </Box>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Event-Log
                </Typography>
                <List sx={{ maxHeight: 400, overflow: 'auto' }}>
                  {events.length === 0 ? (
                    <ListItem>
                      <ListItemText
                        primary="Keine Events"
                        secondary="Warte auf Hardware Monitor Aktivität..."
                      />
                    </ListItem>
                  ) : (
                    events.map((event, index) => (
                      <React.Fragment key={index}>
                        <ListItem>
                          <Box display="flex" alignItems="center" width="100%">
                            <Box mr={2}>
                              {getEventIcon(event.type)}
                            </Box>
                            <Box flex={1}>
                              <Box display="flex" alignItems="center" gap={1}>
                                <Chip
                                  label={event.type}
                                  size="small"
                                  color={getEventColor(event.type)}
                                  sx={{ fontFamily: 'monospace' }}
                                />
                                <Typography variant="body2" color="textSecondary">
                                  {event.timestamp.toLocaleTimeString()}
                                </Typography>
                              </Box>
                              <Typography variant="body1" sx={{ mt: 0.5 }}>
                                {formatEventMessage(event)}
                              </Typography>
                            </Box>
                          </Box>
                        </ListItem>
                        {index < events.length - 1 && <Divider />}
                      </React.Fragment>
                    ))
                  )}
                </List>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {!selectedDevice && (
        <Alert severity="info">
          Bitte wähle ein Gerät aus, um die Hardware Monitor Aktivität zu überwachen.
        </Alert>
      )}
    </Box>
  );
};

export default HardwareMonitor;

