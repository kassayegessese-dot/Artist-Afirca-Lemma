// api.js - Add to your frontend
const API_BASE = typeof window !== 'undefined' && window.location && window.location.origin
  ? `${window.location.origin}/api`
  : 'http://localhost:5000/api';

const api = {
  async fetchWithAuth(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });
    
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || 'API request failed');
    }
    return data;
  },

  // Auth
  async login(email, password) {
    const data = await this.fetchWithAuth('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
    }
    return data;
  },

  // Media
  async getMedia(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.fetchWithAuth(`/media?${query}`);
  },

  async uploadMedia(formData) {
    const token = localStorage.getItem('token');
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE}/media/public`, {
      method: 'POST',
      headers,
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    return data;
  },

  async deleteMedia(id) {
    return this.fetchWithAuth(`/media/${id}`, {
      method: 'DELETE'
    });
  },

  async getMediaStats() {
    return this.fetchWithAuth('/media/stats/all');
  },

  // Contact
  async sendContact(formData) {
    return this.fetchWithAuth('/contact', {
      method: 'POST',
      body: JSON.stringify(formData)
    });
  }
};