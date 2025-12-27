import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const access_token = localStorage.getItem('access_token');
    if (access_token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async () => {
    try {
      const response = await axios.get('/api/auth/me');
      setUser(response.data);
    } catch (error) {
      // Try to refresh token if we have a refresh token
      const refresh_token = localStorage.getItem('refresh_token');
      if (refresh_token && error.response?.status === 401) {
        try {
          const refreshResponse = await axios.post('/api/auth/refresh', { refresh_token });
          const { access_token: new_access_token, refresh_token: new_refresh_token } = refreshResponse.data;
          
          localStorage.setItem('access_token', new_access_token);
          if (new_refresh_token) {
            localStorage.setItem('refresh_token', new_refresh_token);
          }
          
          axios.defaults.headers.common['Authorization'] = `Bearer ${new_access_token}`;
          
          // Retry fetching user
          const retryResponse = await axios.get('/api/auth/me');
          setUser(retryResponse.data);
        } catch (refreshError) {
          // Refresh failed, clear tokens and logout
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          delete axios.defaults.headers.common['Authorization'];
        }
      } else {
        // No refresh token or other error
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        delete axios.defaults.headers.common['Authorization'];
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const response = await axios.post('/api/auth/login', { email, password });
      const { access_token, refresh_token, user } = response.data;
      
      localStorage.setItem('access_token', access_token);
      if (refresh_token) {
        localStorage.setItem('refresh_token', refresh_token);
      }
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      setUser(user);
      
      toast.success('Erfolgreich angemeldet!');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.error || 'Anmeldung fehlgeschlagen';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const register = async (username, email, password) => {
    try {
      const response = await axios.post('/api/auth/register', {
        username,
        email,
        password
      });
      const { access_token, refresh_token, user } = response.data;
      
      localStorage.setItem('access_token', access_token);
      if (refresh_token) {
        localStorage.setItem('refresh_token', refresh_token);
      }
      axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
      setUser(user);
      
      toast.success('Registrierung erfolgreich!');
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.error || 'Registrierung fehlgeschlagen';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
    toast.info('Abgemeldet');
  };

  const updateUser = (updatedUser) => {
    setUser(updatedUser);
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
