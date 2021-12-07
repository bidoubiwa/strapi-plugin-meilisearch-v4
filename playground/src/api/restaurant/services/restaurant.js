'use strict';

/**
 * restaurant service.
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::restaurant.restaurant', ({ strapi }) => {
  return {
    meilisearch: {
      transformEntry: ({ entry, collection }) => {
        return { ...entry }
      },
    }
  }
});
