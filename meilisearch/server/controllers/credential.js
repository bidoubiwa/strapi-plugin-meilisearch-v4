'use strict'

module.exports = ({ strapi }) => {
  const store = strapi.plugin('meilisearch').service('store')
  return {
    /**
     * Get Client Credentials from the Store.
     *
     */
    async getCredentials(ctx) {
      await store
        .getCredentials()
        .then(credentials => {
          ctx.body = { data: credentials }
        })
        .catch(e => {
          const message = e.message
          ctx.body = {
            error: {
              message: message,
            },
          }
        })
    },

    /**
     * Add Meilisearch Credentials to the Store.
     *
     * @param  {object} ctx - Http request object.
     */
    async addCredentials(ctx) {
      const { host, apiKey } = ctx.request.body
      await store
        .addCredentials({ host, apiKey })
        .then(credentials => {
          ctx.body = { data: credentials }
        })
        .catch(e => {
          const message = e.message
          ctx.body = {
            error: {
              message: message,
            },
          }
        })
    },
  }
}
