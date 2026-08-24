/**
 * Abstract Base Class for HTML Search Providers
 */
export class SearchProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Execute search and return standardized results
   * @param {string} query
   * @param {Object} options
   * @returns {Promise<Array<{ title: string, url: string, snippet: string, source: string }>>}
   */
  async search(query, options = {}) {
    throw new Error(`SearchProvider.search() must be implemented by ${this.constructor.name}`);
  }
}
