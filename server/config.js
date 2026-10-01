const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
    PORT: process.env.PORT || 4000,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'admin123',
    DB_PATH: path.resolve(
        path.join(__dirname, '..'),
        process.env.DB_PATH || './data/usability.db'
    ),
    RETENTION_DAYS: parseInt(process.env.RETENTION_DAYS || '90', 10),
    HMAC_SECRET: process.env.HMAC_SECRET || 'usability-tracker-hmac-secret-change-me',
    LOGIN_RATE_LIMIT: parseInt(process.env.LOGIN_RATE_LIMIT || '10', 10), // attempts per 15 min
};