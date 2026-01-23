import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Divider,
  Grid,
  Card,
  CardContent,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  InputAdornment,
  Tooltip
} from '@mui/material';
import {
  Person as PersonIcon,
  Settings as SettingsIcon,
  Wifi as MqttIcon,
  Notifications as NotificationsIcon,
  Palette as ThemeIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  ContentCopy as CopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Cloud as WeatherIcon,
  LocationOn as LocationIcon,
  MyLocation as MyLocationIcon,
  Search as SearchIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { toast } from 'react-toastify';

const Profile = () => {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [formData, setFormData] = useState({
    username: user?.username || '',
    email: user?.email || ''
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [settings, setSettings] = useState({
    mqtt: {
      serverProfile: 'custom',
      broker: '',
      port: 1883,
      username: '',
      password: '',
      enabled: false
    },
    notifications: {
      email: true,
      push: false,
      detectionAlerts: true
    },
    system: {
      autoRefresh: 10,
      theme: 'auto'
    },
    weather: {
      provider: 'openweathermap',
      apiKey: '',
      location: {
        lat: null,
        lng: null,
        name: ''
      },
      enabled: false
    }
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [mqttTestResult, setMqttTestResult] = useState(null);
  const [weatherTestResult, setWeatherTestResult] = useState(null);
  const [testingWeather, setTestingWeather] = useState(false);
  const [locationSearchQuery, setLocationSearchQuery] = useState('');
  const [searchingLocation, setSearchingLocation] = useState(false);
  const [gettingCurrentLocation, setGettingCurrentLocation] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Check for settings tab from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    if (tab === 'settings') {
      setActiveTab(1);
    }
  }, []);

  // Load settings on component mount
  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await axios.get('/api/users/settings');
      setSettings({
        mqtt: response.data.mqtt || settings.mqtt,
        notifications: response.data.notifications || settings.notifications,
        system: response.data.system || settings.system,
        weather: response.data.weather || settings.weather
      });
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const handleSettingsSave = async () => {
    setSaving(true);
    try {
      await axios.put('/api/users/settings', settings);
      toast.success('Einstellungen gespeichert');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Fehler beim Speichern der Einstellungen');
    } finally {
      setSaving(false);
    }
  };

  const testMqttConnection = async () => {
    setTesting(true);
    setMqttTestResult(null);
    
    // Validate required fields first
    if (!settings.mqtt.broker || !settings.mqtt.port) {
      setMqttTestResult({ 
        success: false, 
        error: 'Broker und Port sind erforderlich' 
      });
      setTesting(false);
      return;
    }

    // Save settings first before testing
    try {
      await axios.put('/api/users/settings', settings);
      console.log('Settings saved before MQTT test');
    } catch (error) {
      console.error('Error saving settings:', error);
      setMqttTestResult({ 
        success: false, 
        error: 'Fehler beim Speichern der Einstellungen' 
      });
      setTesting(false);
      return;
    }
    
    try {
      const response = await axios.post('/api/users/settings/mqtt/test');
      setMqttTestResult(response.data);
      
      if (response.data.success) {
        toast.success('MQTT-Verbindung erfolgreich');
      } else {
        toast.error(`MQTT-Verbindung fehlgeschlagen: ${response.data.error}`);
      }
    } catch (error) {
      console.error('MQTT test error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Unbekannter Fehler';
      setMqttTestResult({ success: false, error: errorMessage });
      toast.error(`MQTT-Test fehlgeschlagen: ${errorMessage}`);
    } finally {
      setTesting(false);
    }
  };

  const handleMqttChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      mqtt: {
        ...prev.mqtt,
        [field]: value
      }
    }));
  };

  const handleMqttServerProfile = (profile) => {
    const profiles = {
      'localhost': {
        broker: 'localhost',
        port: 1883,
        username: '',
        password: ''
      },
      'hivemq': {
        broker: '',
        port: 8883,
        username: '',
        password: ''
      },
      'aws': {
        broker: '',
        port: 8883,
        username: '',
        password: ''
      },
      'azure': {
        broker: '',
        port: 8883,
        username: '',
        password: ''
      },
      'custom': {
        broker: '',
        port: 1883,
        username: '',
        password: ''
      }
    };

    setSettings(prev => ({
      ...prev,
      mqtt: {
        ...prev.mqtt,
        serverProfile: profile,
        ...profiles[profile]
      }
    }));
  };

  const handleNotificationChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [field]: value
      }
    }));
  };

  const handleSystemChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      system: {
        ...prev.system,
        [field]: value
      }
    }));
  };

  const handleWeatherChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      weather: {
        ...prev.weather,
        [field]: value
      }
    }));
  };

  const handleWeatherLocationChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      weather: {
        ...prev.weather,
        location: {
          ...prev.weather.location,
          [field]: value
        }
      }
    }));
  };

  const getCurrentLocation = async () => {
    setGettingCurrentLocation(true);
    try {
      if (!navigator.geolocation) {
        toast.error('Geolocation wird von Ihrem Browser nicht unterstützt');
        setGettingCurrentLocation(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          
          handleWeatherLocationChange('lat', lat);
          handleWeatherLocationChange('lng', lng);
          
          // Versuche Standortname zu finden
          searchLocationByCoordinates(lat, lng);
          
          toast.success('Aktueller Standort erfolgreich ermittelt');
          setGettingCurrentLocation(false);
        },
        (error) => {
          console.error('Geolocation error:', error);
          let errorMessage = 'Fehler beim Abrufen des Standorts';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Standort-Zugriff wurde verweigert. Bitte erlauben Sie den Zugriff in den Browser-Einstellungen.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Standort-Informationen sind nicht verfügbar.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Zeitüberschreitung beim Abrufen des Standorts.';
              break;
          }
          toast.error(errorMessage);
          setGettingCurrentLocation(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    } catch (error) {
      console.error('Error getting current location:', error);
      toast.error('Fehler beim Abrufen des aktuellen Standorts');
      setGettingCurrentLocation(false);
    }
  };

  const searchLocationByCoordinates = async (lat, lng) => {
    try {
      // Verwende Nominatim (OpenStreetMap) - kostenlos, kein API-Key nötig
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'Taubenschiesser-App'
          }
        }
      );
      
      if (response.data && response.data.display_name) {
        handleWeatherLocationChange('name', response.data.display_name);
      }
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      // Nicht kritisch, einfach keinen Namen setzen
    }
  };

  const searchLocationByName = async () => {
    if (!locationSearchQuery.trim()) {
      toast.error('Bitte geben Sie einen Ort oder eine Adresse ein');
      return;
    }

    setSearchingLocation(true);
    try {
      // Verwende Nominatim (OpenStreetMap) - kostenlos, kein API-Key nötig
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationSearchQuery)}&limit=1&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'Taubenschiesser-App'
          }
        }
      );

      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        const lat = parseFloat(result.lat);
        const lng = parseFloat(result.lon);
        
        handleWeatherLocationChange('lat', lat);
        handleWeatherLocationChange('lng', lng);
        handleWeatherLocationChange('name', result.display_name || locationSearchQuery);
        
        toast.success(`Standort gefunden: ${result.display_name}`);
        setLocationSearchQuery('');
      } else {
        toast.error('Kein Standort gefunden. Bitte versuchen Sie eine andere Suche.');
      }
    } catch (error) {
      console.error('Error searching location:', error);
      toast.error('Fehler bei der Standortsuche');
    } finally {
      setSearchingLocation(false);
    }
  };

  const testWeatherAPI = async () => {
    setTestingWeather(true);
    setWeatherTestResult(null);
    
    // Validate required fields
    if (!settings.weather.provider || !settings.weather.apiKey) {
      setWeatherTestResult({ 
        success: false, 
        error: 'Provider und API Key sind erforderlich' 
      });
      setTestingWeather(false);
      return;
    }

    if (!settings.weather.location.lat || !settings.weather.location.lng) {
      setWeatherTestResult({ 
        success: false, 
        error: 'Koordinaten (Lat/Lng) sind erforderlich' 
      });
      setTestingWeather(false);
      return;
    }

    // Save settings first
    try {
      await axios.put('/api/users/settings', settings);
    } catch (error) {
      console.error('Error saving settings:', error);
      setWeatherTestResult({ 
        success: false, 
        error: 'Fehler beim Speichern der Einstellungen' 
      });
      setTestingWeather(false);
      return;
    }
    
    try {
      const response = await axios.post('/api/users/settings/weather/test');
      setWeatherTestResult(response.data);
      
      if (response.data.success) {
        toast.success(`Temperatur erfolgreich abgerufen: ${response.data.temperature}°C`);
      } else {
        toast.error(`Temperatur-Abfrage fehlgeschlagen: ${response.data.error}`);
      }
    } catch (error) {
      console.error('Weather test error:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Unbekannter Fehler';
      setWeatherTestResult({ success: false, error: errorMessage });
      toast.error(`Wetter-API-Test fehlgeschlagen: ${errorMessage}`);
    } finally {
      setTestingWeather(false);
    }
  };

  const handleProfileChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handlePasswordChange = (e) => {
    setPasswordData({
      ...passwordData,
      [e.target.name]: e.target.value
    });
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.put('/api/users/profile', formData);
      updateUser(response.data);
      toast.success('Profil erfolgreich aktualisiert');
    } catch (error) {
      console.error('Profile update error:', error);
      setError(error.response?.data?.error || 'Fehler beim Aktualisieren des Profils');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('Neue Passwörter stimmen nicht überein');
      setLoading(false);
      return;
    }

    try {
      await axios.put('/api/users/password', passwordData);
      toast.success('Passwort erfolgreich geändert');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (error) {
      console.error('Password change error:', error);
      setError(error.response?.data?.error || 'Fehler beim Ändern des Passworts');
    } finally {
      setLoading(false);
    }
  };

  // Get token from localStorage
  const getToken = () => {
    return localStorage.getItem('access_token') || 'Nicht verfügbar';
  };

  const handleCopyToken = async () => {
    const token = getToken();
    if (token && token !== 'Nicht verfügbar') {
      try {
        await navigator.clipboard.writeText(token);
        setTokenCopied(true);
        toast.success('Token in Zwischenablage kopiert!');
        setTimeout(() => setTokenCopied(false), 2000);
      } catch (err) {
        toast.error('Fehler beim Kopieren');
      }
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        Profil & Einstellungen
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
          <Tab 
            icon={<PersonIcon />} 
            label="Profil" 
            iconPosition="start"
          />
          <Tab 
            icon={<SettingsIcon />} 
            label="Einstellungen" 
            iconPosition="start"
          />
          <Tab 
            icon={<WeatherIcon />} 
            label="Wetter-API" 
            iconPosition="start"
          />
        </Tabs>
      </Box>

      {/* Profile Tab */}
      {activeTab === 0 && (
        <Grid container spacing={3}>
          {/* Profile Information */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Profil bearbeiten
                </Typography>
                <Box component="form" onSubmit={handleProfileSubmit}>
                  <TextField
                    fullWidth
                    label="Benutzername"
                    name="username"
                    value={formData.username}
                    onChange={handleProfileChange}
                    margin="normal"
                    required
                    disabled={loading}
                  />
                  <TextField
                    fullWidth
                    label="E-Mail"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleProfileChange}
                    margin="normal"
                    required
                    disabled={loading}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    sx={{ mt: 2 }}
                    disabled={loading}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Profil aktualisieren'}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Password Change */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Passwort ändern
                </Typography>
                <Box component="form" onSubmit={handlePasswordSubmit}>
                  <TextField
                    fullWidth
                    label="Aktuelles Passwort"
                    name="currentPassword"
                    type="password"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordChange}
                    margin="normal"
                    required
                    disabled={loading}
                  />
                  <TextField
                    fullWidth
                    label="Neues Passwort"
                    name="newPassword"
                    type="password"
                    value={passwordData.newPassword}
                    onChange={handlePasswordChange}
                    margin="normal"
                    required
                    disabled={loading}
                  />
                  <TextField
                    fullWidth
                    label="Neues Passwort bestätigen"
                    name="confirmPassword"
                    type="password"
                    value={passwordData.confirmPassword}
                    onChange={handlePasswordChange}
                    margin="normal"
                    required
                    disabled={loading}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    sx={{ mt: 2 }}
                    disabled={loading}
                  >
                    {loading ? <CircularProgress size={24} /> : 'Passwort ändern'}
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Account Information */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Kontoinformationen
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Benutzername:</strong> {user?.username}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="textSecondary">
                      <strong>E-Mail:</strong> {user?.email}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Rolle:</strong> {user?.role}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Registriert:</strong> {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                    </Typography>
                  </Grid>
                  {user?.lastLogin && (
                    <Grid item xs={12} sm={6}>
                      <Typography variant="body2" color="textSecondary">
                        <strong>Letzte Anmeldung:</strong> {new Date(user.lastLogin).toLocaleString()}
                      </Typography>
                    </Grid>
                  )}
                  <Grid item xs={12} sm={6}>
                    <Typography variant="body2" color="textSecondary">
                      <strong>Geräte:</strong> {user?.devices?.length || 0}
                    </Typography>
                  </Grid>
                  
                  {/* API Token Section */}
                  <Grid item xs={12}>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
                      🔑 API Token (für Home Assistant)
                    </Typography>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      <Typography variant="body2">
                        Kopiere diesen Token für die Home Assistant Integration. 
                        Der Token ist 7 Tage gültig.
                      </Typography>
                    </Alert>
                    <TextField
                      fullWidth
                      label="API Token"
                      value={tokenVisible ? getToken() : '••••••••••••••••'}
                      margin="normal"
                      disabled
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <Tooltip title={tokenVisible ? "Token ausblenden" : "Token anzeigen"}>
                              <IconButton
                                onClick={() => setTokenVisible(!tokenVisible)}
                                edge="end"
                              >
                                {tokenVisible ? <VisibilityOffIcon /> : <VisibilityIcon />}
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Token kopieren">
                              <IconButton
                                onClick={handleCopyToken}
                                edge="end"
                                color={tokenCopied ? "success" : "default"}
                              >
                                <CopyIcon />
                              </IconButton>
                            </Tooltip>
                          </InputAdornment>
                        )
                      }}
                    />
                    {tokenCopied && (
                      <Alert severity="success" sx={{ mt: 1 }}>
                        Token wurde in die Zwischenablage kopiert!
                      </Alert>
                    )}
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Settings Tab */}
      {activeTab === 1 && (
        <Grid container spacing={3}>
          {/* MQTT Settings */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                  <MqttIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">MQTT-Konfiguration</Typography>
                </Box>

                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="body2">
                    <strong>MQTT-Broker erforderlich:</strong> Wähle einen vorkonfigurierten Server oder gib eigene Daten ein.
                  </Typography>
                </Alert>

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.mqtt.enabled}
                      onChange={(e) => handleMqttChange('enabled', e.target.checked)}
                    />
                  }
                  label="MQTT aktivieren"
                />

                {settings.mqtt.enabled && (
                  <>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>MQTT-Server wählen</InputLabel>
                      <Select
                        value={settings.mqtt.serverProfile || 'custom'}
                        onChange={(e) => handleMqttServerProfile(e.target.value)}
                        label="MQTT-Server wählen"
                      >
                        <MenuItem value="localhost">Lokal (localhost:1883)</MenuItem>
                        <MenuItem value="hivemq">HiveMQ Cloud (kostenlos)</MenuItem>
                        <MenuItem value="aws">AWS IoT Core</MenuItem>
                        <MenuItem value="azure">Azure IoT Hub</MenuItem>
                        <MenuItem value="custom">Eigene Konfiguration</MenuItem>
                      </Select>
                    </FormControl>

                    {settings.mqtt.serverProfile === 'hivemq' && (
                      <>
                        <TextField
                          fullWidth
                          label="HiveMQ Broker URL"
                          value={settings.mqtt.broker}
                          onChange={(e) => handleMqttChange('broker', e.target.value)}
                          margin="normal"
                          placeholder="broker-xxx.hivemq.cloud"
                          helperText="Von HiveMQ Cloud kopierte Broker-URL"
                        />
                        <TextField
                          fullWidth
                          label="Port"
                          value={settings.mqtt.port}
                          onChange={(e) => handleMqttChange('port', parseInt(e.target.value))}
                          margin="normal"
                          placeholder="8883"
                          helperText="HiveMQ Cloud Port (meist 8883 für SSL)"
                        />
                        <TextField
                          fullWidth
                          label="Username"
                          value={settings.mqtt.username}
                          onChange={(e) => handleMqttChange('username', e.target.value)}
                          margin="normal"
                          placeholder="hivemq_username"
                        />
                        <TextField
                          fullWidth
                          label="Password"
                          type="password"
                          value={settings.mqtt.password}
                          onChange={(e) => handleMqttChange('password', e.target.value)}
                          margin="normal"
                          placeholder="hivemq_password"
                        />
                      </>
                    )}

                    {settings.mqtt.serverProfile === 'aws' && (
                      <>
                        <TextField
                          fullWidth
                          label="AWS IoT Endpoint"
                          value={settings.mqtt.broker}
                          onChange={(e) => handleMqttChange('broker', e.target.value)}
                          margin="normal"
                          placeholder="xxxxx-ats.iot.region.amazonaws.com"
                          helperText="AWS IoT Core Endpoint"
                        />
                        <TextField
                          fullWidth
                          label="Port"
                          value={settings.mqtt.port}
                          onChange={(e) => handleMqttChange('port', parseInt(e.target.value))}
                          margin="normal"
                          placeholder="8883"
                          helperText="AWS IoT Port (8883 für SSL)"
                        />
                        <TextField
                          fullWidth
                          label="Access Key ID"
                          value={settings.mqtt.username}
                          onChange={(e) => handleMqttChange('username', e.target.value)}
                          margin="normal"
                          placeholder="AKIA..."
                        />
                        <TextField
                          fullWidth
                          label="Secret Access Key"
                          type="password"
                          value={settings.mqtt.password}
                          onChange={(e) => handleMqttChange('password', e.target.value)}
                          margin="normal"
                          placeholder="AWS Secret Key"
                        />
                      </>
                    )}

                    {settings.mqtt.serverProfile === 'azure' && (
                      <>
                        <TextField
                          fullWidth
                          label="Azure IoT Hub Hostname"
                          value={settings.mqtt.broker}
                          onChange={(e) => handleMqttChange('broker', e.target.value)}
                          margin="normal"
                          placeholder="your-hub.azure-devices.net"
                          helperText="Azure IoT Hub Hostname"
                        />
                        <TextField
                          fullWidth
                          label="Port"
                          value={settings.mqtt.port}
                          onChange={(e) => handleMqttChange('port', parseInt(e.target.value))}
                          margin="normal"
                          placeholder="8883"
                          helperText="Azure IoT Hub Port (8883 für SSL)"
                        />
                        <TextField
                          fullWidth
                          label="Device ID"
                          value={settings.mqtt.username}
                          onChange={(e) => handleMqttChange('username', e.target.value)}
                          margin="normal"
                          placeholder="device_id"
                        />
                        <TextField
                          fullWidth
                          label="SAS Token"
                          type="password"
                          value={settings.mqtt.password}
                          onChange={(e) => handleMqttChange('password', e.target.value)}
                          margin="normal"
                          placeholder="SharedAccessSignature sr=..."
                        />
                      </>
                    )}

                    {settings.mqtt.serverProfile === 'custom' && (
                      <>
                        <TextField
                          fullWidth
                          label="MQTT Broker"
                          value={settings.mqtt.broker}
                          onChange={(e) => handleMqttChange('broker', e.target.value)}
                          margin="normal"
                          placeholder="localhost oder mqtt.example.com"
                          helperText="IP-Adresse oder Domain des MQTT-Servers"
                        />
                        <TextField
                          fullWidth
                          label="Port"
                          type="number"
                          value={settings.mqtt.port}
                          onChange={(e) => handleMqttChange('port', parseInt(e.target.value))}
                          margin="normal"
                          inputProps={{ min: 1, max: 65535 }}
                          helperText="Standard: 1883 (unverschlüsselt), 8883 (SSL)"
                        />
                        <TextField
                          fullWidth
                          label="Benutzername"
                          value={settings.mqtt.username}
                          onChange={(e) => handleMqttChange('username', e.target.value)}
                          margin="normal"
                          placeholder="mqtt_username"
                          helperText="Optional: Benutzername für MQTT-Authentifizierung"
                        />
                        <TextField
                          fullWidth
                          label="Passwort"
                          type="password"
                          value={settings.mqtt.password}
                          onChange={(e) => handleMqttChange('password', e.target.value)}
                          margin="normal"
                          placeholder="mqtt_password"
                          helperText="Optional: Passwort für MQTT-Authentifizierung"
                        />
                      </>
                    )}

                    <Box mt={2}>
                      <Button
                        variant="outlined"
                        onClick={testMqttConnection}
                        disabled={testing || !settings.mqtt.broker || !settings.mqtt.port}
                        startIcon={testing ? <CircularProgress size={20} /> : <MqttIcon />}
                      >
                        {testing ? 'Teste...' : 'MQTT-Verbindung testen'}
                      </Button>
                      
                      {(!settings.mqtt.broker || !settings.mqtt.port) && (
                        <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                          Broker und Port müssen ausgefüllt sein
                        </Typography>
                      )}

                      {mqttTestResult && (
                        <Box mt={2}>
                          <Alert
                            severity={mqttTestResult.success ? 'success' : 'error'}
                            icon={mqttTestResult.success ? <SuccessIcon /> : <ErrorIcon />}
                          >
                            {mqttTestResult.success ? mqttTestResult.message : mqttTestResult.error}
                          </Alert>
                        </Box>
                      )}
                    </Box>
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Notifications Settings */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                  <NotificationsIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">Benachrichtigungen</Typography>
                </Box>

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notifications.email}
                      onChange={(e) => handleNotificationChange('email', e.target.checked)}
                    />
                  }
                  label="E-Mail Benachrichtigungen"
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notifications.push}
                      onChange={(e) => handleNotificationChange('push', e.target.checked)}
                    />
                  }
                  label="Push-Benachrichtigungen"
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.notifications.detectionAlerts}
                      onChange={(e) => handleNotificationChange('detectionAlerts', e.target.checked)}
                    />
                  }
                  label="Vogel-Erkennung Benachrichtigungen"
                />
              </CardContent>
            </Card>
          </Grid>

          {/* System Settings */}
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                  <ThemeIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">System-Einstellungen</Typography>
                </Box>

                <TextField
                  fullWidth
                  label="Auto-Refresh Intervall (Sekunden)"
                  type="number"
                  value={settings.system.autoRefresh}
                  onChange={(e) => handleSystemChange('autoRefresh', parseInt(e.target.value))}
                  margin="normal"
                  inputProps={{ min: 5, max: 60 }}
                  helperText="Wie oft das Dashboard automatisch aktualisiert wird"
                />

                <FormControl fullWidth margin="normal">
                  <InputLabel>Theme</InputLabel>
                  <Select
                    value={settings.system.theme}
                    onChange={(e) => handleSystemChange('theme', e.target.value)}
                    label="Theme"
                  >
                    <MenuItem value="light">Hell</MenuItem>
                    <MenuItem value="dark">Dunkel</MenuItem>
                    <MenuItem value="auto">Automatisch</MenuItem>
                  </Select>
                </FormControl>
              </CardContent>
            </Card>
          </Grid>

          {/* Save Button */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6">Einstellungen speichern</Typography>
                  <Typography variant="body2" color="textSecondary">
                    Änderungen werden sofort übernommen
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  onClick={handleSettingsSave}
                  disabled={saving}
                  startIcon={saving ? <CircularProgress size={20} /> : <SettingsIcon />}
                  size="large"
                >
                  {saving ? 'Speichere...' : 'Einstellungen speichern'}
                </Button>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Weather API Tab */}
      {activeTab === 2 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                  <WeatherIcon sx={{ mr: 1 }} />
                  <Typography variant="h6">Wetter-API Konfiguration</Typography>
                </Box>

                <Alert severity="info" sx={{ mb: 3 }}>
                  <Typography variant="body2">
                    <strong>Für Temperatur-Speicherung:</strong> Konfiguriere eine Wetter-API, um die Temperatur bei jeder Detection automatisch zu speichern. 
                    Die Temperatur wird basierend auf den hier angegebenen Koordinaten abgerufen.
                  </Typography>
                </Alert>

                <FormControlLabel
                  control={
                    <Switch
                      checked={settings.weather.enabled}
                      onChange={(e) => handleWeatherChange('enabled', e.target.checked)}
                    />
                  }
                  label="Wetter-API aktivieren"
                  sx={{ mb: 2 }}
                />

                {settings.weather.enabled && (
                  <>
                    <FormControl fullWidth margin="normal">
                      <InputLabel>Wetter-API Provider</InputLabel>
                      <Select
                        value={settings.weather.provider}
                        onChange={(e) => handleWeatherChange('provider', e.target.value)}
                        label="Wetter-API Provider"
                      >
                        <MenuItem value="openweathermap">OpenWeatherMap (kostenlos)</MenuItem>
                        <MenuItem value="weatherapi">WeatherAPI.com (kostenlos)</MenuItem>
                      </Select>
                    </FormControl>

                    <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                      <Typography variant="body2">
                        {settings.weather.provider === 'openweathermap' ? (
                          <>Kostenloser API-Key auf <strong>openweathermap.org</strong> verfügbar. 60 Requests/Minute im kostenlosen Plan.</>
                        ) : (
                          <>Kostenloser API-Key auf <strong>weatherapi.com</strong> verfügbar. 1 Million Requests/Monat im kostenlosen Plan.</>
                        )}
                      </Typography>
                    </Alert>

                    <TextField
                      fullWidth
                      label="API Key"
                      type="password"
                      value={settings.weather.apiKey}
                      onChange={(e) => handleWeatherChange('apiKey', e.target.value)}
                      margin="normal"
                      placeholder="Dein API Key"
                      helperText={
                        settings.weather.provider === 'openweathermap' 
                          ? "Kostenloser Key auf openweathermap.org"
                          : "Kostenloser Key auf weatherapi.com"
                      }
                    />

                    <Divider sx={{ my: 3 }} />

                    <Box display="flex" alignItems="center" mb={2}>
                      <LocationIcon sx={{ mr: 1, fontSize: 24 }} />
                      <Typography variant="h6">Standort für Temperaturabfrage</Typography>
                    </Box>

                    {/* Standort-Suche */}
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>
                        Standort automatisch ermitteln:
                      </Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12} sm={8}>
                          <TextField
                            fullWidth
                            label="Stadt oder Adresse suchen"
                            value={locationSearchQuery}
                            onChange={(e) => setLocationSearchQuery(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                searchLocationByName();
                              }
                            }}
                            placeholder="z.B. Berlin, Deutschland oder Hauptstraße 1, München"
                            InputProps={{
                              startAdornment: (
                                <InputAdornment position="start">
                                  <SearchIcon />
                                </InputAdornment>
                              )
                            }}
                            helperText="Eingabe bestätigen mit Enter oder Button klicken"
                          />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                          <Button
                            fullWidth
                            variant="outlined"
                            onClick={searchLocationByName}
                            disabled={searchingLocation || !locationSearchQuery.trim()}
                            startIcon={searchingLocation ? <CircularProgress size={20} /> : <SearchIcon />}
                            sx={{ height: '56px' }}
                          >
                            {searchingLocation ? 'Suche...' : 'Suchen'}
                          </Button>
                        </Grid>
                        <Grid item xs={12}>
                          <Button
                            fullWidth
                            variant="outlined"
                            color="primary"
                            onClick={getCurrentLocation}
                            disabled={gettingCurrentLocation}
                            startIcon={gettingCurrentLocation ? <CircularProgress size={20} /> : <MyLocationIcon />}
                          >
                            {gettingCurrentLocation ? 'Ermittle Standort...' : 'Aktuellen Standort verwenden'}
                          </Button>
                        </Grid>
                      </Grid>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    {/* Manuelle Koordinaten-Eingabe */}
                    <Typography variant="subtitle2" gutterBottom>
                      Oder manuell eingeben:
                    </Typography>

                    <TextField
                      fullWidth
                      label="Standort Name (optional)"
                      value={settings.weather.location.name}
                      onChange={(e) => handleWeatherLocationChange('name', e.target.value)}
                      margin="normal"
                      placeholder="z.B. Berlin, Deutschland"
                      helperText="Nur zur Anzeige - hilft bei der Identifikation des Standorts"
                    />

                    <Grid container spacing={2} sx={{ mt: 1 }}>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Breitengrad (Latitude)"
                          type="number"
                          value={settings.weather.location.lat || ''}
                          onChange={(e) => handleWeatherLocationChange('lat', parseFloat(e.target.value) || null)}
                          margin="normal"
                          inputProps={{ step: "0.000001", min: -90, max: 90 }}
                          helperText="z.B. 52.5200 für Berlin"
                          required
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          label="Längengrad (Longitude)"
                          type="number"
                          value={settings.weather.location.lng || ''}
                          onChange={(e) => handleWeatherLocationChange('lng', parseFloat(e.target.value) || null)}
                          margin="normal"
                          inputProps={{ step: "0.000001", min: -180, max: 180 }}
                          helperText="z.B. 13.4050 für Berlin"
                          required
                        />
                      </Grid>
                    </Grid>

                    <Box mt={3}>
                      <Button
                        variant="outlined"
                        onClick={testWeatherAPI}
                        disabled={testingWeather || !settings.weather.apiKey || !settings.weather.location.lat || !settings.weather.location.lng}
                        startIcon={testingWeather ? <CircularProgress size={20} /> : <WeatherIcon />}
                        size="large"
                      >
                        {testingWeather ? 'Teste...' : 'Temperatur abrufen (Test)'}
                      </Button>
                      
                      {(!settings.weather.apiKey || !settings.weather.location.lat || !settings.weather.location.lng) && (
                        <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                          API Key und Koordinaten müssen ausgefüllt sein, um die Temperatur abzurufen
                        </Typography>
                      )}

                      {weatherTestResult && (
                        <Box mt={2}>
                          <Alert
                            severity={weatherTestResult.success ? 'success' : 'error'}
                            icon={weatherTestResult.success ? <SuccessIcon /> : <ErrorIcon />}
                          >
                            {weatherTestResult.success ? (
                              <>
                                <Typography variant="body2" fontWeight="bold">
                                  {weatherTestResult.message}
                                </Typography>
                                {weatherTestResult.temperature && (
                                  <Typography variant="body2" sx={{ mt: 1 }}>
                                    Standort: {weatherTestResult.location}
                                  </Typography>
                                )}
                              </>
                            ) : (
                              weatherTestResult.error
                            )}
                          </Alert>
                        </Box>
                      )}
                    </Box>
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Info Card */}
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  ℹ️ Informationen
                </Typography>
                <Typography variant="body2" paragraph>
                  <strong>Wie funktioniert es?</strong>
                </Typography>
                <Typography variant="body2" paragraph>
                  Wenn die Wetter-API aktiviert ist, wird bei jeder Detection automatisch die aktuelle Temperatur 
                  für den konfigurierten Standort abgerufen und mit der Detection gespeichert.
                </Typography>
                <Typography variant="body2" paragraph>
                  <strong>Warum wird die Temperatur gespeichert?</strong>
                </Typography>
                <Typography variant="body2" paragraph>
                  Die Temperatur kann später für Analysen verwendet werden, z.B. um zu sehen, 
                  bei welchen Temperaturen die meisten Vögel erkannt werden.
                </Typography>
                <Typography variant="body2" paragraph>
                  <strong>API-Limits:</strong>
                </Typography>
                <Typography variant="body2">
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    <li>OpenWeatherMap: 60 Requests/Minute</li>
                    <li>WeatherAPI.com: 1 Million Requests/Monat</li>
                  </ul>
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Save Button */}
          <Grid item xs={12}>
            <Paper sx={{ p: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6">Einstellungen speichern</Typography>
                  <Typography variant="body2" color="textSecondary">
                    Änderungen werden sofort übernommen
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  onClick={handleSettingsSave}
                  disabled={saving}
                  startIcon={saving ? <CircularProgress size={20} /> : <SettingsIcon />}
                  size="large"
                >
                  {saving ? 'Speichere...' : 'Einstellungen speichern'}
                </Button>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}
    </Container>
  );
};

export default Profile;