const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadDirs = [
  'uploads/avatars',
  'uploads/resumes',
  'uploads/documents',
  'uploads/logos',
  'uploads/portfolio'
];

uploadDirs.forEach(dir => {
  const dirPath = path.join(__dirname, '../../', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'uploads';
    
    if (file.fieldname === 'avatar') {
      folder = 'uploads/avatars';
    } else if (file.fieldname === 'resume') {
      folder = 'uploads/resumes';
    } else if (file.fieldname === 'logo') {
      folder = 'uploads/logos';
    } else if (file.fieldname === 'documents' || file.fieldname === 'portfolio') {
      folder = 'uploads/documents';
    }
    
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    'avatar': ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'],
    'resume': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    'logo': ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'],
    'documents': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/jpg', 'image/png'],
    'portfolio': ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'video/mp4']
  };

  const fieldTypes = allowedTypes[file.fieldname];
  
  if (fieldTypes && fieldTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for ${file.fieldname}. Allowed types: ${fieldTypes?.join(', ')}`), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 5 // Max 5 files
  }
});

module.exports = upload;
