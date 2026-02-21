import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) || '';

/**
 * Custom Hook für Route-Management
 * Gemeinsam genutzt von Devices.js und DeviceDetail.js
 */
export const useRouteManagement = (deviceId) => {
  const getDefaultActionsConfig = () => ({
    mode: 'impulse',
    route: { coordinates: [] }
  });
  const getDefaultCoordinate = () => ({
    rotation: 90,
    tilt: 90,
    order: 0,
    zoom: 1
  });

  const [actionsConfig, setActionsConfig] = useState(getDefaultActionsConfig);
  const [newCoordinate, setNewCoordinate] = useState(getDefaultCoordinate);
  const [editingIndex, setEditingIndex] = useState(null);
  const [updatingImages, setUpdatingImages] = useState(new Set());
  const [previewImage, setPreviewImage] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [stitchingInProgress, setStitchingInProgress] = useState(false);
  const [stitchingError, setStitchingError] = useState(null);
  const [panoramaImage, setPanoramaImage] = useState(null);
  const [panoramaStatistics, setPanoramaStatistics] = useState(null);
  const [panoramaTransformationMatrices, setPanoramaTransformationMatrices] = useState(null);
  const [panoramaImageSizes, setPanoramaImageSizes] = useState(null);

  const resetNewCoordinate = () => {
    setNewCoordinate(getDefaultCoordinate());
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

  const clearPreview = () => {
    setPreviewImage(null);
    setPreviewError(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    resetNewCoordinate();
    clearPreview();
  };

  useEffect(() => {
    setActionsConfig(getDefaultActionsConfig());
    setNewCoordinate(getDefaultCoordinate());
    setEditingIndex(null);
    setUpdatingImages(new Set());
    clearPreview();
  }, [deviceId]);

  const resolveDeviceId = (overrideId) => overrideId ?? deviceId;

  const handleUpdateImage = async (index, targetDeviceId) => {
    const currentDeviceId = resolveDeviceId(targetDeviceId);
    if (!currentDeviceId) {
      return { success: false, message: 'Kein Gerät ausgewählt' };
    }

    console.log('🔧 handleUpdateImage called with index:', index);
    console.log('🔧 API_URL:', API_URL);
    console.log('🔧 Device ID:', currentDeviceId);
    console.log('🔧 Token exists:', !!localStorage.getItem('access_token'));
    
    setUpdatingImages(prev => new Set(prev).add(index));
    
    try {
      console.log(`Updating image for coordinate ${index}`);
      
      const url = `${API_URL}/api/devices/${currentDeviceId}/update-route-image/${index}`;
      console.log('Calling API:', url);
      
      const response = await axios.post(
        url,
        {},
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
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

  const handlePreviewCoordinate = async (targetDeviceId, coordinateOverride) => {
    const currentDeviceId = resolveDeviceId(targetDeviceId);
    if (!currentDeviceId) {
      const message = 'Kein Gerät ausgewählt';
      setPreviewError(message);
      return { success: false, message };
    }

    const coordinate = coordinateOverride || newCoordinate;

    const payload = {
      rotation: Number(coordinate.rotation) || 0,
      tilt: Number(coordinate.tilt) || 0,
      zoom: Number(coordinate.zoom) || 1
    };

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const response = await axios.post(`/api/devices/${currentDeviceId}/preview-route-coordinate`, payload);
      if (response.data?.image) {
        setPreviewImage(response.data.image);
        return { success: true, image: response.data.image };
      }
      throw new Error('Kein Vorschaubild erhalten');
    } catch (error) {
      console.error('Error fetching preview image:', error);
      const message = error.response?.data?.message || error.response?.data?.error || error.message;
      setPreviewError(message);
      return { success: false, message };
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleUpdateAllImages = async (targetDeviceId) => {
    const currentDeviceId = resolveDeviceId(targetDeviceId);
    if (!currentDeviceId) {
      return { success: false, message: 'Kein Gerät ausgewählt' };
    }

    const allIndices = actionsConfig.route.coordinates.map((_, index) => index);
    setUpdatingImages(new Set(allIndices));

    console.log(`Updating all images for device ${currentDeviceId}`);
    
    try {
      for (const index of allIndices) {
        await handleUpdateImage(index, currentDeviceId);
      }
      return { success: true };
    } catch (error) {
      console.error('Error updating all images:', error);
      return { success: false, message: error.message };
    } finally {
      setUpdatingImages(new Set());
    }
  };

  const fetchActionsConfig = async (targetDeviceId) => {
    const currentDeviceId = resolveDeviceId(targetDeviceId);
    if (!currentDeviceId) {
      return { success: false, message: 'Kein Gerät ausgewählt' };
    }

    try {
      const response = await axios.get(`/api/devices/${currentDeviceId}/actions`);
      setActionsConfig(response.data);
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error fetching actions config:', error);
      return { success: false, message: error.message, error };
    }
  };

  const saveActionsConfig = async (targetDeviceId) => {
    const currentDeviceId = resolveDeviceId(targetDeviceId);
    if (!currentDeviceId) {
      return { success: false, message: 'Kein Gerät ausgewählt' };
    }

    try {
      console.log('Saving actions config:', actionsConfig);
      const response = await axios.put(`/api/devices/${currentDeviceId}/actions`, actionsConfig);
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

  const handleStitchPanorama = async (targetDeviceId, showBorders = false) => {
    const currentDeviceId = resolveDeviceId(targetDeviceId);
    if (!currentDeviceId) {
      return { success: false, message: 'Kein Gerät ausgewählt' };
    }

    setStitchingInProgress(true);
    setStitchingError(null);
    setPanoramaImage(null);
    setPanoramaStatistics(null);
    setPanoramaTransformationMatrices(null);
    setPanoramaImageSizes(null);

    try {
      const coordinates = actionsConfig.route.coordinates || [];
      const imagesWithUrls = coordinates.filter(coord => coord.image);
      
      if (imagesWithUrls.length < 2) {
        const errorMsg = 'Mindestens 2 Koordinaten mit Bildern werden benötigt';
        setStitchingError(errorMsg);
        return { success: false, message: errorMsg };
      }

      const url = `${API_URL}/api/devices/${currentDeviceId}/stitch-panorama`;
      const response = await axios.post(
        url,
        { show_borders: showBorders },
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
          },
          timeout: 120000 // 2 Minuten
        }
      );

      if (response.data.success) {
        setPanoramaImage(response.data.panorama_url);
        if (response.data.statistics) {
          setPanoramaStatistics(response.data.statistics);
        }
        if (response.data.transformation_matrices) {
          setPanoramaTransformationMatrices(response.data.transformation_matrices);
        }
        if (response.data.image_sizes) {
          setPanoramaImageSizes(response.data.image_sizes);
        }
        if (response.data.warnings) {
          return { 
            success: true, 
            message: 'Panorama erstellt, aber einige Bilder konnten nicht geladen werden',
            warnings: response.data.warnings,
            statistics: response.data.statistics
          };
        } else {
          return { 
            success: true, 
            message: 'Panorama erfolgreich erstellt!',
            statistics: response.data.statistics
          };
        }
      } else {
        const errorMsg = response.data.error || 'Fehler beim Erstellen des Panoramas';
        setStitchingError(errorMsg);
        return { success: false, message: errorMsg };
      }
    } catch (error) {
      let errorMessage = 'Fehler beim Erstellen des Panoramas';
      
      if (error.response?.data) {
        const errorData = error.response.data;
        errorMessage = errorData.error || errorMessage;
        
        // Spezifische Fehlermeldungen
        switch (errorData.error_code) {
          case 'INSUFFICIENT_COORDINATES':
            errorMessage = 'Mindestens 2 Koordinaten mit Bildern werden benötigt';
            break;
          case 'MISSING_IMAGES':
            errorMessage = `${errorData.missing_count} Koordinaten haben keine Bilder. Bitte aktualisiere die Bilder zuerst.`;
            break;
          case 'STITCH_STATUS_1':
            errorMessage = 'Bilder überlappen nicht genug für ein Panorama';
            break;
          case 'STITCH_STATUS_2':
            errorMessage = 'Kamera-Parameter konnten nicht angepasst werden';
            break;
          case 'CV_SERVICE_UNAVAILABLE':
            errorMessage = 'Computer Vision Service ist nicht verfügbar';
            break;
          case 'STITCHING_TIMEOUT':
            errorMessage = 'Stitching-Prozess hat zu lange gedauert. Versuche es mit weniger Bildern.';
            break;
          default:
            break;
        }
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Zeitüberschreitung beim Erstellen des Panoramas';
      }
      
      setStitchingError(errorMessage);
      return { success: false, message: errorMessage };
    } finally {
      setStitchingInProgress(false);
    }
  };

  const handleSavePanorama = async (targetDeviceId) => {
    const currentDeviceId = resolveDeviceId(targetDeviceId);
    if (!currentDeviceId) {
      return { success: false, message: 'Kein Gerät ausgewählt' };
    }

    if (!panoramaImage) {
      return { success: false, message: 'Kein Panorama vorhanden' };
    }

    try {
      const url = `${API_URL}/api/devices/${currentDeviceId}/save-panorama`;
      const response = await axios.post(
        url,
        {
          panorama_url: panoramaImage,
          transformation_matrices: panoramaTransformationMatrices || [],
          image_sizes: panoramaImageSizes || [],
          statistics: panoramaStatistics || null
        },
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
          }
        }
      );

      if (response.data.success) {
        return { 
          success: true, 
          message: 'Panorama erfolgreich gespeichert'
        };
      } else {
        return { 
          success: false, 
          message: response.data.error || 'Fehler beim Speichern des Panoramas'
        };
      }
    } catch (error) {
      let errorMessage = 'Fehler beim Speichern des Panoramas';
      
      if (error.response?.data) {
        const errorData = error.response.data;
        errorMessage = errorData.error || errorMessage;
      }
      
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
    previewImage,
    previewLoading,
    previewError,
    stitchingInProgress,
    stitchingError,
    panoramaImage,
    panoramaStatistics,
    panoramaTransformationMatrices,
    panoramaImageSizes,
    
    // Handlers
    handleModeChange,
    handleAddCoordinate,
    handleRemoveCoordinate,
    handleEditCoordinate,
    handleUpdateCoordinate,
    handleCancelEdit,
    handleUpdateImage,
    handleUpdateAllImages,
    handlePreviewCoordinate,
    fetchActionsConfig,
    saveActionsConfig,
    resetNewCoordinate,
    clearPreview,
    setEditingIndex,
    handleStitchPanorama,
    handleSavePanorama
  };
};

