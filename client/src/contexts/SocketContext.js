import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Socket.IO URL-Konfiguration:
    // - Nutze immer relativen Pfad (undefined = Socket.IO nutzt window.location.origin)
    // - Funktioniert lokal: React Dev Server Proxy leitet /socket.io/ an localhost:5001 weiter
    // - Funktioniert in Docker: Nginx Proxy leitet /socket.io/ an api:5000 weiter
    // - Keine explizite URL nötig, da beide Umgebungen Proxy verwenden
    const socketUrl = undefined; // Relativer Pfad - funktioniert in allen Umgebungen
    
    const newSocket = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const joinDeviceRoom = (deviceId) => {
    if (socket) {
      socket.emit('join-device', deviceId);
    }
  };

  const leaveDeviceRoom = (deviceId) => {
    if (socket) {
      socket.emit('leave-device', deviceId);
    }
  };

  const value = {
    socket,
    connected,
    joinDeviceRoom,
    leaveDeviceRoom
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};
