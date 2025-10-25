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
  MenuItem
} from '@mui/material';
import {
  Person as PersonIcon,
  Settings as SettingsIcon,
  Wifi as MqttIcon,
  Notifications as NotificationsIcon,
  Palette as ThemeIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon
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
    }
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [mqttTestResult, setMqttTestResult] = useState(null);

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
      setSettings(response.data);
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
    </Container>
  );
};

export default Profile;