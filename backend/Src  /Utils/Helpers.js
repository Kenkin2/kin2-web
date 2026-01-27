const crypto = require('crypto');
const { format, formatDistance, formatRelative, subDays } = require('date-fns');

const helpers = {
  // Generate unique ID
  generateId: (prefix = '') => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}${timestamp}${random}`;
  },

  // Generate random string
  generateRandomString: (length = 10) => {
    return crypto.randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  },

  // Generate slug from string
  generateSlug: (text) => {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-')     // Replace spaces with hyphens
      .replace(/-+/g, '-')      // Replace multiple hyphens with single
      .trim();
  },

  // Format currency
  formatCurrency: (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  },

  // Format date
  formatDate: (date, formatStr = 'PP') => {
    if (!date) return 'N/A';
    return format(new Date(date), formatStr);
  },

  // Format relative date (e.g., "2 days ago")
  formatRelativeDate: (date) => {
    if (!date) return 'N/A';
    return formatDistance(new Date(date), new Date(), { addSuffix: true });
  },

  // Calculate age from birth date
  calculateAge: (birthDate) => {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    
    return age;
  },

  // Calculate experience in years
  calculateExperienceYears: (startDate, endDate = null) => {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    
    const years = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
    return Math.round(years * 10) / 10; // Round to 1 decimal
  },

  // Calculate percentage
  calculatePercentage: (value, total) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  },

  // Truncate text with ellipsis
  truncateText: (text, maxLength = 100) => {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength) + '...';
  },

  // Extract keywords from text
  extractKeywords: (text, limit = 10) => {
    const words = text.toLowerCase().split(/\W+/);
    const wordCount = {};
    
    words.forEach(word => {
      if (word.length > 3) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }
    });
    
    return Object.entries(wordCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([word]) => word);
  },

  // Calculate distance between coordinates (Haversine formula)
  calculateDistance: (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.P
