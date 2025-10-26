import { useState } from 'react';
import axios from 'axios';

const API_URL = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) || '';

/**
 * Custom Hook für Route-Management
 * Gemeinsam genutzt von Devices.js und DeviceDetail.js
 */
export const useRouteManagement = (deviceId) => {
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

  const resetNewCoordinate = () => {
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
    
    resetNewCoordinate();
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
      resetNewCoordinate();
    }
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    resetNewCoordinate();
  };

  const handleUpdateImage = async (index) => {
    console.log('🔧 handleUpdateImage called with index:', index);
    console.log('🔧 API_URL:', API_URL);
    console.log('🔧 Device ID:', deviceId);
    console.log('🔧 Token exists:', !!localStorage.getItem('token'));
    
    setUpdatingImages(prev => new Set(prev).add(index));
    
    try {
      console.log(`Updating image for coordinate ${index}`);
      
      const url = `${API_URL}/api/devices/${deviceId}/update-route-image/${index}`;
      console.log('Calling API:', url);
      
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
        return { success: true, message: 'Bild erfolgreich aktualisiert!' };
      }
    } catch (error) {
      console.error('❌ Error updating image:', error);
      console.error('❌ Error response:', error.response?.data);
      console.error('❌ Error status:', error.response?.status);
      return { 
        success: false, 
        message: `Fehler beim Aktualisieren des Bildes: ${error.response?.data?.message || error.response?.data?.error || error.message}` 
      };
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

  const fetchActionsConfig = async () => {
    try {
      const response = await axios.get(`/api/devices/${deviceId}/actions`);
      setActionsConfig(response.data);
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error fetching actions config:', error);
      return { success: false, error };
    }
  };

  const saveActionsConfig = async () => {
    try {
      console.log('Saving actions config:', actionsConfig);
      const response = await axios.put(`/api/devices/${deviceId}/actions`, actionsConfig);
      console.log('Save response:', response.data);
      return { success: true, message: 'Route-Konfiguration gespeichert' };
    } catch (error) {
      console.error('Error saving actions config:', error);
      console.error('Error response:', error.response?.data);
      
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          'Fehler beim Speichern der Route-Konfiguration';
      return { success: false, message: errorMessage };
    }
  };

  return {
    // State
    actionsConfig,
    setActionsConfig,
    newCoordinate,
    setNewCoordinate,
    editingIndex,
    updatingImages,
    
    // Handlers
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
    resetNewCoordinate
  };
};

