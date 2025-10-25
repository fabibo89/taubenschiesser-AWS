/**
 * Route Utilities - Gemeinsame Funktionen für Route-Management
 */

/**
 * Berechnet die Position eines Koordinaten-Punkts im Route-Diagramm
 * @param {Object} coord - Koordinate mit rotation, tilt, zoom
 * @returns {Object} - { xPercent, yPercent }
 */
export const calculateRoutePosition = (coord) => {
  const { rotation, tilt } = coord;
  
  // Winkel in Radiant umrechnen
  const angle = (rotation * Math.PI) / 180;
  
  // Tilt-Faktor berechnen (0 bis 1)
  const tiltFactor = (tilt + 180) / 360;
  
  // Radius in Prozent
  const radiusPercentX = tiltFactor * 48; // 0 bis 48% der Breite
  const radiusPercentY = tiltFactor * 80; // 0 bis 80% der Höhe
  
  // Position berechnen
  const xPercent = 50 - (radiusPercentX * Math.cos(angle)); // 50% ± radius%
  const yPercent = 10 + (radiusPercentY * Math.sin(angle)); // 10% ± radius%
  
  return { xPercent, yPercent };
};

/**
 * Berechnet die Position für Verbindungslinien zwischen Punkten
 * @param {Object} currentCoord - Aktuelle Koordinate
 * @param {Object} nextCoord - Nächste Koordinate
 * @returns {Object} - { x1, y1, x2, y2 }
 */
export const calculateConnectionLine = (currentCoord, nextCoord) => {
  const currentPos = calculateRoutePosition(currentCoord);
  const nextPos = calculateRoutePosition(nextCoord);
  
  return {
    x1: currentPos.xPercent,
    y1: currentPos.yPercent,
    x2: nextPos.xPercent,
    y2: nextPos.yPercent
  };
};

/**
 * Validiert eine Koordinate
 * @param {Object} coord - Koordinate zum Validieren
 * @returns {Object} - { isValid, errors }
 */
export const validateCoordinate = (coord) => {
  const errors = [];
  
  if (coord.rotation < 0 || coord.rotation > 360) {
    errors.push('Rotation muss zwischen 0° und 360° liegen');
  }
  
  if (coord.tilt < -180 || coord.tilt > 180) {
    errors.push('Kippung muss zwischen -180° und 180° liegen');
  }
  
  if (coord.zoom < 1 || coord.zoom > 3) {
    errors.push('Zoom muss zwischen 1x und 3x liegen');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Sortiert Koordinaten nach der order-Eigenschaft
 * @param {Array} coordinates - Array von Koordinaten
 * @returns {Array} - Sortierte Koordinaten
 */
export const sortCoordinatesByOrder = (coordinates) => {
  return [...coordinates].sort((a, b) => a.order - b.order);
};

/**
 * Erstellt eine neue Koordinate mit Standardwerten
 * @param {number} order - Reihenfolge der Koordinate
 * @returns {Object} - Neue Koordinate
 */
export const createNewCoordinate = (order = 0) => {
  return {
    rotation: 0,
    tilt: 0,
    order: order,
    zoom: 1
  };
};

/**
 * Aktualisiert die Reihenfolge aller Koordinaten
 * @param {Array} coordinates - Array von Koordinaten
 * @returns {Array} - Koordinaten mit aktualisierter Reihenfolge
 */
export const updateCoordinateOrder = (coordinates) => {
  return coordinates.map((coord, index) => ({
    ...coord,
    order: index
  }));
};

/**
 * Entfernt eine Koordinate und aktualisiert die Reihenfolge
 * @param {Array} coordinates - Array von Koordinaten
 * @param {number} index - Index der zu entfernenden Koordinate
 * @returns {Array} - Koordinaten ohne die entfernte Koordinate
 */
export const removeCoordinate = (coordinates, index) => {
  const newCoordinates = coordinates.filter((_, i) => i !== index);
  return updateCoordinateOrder(newCoordinates);
};

/**
 * Fügt eine neue Koordinate hinzu
 * @param {Array} coordinates - Array von Koordinaten
 * @param {Object} newCoord - Neue Koordinate
 * @returns {Array} - Koordinaten mit der neuen Koordinate
 */
export const addCoordinate = (coordinates, newCoord) => {
  const newCoordinates = [...coordinates, { ...newCoord, order: coordinates.length }];
  return updateCoordinateOrder(newCoordinates);
};

/**
 * Aktualisiert eine bestehende Koordinate
 * @param {Array} coordinates - Array von Koordinaten
 * @param {number} index - Index der zu aktualisierenden Koordinate
 * @param {Object} updatedCoord - Aktualisierte Koordinate
 * @returns {Array} - Koordinaten mit der aktualisierten Koordinate
 */
export const updateCoordinate = (coordinates, index, updatedCoord) => {
  const newCoordinates = [...coordinates];
  newCoordinates[index] = { ...updatedCoord, order: index };
  return updateCoordinateOrder(newCoordinates);
};
