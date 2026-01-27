  // Calculate distance between coordinates (Haversine formula) - CONTINUED
  calculateDistance: (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance; // in kilometers
  },

  // Format distance in a human-readable way
  formatDistance: (distanceInKm) => {
    if (distanceInKm < 1) {
      return Math.round(distanceInKm * 1000) + ' m';
    } else {
      return Math.round(distanceInKm * 10) / 10 + ' km';
    }
  },

  // Calculate KFN score (simplified, actual calculation is in kfn.service.js)
  calculateKFN: (skillsMatch, experienceMatch, locationMatch, availabilityMatch, educationMatch, culturalMatch) => {
    // This is a simplified version. The actual calculation is more complex and done in kfn.service.js
    const weights = {
      skills: 0.3,
      experience: 0.25,
      location: 0.15,
      availability: 0.15,
      education: 0.1,
      cultural: 0.05
    };

    return (
      skillsMatch * weights.skills +
      experienceMatch * weights.experience +
      locationMatch * weights.location +
      availabilityMatch * weights.availability +
      educationMatch * weights.education +
      culturalMatch * weights.cultural
    ) * 100;
  },

  // Generate a random color (for UI purposes)
  generateRandomColor: () => {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  },

  // Convert a string to title case
  toTitleCase: (str) => {
    return str.replace(
      /\w\S*/g,
      (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  },

  // Parse a string into an integer, with default value
  parseIntWithDefault: (str, defaultValue = 0) => {
    const num = parseInt(str, 10);
    return isNaN(num) ? defaultValue : num;
  },

  // Parse a string into a float, with default value
  parseFloatWithDefault: (str, defaultValue = 0.0) => {
    const num = parseFloat(str);
    return isNaN(num) ? defaultValue : num;
  },

  // Check if a string is a valid JSON
  isValidJSON: (str) => {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  },

  // Deep clone an object (simple, for JSON-safe objects)
  deepClone: (obj) => {
    return JSON.parse(JSON.stringify(obj));
  },

  // Merge two objects (shallow merge)
  mergeObjects: (obj1, obj2) => {
    return { ...obj1, ...obj2 };
  },

  // Remove null/undefined properties from an object
  removeNullUndefined: (obj) => {
    const newObj = {};
    Object.keys(obj).forEach(key => {
      if (obj[key] != null) {
        newObj[key] = obj[key];
      }
    });
    return newObj;
  },

  // Debounce function (for limiting the rate of function calls)
  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function (for limiting the rate of function calls)
  throttle: (func, limit) => {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  // Capitalize the first letter of a string
  capitalizeFirstLetter: (string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  },

  // Convert a string to camelCase
  toCamelCase: (str) => {
    return str.replace(/([-_][a-z])/ig, ($1) => {
      return $1.toUpperCase().replace('-', '').replace('_', '');
    });
  },

  // Convert a string to snake_case
  toSnakeCase: (str) => {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '');
  },

  // Convert a string to kebab-case
  toKebabCase: (str) => {
    return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, '');
  },

  // Check if an object is empty
  isEmptyObject: (obj) => {
    return Object.keys(obj).length === 0 && obj.constructor === Object;
  },

  // Check if an array is empty
  isEmptyArray: (arr) => {
    return Array.isArray(arr) && arr.length === 0;
  },

  // Check if a value is a number
  isNumber: (value) => {
    return typeof value === 'number' && !isNaN(value);
  },

  // Check if a value is a string
  isString: (value) => {
    return typeof value === 'string';
  },

  // Check if a value is an object
  isObject: (value) => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  },

  // Check if a value is an array
  isArray: (value) => {
    return Array.isArray(value);
  },

  // Check if a value is a function
  isFunction: (value) => {
    return typeof value === 'function';
  },

  // Check if a value is a boolean
  isBoolean: (value) => {
    return typeof value === 'boolean';
  },

  // Check if a value is null or undefined
  isNullOrUndefined: (value) => {
    return value === null || value === undefined;
  },

  // Sleep function (delay)
  sleep: (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // Generate a random number within a range
  randomInRange: (min, max) => {
    return Math.random() * (max - min) + min;
  },

  // Generate a random integer within a range
  randomIntInRange: (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  // Generate a random boolean
  randomBoolean: () => {
    return Math.random() >= 0.5;
  },

  // Generate a random item from an array
  randomItem: (array) => {
    return array[Math.floor(Math.random() * array.length)];
  },

  // Shuffle an array (Fisher-Yates shuffle)
  shuffleArray: (array) => {
    let currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;

      // And swap it with the current element.
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
    }

    return array;
  },

  // Remove duplicates from an array
  removeDuplicates: (array) => {
    return [...new Set(array)];
  },

  // Flatten a nested array
  flattenArray: (array) => {
    return array.reduce((flat, toFlatten) => {
      return flat.concat(Array.isArray(toFlatten) ? helpers.flattenArray(toFlatten) : toFlatten);
    }, []);
  },

  // Group an array of objects by a key
  groupBy: (array, key) => {
    return array.reduce((result, currentValue) => {
      (result[currentValue[key]] = result[currentValue[key]] || []).push(currentValue);
      return result;
    }, {});
  },

  // Sort an array of objects by a key
  sortBy: (array, key, order = 'asc') => {
    return array.sort((a, b) => {
      if (a[key] < b[key]) return order === 'asc' ? -1 : 1;
      if (a[key] > b[key]) return order === 'asc' ? 1 : -1;
      return 0;
    });
  },

  // Get the current timestamp in seconds
  getTimestamp: () => {
    return Math.floor(Date.now() / 1000);
  },

  // Convert a timestamp to a date string
  timestampToDate: (timestamp) => {
    return new Date(timestamp * 1000).toISOString();
  },

  // Convert a date string to a timestamp
  dateToTimestamp: (dateString) => {
    return Math.floor(new Date(dateString).getTime() / 1000);
  },

  // Get the current date and time in ISO format
  getCurrentDateTime: () => {
    return new Date().toISOString();
  },

  // Get the current date in YYYY-MM-DD format
  getCurrentDate: () => {
    return new Date().toISOString().split('T')[0];
  },

  // Get the current time in HH:MM:SS format
  getCurrentTime: () => {
    return new Date().toTimeString().split(' ')[0];
  },

  // Add days to a date
  addDays: (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  },

  // Subtract days from a date
  subtractDays: (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
  },

  // Add months to a date
  addMonths: (date, months) => {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  },

  // Subtract months from a date
  subtractMonths: (date, months) => {
    const result = new Date(date);
    result.setMonth(result.getMonth() - months);
    return result;
  },

  // Add years to a date
  addYears: (date, years) => {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() + years);
    return result;
  },

  // Subtract years from a date
  subtractYears: (date, years) => {
    const result = new Date(date);
    result.setFullYear(result.getFullYear() - years);
    return result;
  },

  // Get the difference between two dates in days
  getDateDifferenceInDays: (date1, date2) => {
    const timeDiff = Math.abs(new Date(date2) - new Date(date1));
    return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  },

  // Get the difference between two dates in months
  getDateDifferenceInMonths: (date1, date2) => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    let months;
    months = (d2.getFullYear() - d1.getFullYear()) * 12;
    months -= d1.getMonth();
    months += d2.getMonth();
    return months <= 0 ? 0 : months;
  },

  // Get the difference between two dates in years
  getDateDifferenceInYears: (date1, date2) => {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    let years = d2.getFullYear() - d1.getFullYear();
    const m = d2.getMonth() - d1.getMonth();
    if (m < 0 || (m === 0 && d2.getDate() < d1.getDate())) {
      years--;
    }
    return years;
  },

  // Check if a year is a leap year
  isLeapYear: (year) => {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  },

  // Get the number of days in a month
  getDaysInMonth: (year, month) => {
    return new Date(year, month, 0).getDate();
  },

  // Get the day of the week for a given date
  getDayOfWeek: (date) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date(date).getDay()];
  },

  // Get the month name for a given date
  getMonthName: (date) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[new Date(date).getMonth()];
  },

  // Get the quarter for a given date
  getQuarter: (date) => {
    const month = new Date(date).getMonth();
    return Math.floor(month / 3) + 1;
  },

  // Get the week number for a given date
  getWeekNumber: (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  },

  // Get the age category based on age
  getAgeCategory: (age) => {
    if (age < 18) return 'Under 18';
    if (age >= 18 && age <= 24) return '18-24';
    if (age >= 25 && age <= 34) return '25-34';
    if (age >= 35 && age <= 44) return '35-44';
    if (age >= 45 && age <= 54) return '45-54';
    if (age >= 55 && age <= 64) return '55-64';
    return '65+';
  },

  // Get the experience category based on years of experience
  getExperienceCategory: (years) => {
    if (years < 1) return 'Less than 1 year';
    if (years >= 1 && years <= 3) return '1-3 years';
    if (years >= 4 && years <= 7) return '4-7 years';
    if (years >= 8 && years <= 10) return '8-10 years';
    return 'More than 10 years';
  },

  // Get the salary range based on salary
  getSalaryRange: (salary) => {
    if (salary < 30000) return 'Under $30,000';
    if (salary >= 30000 && salary < 50000) return '$30,000 - $49,999';
    if (salary >= 50000 && salary < 70000) return '$50,000 - $69,999';
    if (salary >= 70000 && salary < 90000) return '$70,000 - $89,999';
    if (salary >= 90000 && salary < 110000) return '$90,000 - $109,999';
    if (salary >= 110000 && salary < 130000) return '$110,000 - $129,999';
    if (salary >= 130000 && salary < 150000) return '$130,000 - $149,999';
    return '$150,000+';
  },

  // Get the company size category based on number of employees
  getCompanySizeCategory: (size) => {
    if (size < 10) return '1-9 employees';
    if (size >= 10 && size <= 49) return '10-49 employees';
    if (size >= 50 && size <= 199) return '50-199 employees';
    if (size >= 200 && size <= 499) return '200-499 employees';
    if (size >= 500 && size <= 999) return '500-999 employees';
    if (size >= 1000 && size <= 4999) return '1000-4999 employees';
    return '5000+ employees';
  },

  // Get the job level based on experience and title
  getJobLevel: (experience, title) => {
    const titleLower = title.toLowerCase();
    if (titleLower.includes('intern') || titleLower.includes('trainee')) {
      return 'Intern/Trainee';
    } else if (titleLower.includes('junior') || experience <= 2) {
      return 'Junior';
    } else if (titleLower.includes('senior') || experience >= 5) {
      return 'Senior';
    } else if (titleLower.includes('lead') || titleLower.includes('manager')) {
      return 'Lead/Manager';
    } else if (titleLower.includes('director') || titleLower.includes('head')) {
      return 'Director/Head';
    } else if (titleLower.includes('vp') || titleLower.includes('vice president')) {
      return 'VP';
    } else if (titleLower.includes('c-level') || titleLower.includes('chief')) {
      return 'C-Level';
    } else {
      return 'Mid-Level';
    }
  },

  // Get the industry category based on industry name
  getIndustryCategory: (industry) => {
    const techIndustries = ['Technology', 'Software', 'Hardware', 'IT', 'Internet', 'Telecommunications'];
    const financeIndustries = ['Finance', 'Banking', 'Insurance', 'Accounting'];
    const healthcareIndustries = ['Healthcare', 'Medical', 'Pharmaceutical', 'Biotechnology'];
    const retailIndustries = ['Retail', 'E-commerce', 'Consumer Goods'];
    const manufacturingIndustries = ['Manufacturing', 'Automotive', 'Industrial'];
    const educationIndustries = ['Education', 'E-learning', 'Training'];

    if (techIndustries.some(t => industry.includes(t))) return 'Technology';
    if (financeIndustries.some(f => industry.includes(f))) return 'Finance';
    if (healthcareIndustries.some(h => industry.includes(h))) return 'Healthcare';
    if (retailIndustries.some(r => industry.includes(r))) return 'Retail';
    if (manufacturingIndustries.some(m => industry.includes(m))) return 'Manufacturing';
    if (educationIndustries.some(e => industry.includes(e))) return 'Education';

    return 'Other';
  },

  // Get the job type category based on employment type
  getJobTypeCategory: (employmentType) => {
    switch (employmentType) {
      case 'FULL_TIME':
        return 'Full-time';
      case 'PART_TIME':
        return 'Part-time';
      case 'CONTRACT':
        return 'Contract';
      case 'TEMPORARY':
        return 'Temporary';
      case 'INTERNSHIP':
        return 'Internship';
      case 'VOLUNTEER':
        return 'Volunteer';
      default:
        return 'Other';
    }
  },

  // Get the remote work category based on remote preference
  getRemoteWorkCategory: (remotePreference) => {
    switch (remotePreference) {
      case 'ONSITE':
        return 'On-site';
      case 'REMOTE':
        return 'Remote';
      case 'HYBRID':
        return 'Hybrid';
      default:
        return 'Not specified';
    }
  },

  // Get the education level category based on education
  getEducationLevelCategory: (education) => {
    if (!education || education.length === 0) return 'Not specified';

    const highest = education.reduce((highest, current) => {
      const currentLevel = helpers.getEducationLevel(current.degree);
      return currentLevel > highest ? currentLevel : highest;
    }, 0);

    switch (highest) {
      case 1:
        return 'High School';
      case 2:
        return 'Associate';
      case 3:
        return 'Bachelor';
      case 4:
        return 'Master';
      case 5:
        return 'PhD';
      default:
        return 'Other';
    }
  },

  // Helper to get education level from degree string
  getEducationLevel: (degree) => {
    const degreeLower = degree.toLowerCase();
    if (degreeLower.includes('phd') || degreeLower.includes('doctor')) return 5;
    if (degreeLower.includes('master')) return 4;
    if (degreeLower.includes('bachelor')) return 3;
    if (degreeLower.includes('associate')) return 2;
    if (degreeLower.includes('high school') || degreeLower.includes('diploma')) return 1;
    return 0;
  },

  // Get the skill category based on skill name
  getSkillCategory: (skill) => {
    const programmingLanguages = ['JavaScript', 'Python', 'Java', 'C++', 'C#', 'Ruby', 'Go', 'Swift', 'Kotlin', 'PHP'];
    const frontendSkills = ['HTML', 'CSS', 'React', 'Angular', 'Vue', 'SASS', 'LESS', 'Bootstrap'];
    const backendSkills = ['Node.js', 'Express', 'Django', 'Flask', 'Spring', 'Laravel', 'Ruby on Rails'];
    const databaseSkills = ['SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Oracle', 'SQLite'];
    const devopsSkills = ['Docker', 'Kubernetes', 'AWS', 'Azure', 'Google Cloud', 'CI/CD', 'Jenkins', 'Git'];
    const dataScienceSkills = ['Machine Learning', 'Data Analysis', 'Statistics', 'R', 'TensorFlow', 'PyTorch'];
    const designSkills = ['UI/UX', 'Figma', 'Adobe XD', 'Sketch', 'Photoshop', 'Illustrator'];
    const softSkills = ['Communication', 'Leadership', 'Teamwork', 'Problem Solving', 'Time Management'];

    if (programmingLanguages.includes(skill)) return 'Programming Languages';
    if (frontendSkills.includes(skill)) return 'Frontend Development';
    if (backendSkills.includes(skill)) return 'Backend Development';
    if (databaseSkills.includes(skill)) return 'Database';
    if (devopsSkills.includes(skill)) return 'DevOps & Cloud';
    if (dataScienceSkills.includes(skill)) return 'Data Science & AI';
    if (designSkills.includes(skill)) return 'Design';
    if (softSkills.includes(skill)) return 'Soft Skills';

    return 'Other Skills';
  },

  // Get the years of experience category
  getYearsOfExperienceCategory: (years) => {
    if (years < 1) return '0-1 years';
    if (years >= 1 && years <= 3) return '1-3 years';
    if (years >= 4 && years <= 7) return '4-7 years';
    if (years >= 8 && years <= 10) return '8-10 years';
    return '10+ years';
  },

  // Get the proficiency level category
  getProficiencyLevelCategory: (proficiency) => {
    switch (proficiency) {
      case 'BEGINNER':
        return 'Beginner';
      case 'INTERMEDIATE':
        return 'Intermediate';
      case 'ADVANCED':
        return 'Advanced';
      case 'EXPERT':
        return 'Expert';
      default:
        return 'Not specified';
    }
  },

  // Get the application status category
  getApplicationStatusCategory: (status) => {
    switch (status) {
      case 'PENDING':
        return 'Pending';
      case 'REVIEWING':
        return 'Reviewing';
      case 'SHORTLISTED':
        return 'Shortlisted';
      case 'INTERVIEWING':
        return 'Interviewing';
      case 'OFFERED':
        return 'Offered';
      case 'HIRED':
        return 'Hired';
      case 'REJECTED':
        return 'Rejected';
      case 'WITHDRAWN':
        return 'Withdrawn';
      case 'EXPIRED':
        return 'Expired';
      default:
        return 'Unknown';
    }
  },

  // Get the interview type category
  getInterviewTypeCategory: (type) => {
    switch (type) {
      case 'PHONE':
        return 'Phone Interview';
      case 'VIDEO':
        return 'Video Interview';
      case 'IN_PERSON':
        return 'In-Person Interview';
      case 'TECHNICAL':
        return 'Technical Interview';
      case 'BEHAVIORAL':
        return 'Behavioral Interview';
      case 'PANEL':
        return 'Panel Interview';
      default:
        return 'Other Interview';
    }
  },

  // Get the interview status category
  getInterviewStatusCategory: (status) => {
    switch (status) {
      case 'SCHEDULED':
        return 'Scheduled';
      case 'COMPLETED':
        return 'Completed';
      case 'CANCELLED':
        return 'Cancelled';
      case 'NO_SHOW':
        return 'No Show';
      case 'RESCHEDULED':
        return 'Rescheduled';
      default:
        return 'Unknown';
    }
  },

  // Get the payment status category
  getPaymentStatusCategory: (status) => {
    switch (status) {
      case 'PENDING':
        return 'Pending';
      case 'PROCESSING':
        return 'Processing';
      case 'COMPLETED':
        return 'Completed';
      case 'FAILED':
        return 'Failed';
      case 'REFUNDED':
        return 'Refunded';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return 'Unknown';
    }
  },

  // Get the invoice status category
  getInvoiceStatusCategory: (status) => {
    switch (status) {
      case 'DRAFT':
        return 'Draft';
      case 'SENT':
        return 'Sent';
      case 'PAID':
        return 'Paid';
      case 'OVERDUE':
        return 'Overdue';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return 'Unknown';
    }
  },

  // Get the subscription status category
  getSubscriptionStatusCategory: (status) => {
    switch (status) {
      case 'ACTIVE':
        return 'Active';
      case 'CANCELLED':
        return 'Cancelled';
      case 'EXPIRED':
        return 'Expired';
      case 'PAST_DUE':
        return 'Past Due';
      case 'TRIAL':
        return 'Trial';
      default:
        return 'Unknown';
    }
  },

  // Get the notification type category
  getNotificationTypeCategory: (type) => {
    switch (type) {
      case 'APPLICATION_UPDATE':
        return 'Application Update';
      case 'JOB_MATCH':
        return 'Job Match';
      case 'MESSAGE':
        return 'Message';
      case 'INTERVIEW_INVITE':
        return 'Interview Invite';
      case 'PAYMENT_RECEIVED':
        return 'Payment Received';
      case 'SYSTEM_ALERT':
        return 'System Alert';
      default:
        return 'Other';
    }
  },

  // Get the notification channel category
  getNotificationChannelCategory: (channel) => {
    switch (channel) {
      case 'EMAIL':
        return 'Email';
      case 'PUSH':
        return 'Push';
      case 'SMS':
        return 'SMS';
      case 'IN_APP':
        return 'In-App';
      default:
        return 'Unknown';
    }
  },

  // Get the priority category
  getPriorityCategory: (priority) => {
    switch (priority) {
      case 'LOW':
        return 'Low';
      case 'NORMAL':
        return 'Normal';
      case 'HIGH':
        return 'High';
      case 'URGENT':
        return 'Urgent';
      default:
        return 'Normal';
    }
  },

  // Get the user role category
  getUserRoleCategory: (role) => {
    switch (role) {
      case 'WORKER':
        return 'Worker';
      case 'EMPLOYER':
        return 'Employer';
      case 'FREELANCER':
        return 'Freelancer';
      case 'VOLUNTEER':
        return 'Volunteer';
      case 'SELLER':
        return 'Seller';
      case 'ADMIN':
        return 'Admin';
      default:
        return 'Unknown';
    }
  },

  // Get the user status category
  getUserStatusCategory: (status) => {
    switch (status) {
      case 'ACTIVE':
        return 'Active';
      case 'INACTIVE':
        return 'Inactive';
      case 'SUSPENDED':
        return 'Suspended';
      case 'PENDING_VERIFICATION':
        return 'Pending Verification';
      default:
        return 'Unknown';
    }
  },

  // Get the job status category
  getJobStatusCategory: (status) => {
    switch (status) {
      case 'DRAFT':
        return 'Draft';
      case 'PUBLISHED':
        return 'Published';
      case 'CLOSED':
        return 'Closed';
      case 'EXPIRED':
        return 'Expired';
      case 'ARCHIVED':
        return 'Archived';
      default:
        return 'Unknown';
    }
  },

  // Get the company size enum value
  getCompanySizeEnum: (size) => {
    if (size < 10) return 'MICRO';
    if (size >= 10 && size <= 49) return 'SMALL';
    if (size >= 50 && size <= 249) return 'MEDIUM';
    if (size >= 250 && size <= 999) return 'LARGE';
    return 'ENTERPRISE';
  },

  // Get the experience level enum value
  getExperienceLevelEnum: (level) => {
    switch (level.toLowerCase()) {
      case 'entry':
        return 'ENTRY';
      case 'junior':
        return 'JUNIOR';
      case 'mid':
        return 'MID';
      case 'senior':
        return 'SENIOR';
      case 'lead':
        return 'LEAD';
      case 'executive':
        return 'EXECUTIVE';
      default:
        return 'MID';
    }
  },

  // Get the employment type enum value
  getEmploymentTypeEnum: (type) => {
    switch (type.toLowerCase()) {
      case 'full-time':
        return 'FULL_TIME';
      case 'part-time':
        return 'PART_TIME';
      case 'contract':
        return 'CONTRACT';
      case 'temporary':
        return 'TEMPORARY';
      case 'internship':
        return 'INTERNSHIP';
      case 'volunteer':
        return 'VOLUNTEER';
      default:
        return 'FULL_TIME';
    }
  },

  // Get the remote preference enum value
  getRemotePreferenceEnum: (preference) => {
    switch (preference.toLowerCase()) {
      case 'onsite':
        return 'ONSITE';
      case 'remote':
        return 'REMOTE';
      case 'hybrid':
        return 'HYBRID';
      default:
        return 'HYBRID';
    }
  },

  // Get the salary type enum value
  getSalaryTypeEnum: (type) => {
    switch (type.toLowerCase()) {
      case 'hourly':
        return 'HOURLY';
      case 'daily':
        return 'DAILY';
      case 'weekly':
        return 'WEEKLY';
      case 'monthly':
        return 'MONTHLY';
      case 'yearly':
        return 'YEARLY';
      default:
        return 'YEARLY';
    }
  },

  // Get the visibility enum value
  getVisibilityEnum: (visibility) => {
    switch (visibility.toLowerCase()) {
      case 'public':
        return 'PUBLIC';
      case 'private':
        return 'PRIVATE';
      case 'internal':
        return 'INTERNAL';
      default:
        return 'PUBLIC';
    }
  },

  // Get the urgency level enum value
  getUrgencyLevelEnum: (urgency) => {
    switch (urgency.toLowerCase()) {
      case 'low':
        return 'LOW';
      case 'normal':
        return 'NORMAL';
      case 'high':
        return 'HIGH';
      case 'urgent':
        return 'URGENT';
      default:
        return 'NORMAL';
    }
  },

  // Get the proficiency level enum value
  getProficiencyLevelEnum: (proficiency) => {
    switch (proficiency.toLowerCase()) {
      case 'beginner':
        return 'BEGINNER';
      case 'intermediate':
        return 'INTERMEDIATE';
      case 'advanced':
        return 'ADVANCED';
      case 'expert':
        return 'EXPERT';
      default:
        return 'INTERMEDIATE';
    }
  },

  // Get the availability status enum value
  getAvailabilityStatusEnum: (availability) => {
    switch (availability.toLowerCase()) {
      case 'available':
        return 'AVAILABLE';
      case 'unavailable':
        return 'UNAVAILABLE';
      case 'soon':
        return 'SOON';
      default:
        return 'AVAILABLE';
    }
  },

  // Get the application status enum value
  getApplicationStatusEnum: (status) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'PENDING';
      case 'reviewing':
        return 'REVIEWING';
      case 'shortlisted':
        return 'SHORTLISTED';
      case 'interviewing':
        return 'INTERVIEWING';
      case 'offered':
        return 'OFFERED';
      case 'hired':
        return 'HIRED';
      case 'rejected':
        return 'REJECTED';
      case 'withdrawn':
        return 'WITHDRAWN';
      case 'expired':
        return 'EXPIRED';
      default:
        return 'PENDING';
    }
  },

  // Get the interview type enum value
  getInterviewTypeEnum: (type) => {
    switch (type.toLowerCase()) {
      case 'phone':
        return 'PHONE';
      case 'video':
        return 'VIDEO';
      case 'in_person':
        return 'IN_PERSON';
      case 'technical':
        return 'TECHNICAL';
      case 'behavioral':
        return 'BEHAVIORAL';
      case 'panel':
        return 'PANEL';
      default:
        return 'PHONE';
    }
  },

  // Get the interview status enum value
  getInterviewStatusEnum: (status) => {
    switch (status.toLowerCase()) {
      case 'scheduled':
        return 'SCHEDULED';
      case 'completed':
        return 'COMPLETED';
      case 'cancelled':
        return 'CANCELLED';
      case 'no_show':
        return 'NO_SHOW';
      case 'rescheduled':
        return 'RESCHEDULED';
      default:
        return 'SCHEDULED';
    }
  },

  // Get the payment status enum value
  getPaymentStatusEnum: (status) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'PENDING';
      case 'processing':
        return 'PROCESSING';
      case 'completed':
        return 'COMPLETED';
      case 'failed':
        return 'FAILED';
      case 'refunded':
        return 'REFUNDED';
      case 'cancelled':
        return 'CANCELLED';
      default:
        return 'PENDING';
    }
  },

  // Get the invoice status enum value
  getInvoiceStatusEnum: (status) => {
    switch (status.toLowerCase()) {
      case 'draft':
        return 'DRAFT';
      case 'sent':
        return 'SENT';
      case 'paid':
        return 'PAID';
      case 'overdue':
        return 'OVERDUE';
      case 'cancelled':
        return 'CANCELLED';
      default:
        return 'DRAFT';
    }
  },

  // Get the subscription status enum value
  getSubscriptionStatusEnum: (status) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'ACTIVE';
      case 'cancelled':
        return 'CANCELLED';
      case 'expired':
        return 'EXPIRED';
      case 'past_due':
        return 'PAST_DUE';
      case 'trial':
        return 'TRIAL';
      default:
        return 'ACTIVE';
    }
  },

  // Get the notification type enum value
  getNotificationTypeEnum: (type) => {
    switch (type.toLowerCase()) {
      case 'application_update':
        return 'APPLICATION_UPDATE';
      case 'job_match':
        return 'JOB_MATCH';
      case 'message':
        return 'MESSAGE';
      case 'interview_invite':
        return 'INTERVIEW_INVITE';
      case 'payment_received':
        return 'PAYMENT_RECEIVED';
      case 'system_alert':
        return 'SYSTEM_ALERT';
      default:
        return 'SYSTEM_ALERT';
    }
  },

  // Get the notification channel enum value
  getNotificationChannelEnum: (channel) => {
    switch (channel.toLowerCase()) {
      case 'email':
        return 'EMAIL';
      case 'push':
        return 'PUSH';
      case 'sms':
        return 'SMS';
      case 'in_app':
        return 'IN_APP';
      default:
        return 'IN_APP';
    }
  },

  // Get the priority enum value
  getPriorityEnum: (priority) => {
    switch (priority.toLowerCase()) {
      case 'low':
        return 'LOW';
      case 'normal':
        return 'NORMAL';
      case 'high':
        return 'HIGH';
      case 'urgent':
        return 'URGENT';
      default:
        return 'NORMAL';
    }
  },

  // Get the user role enum value
  getUserRoleEnum: (role) => {
    switch (role.toLowerCase()) {
      case 'worker':
        return 'WORKER';
      case 'employer':
        return 'EMPLOYER';
      case 'freelancer':
        return 'FREELANCER';
      case 'volunteer':
        return 'VOLUNTEER';
      case 'seller':
        return 'SELLER';
      case 'admin':
        return 'ADMIN';
      default:
        return 'WORKER';
    }
  },

  // Get the user status enum value
  getUserStatusEnum: (status) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'ACTIVE';
      case 'inactive':
        return 'INACTIVE';
      case 'suspended':
        return 'SUSPENDED';
      case 'pending_verification':
        return 'PENDING_VERIFICATION';
      default:
        return 'PENDING_VERIFICATION';
    }
  },

  // Get the job status enum value
  getJobStatusEnum: (status) => {
    switch (status.toLowerCase()) {
      case 'draft':
        return 'DRAFT';
      case 'published':
        return 'PUBLISHED';
      case 'closed':
        return 'CLOSED';
      case 'expired':
        return 'EXPIRED';
      case 'archived':
        return 'ARCHIVED';
      default:
        return 'DRAFT';
    }
  }
};

module.exports = helpers;
