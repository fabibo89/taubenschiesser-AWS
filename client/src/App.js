import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import Devices from './components/Devices';
import DeviceDetail from './components/DeviceDetail';
import Detections from './components/Detections';
import TaubenTinder from './components/TaubenTinder';
import ImageUpload from './components/ImageUpload';
import Profile from './components/Profile';
import HardwareMonitor from './components/HardwareMonitor';
import PositionPreview from './components/PositionPreview';
import RouteDetections from './components/RouteDetections';
import PanoramaScan from './components/PanoramaScan';
import Layout from './components/Layout';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    );
  }

  return (
    <SocketProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/devices" element={<Devices />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/detections" element={<Detections />} />
          <Route path="/tauben-tinder" element={<TaubenTinder />} />
          <Route path="/upload" element={<ImageUpload />} />
          <Route path="/monitor" element={<HardwareMonitor />} />
          <Route path="/position-preview" element={<PositionPreview />} />
          <Route path="/route-detections" element={<RouteDetections />} />
          <Route path="/panorama" element={<PanoramaScan />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </SocketProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
