/**
 * Base repository interface
 * Defines common CRUD operations for all repositories
 */
class IBaseRepository {
  /**
   * Create a new record
   * @param {Object} data - Data to create
   * @returns {Promise<Object>} Created record
   */
  async create(data) {
    throw new Error('Method not implemented');
  }

  /**
   * Find record by ID
   * @param {string} id - Record ID
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} Found record or null
   */
  async findById(id, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Find records by criteria
   * @param {Object} where - Filter criteria
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Found records
   */
  async findMany(where = {}, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Find first record by criteria
   * @param {Object} where - Filter criteria
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} Found record or null
   */
  async findFirst(where = {}, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Update record by ID
   * @param {string} id - Record ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated record
   */
  async update(id, data) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete record by ID
   * @param {string} id - Record ID
   * @returns {Promise<Object>} Deleted record
   */
  async delete(id) {
    throw new Error('Method not implemented');
  }

  /**
   * Count records by criteria
   * @param {Object} where - Filter criteria
   * @returns {Promise<number>} Count of records
   */
  async count(where = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Check if record exists
   * @param {Object} where - Filter criteria
   * @returns {Promise<boolean>} True if exists
   */
  async exists(where = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Paginate records
   * @param {Object} where - Filter criteria
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} Paginated results
   */
  async paginate(where = {}, options = {}) {
    throw new Error('Method not implemented');
  }
}

module.exports = IBaseRepository;
