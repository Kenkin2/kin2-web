const IBaseRepository = require('./IBaseRepository');

/**
 * User repository interface
 * Extends base repository with user-specific operations
 */
class IUserRepository extends IBaseRepository {
  /**
   * Find user by email
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User or null
   */
  async findByEmail(email) {
    throw new Error('Method not implemented');
  }

  /**
   * Find user by phone
   * @param {string} phone - User phone
   * @returns {Promise<Object|null>} User or null
   */
  async findByPhone(phone) {
    throw new Error('Method not implemented');
  }

  /**
   * Find user by verification token
   * @param {string} token - Verification token
   * @returns {Promise<Object|null>} User or null
   */
  async findByVerificationToken(token) {
    throw new Error('Method not implemented');
  }

  /**
   * Find user by reset token
   * @param {string} token - Reset token
   * @returns {Promise<Object|null>} User or null
   */
  async findByResetToken(token) {
    throw new Error('Method not implemented');
  }

  /**
   * Update user password
   * @param {string} id - User ID
   * @param {string} password - New password hash
   * @returns {Promise<Object>} Updated user
   */
  async updatePassword(id, password) {
    throw new Error('Method not implemented');
  }

  /**
   * Verify user
