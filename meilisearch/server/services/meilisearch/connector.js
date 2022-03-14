'use strict'
const MeiliSearch = require('./client')

/**
 * Add one entry from a contentType to its index in Meilisearch.
 *
 * @param  {object} options
 * @param  {object} options.config - Configuration utililites.
 * @param  {object} options.adapter - Adapter utililites.
 * @param  {string} options.contentType - ContentType name.
 * @param  {object[] | object} options.entries - Entries to sanitize.
 * @returns {Promise<object[] | object>} - Sanitized entries.
 */
const sanitizeEntries = async function ({
  contentType,
  entries,
  config,
  adapter,
}) {
  if (!Array.isArray(entries)) entries = [entries]

  entries = await config.filterEntries({
    contentType,
    entries,
  })
  entries = await config.transformEntries({
    contentType,
    entries,
  })
  entries = await config.removeSensitiveFields({ entries })
  entries = await adapter.addCollectionNamePrefix({
    contentType,
    entries,
  })

  return entries
}

module.exports = ({ strapi, adapter, config }) => {
  const store = strapi.plugin('meilisearch').service('store')
  const contentTypeService = strapi.plugin('meilisearch').service('contentType')
  const lifecycle = strapi.plugin('meilisearch').service('lifecycle')

  return {
    /**
     * Get indexes with a safe guard in case of error.
     *
     * @returns { Promise<import("meilisearch").Index[]> }
     */
    getIndexes: async function () {
      try {
        const { apiKey, host } = await store.getCredentials()
        const client = MeiliSearch({ apiKey, host })
        const indexes = await client.getIndexes()
        return indexes
      } catch (e) {
        strapi.log.error(`meilisearch: ${e.message}`)
        return []
      }
    },

    /**
     * Delete multiples entries from the contentType in its index in Meilisearch.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     * @param  {number[]} options.entriesId - Entries id.
     *
     * @returns  { Promise<import("meilisearch").Task>} p - Task body returned by Meilisearch API.
     */
    deleteEntriesFromMeiliSearch: async function ({ contentType, entriesId }) {
      const { apiKey, host } = await store.getCredentials()
      const client = MeiliSearch({ apiKey, host })

      const indexUid = config.getIndexNameOfContentType({ contentType })
      const documentsIds = entriesId.map(entryId =>
        adapter.addCollectionNamePrefixToId({ entryId, contentType })
      )

      return await client.index(indexUid).deleteDocuments(documentsIds)
    },

    /**
     * Update entries from the contentType in its index in Meilisearch.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     * @param  {object[]} options.entries - Entries to update.
     *
     * @returns  { Promise<void> }
     */
    updateEntriesInMeilisearch: async function ({ contentType, entries }) {
      const { apiKey, host } = await store.getCredentials()
      const client = MeiliSearch({ apiKey, host })

      const indexUid = config.getIndexNameOfContentType({ contentType })

      await entries.forEach(async entry => {
        const sanitized = await sanitizeEntries({
          entries: [entry],
          contentType,
          config,
          adapter,
        })
        if (entry.publishedAt === null || sanitized.length === 0) {
          return client.index(indexUid).deleteDocument(
            adapter.addCollectionNamePrefixToId({
              contentType,
              entryId: entry.id,
            })
          )
        } else {
          return client.index(indexUid).updateDocuments(sanitized)
        }
      })
    },

    /**
     * Wait for an task to be processed in Meilisearch.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     * @param  {number} options.taskUid - Task identifier.
     *
     * @returns  { Promise<import("meilisearch").Task  | number>} p - Task body returned by Meilisearch API.
     */
    waitForTask: async function ({ contentType, taskUid }) {
      try {
        const { apiKey, host } = await store.getCredentials()
        const client = MeiliSearch({ apiKey, host })
        const indexUid = config.getIndexNameOfContentType({ contentType })
        const task = await client
          .index(indexUid)
          .waitForTask(taskUid, { intervalMs: 5000 })

        return task
      } catch (e) {
        strapi.log.warn(e)
        return 0
      }
    },

    /**
     * Wait for a batch of tasks uids to be processed.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     * @param  {number[]} options.taskUids - Array of tasks identifiers.
     *
     * @returns  { Promise<(import("meilisearch").Task| number)[]> } p - Task body returned by Meilisearch API.
     */
    waitForTasks: async function ({ contentType, taskUids }) {
      const tasks = []
      for (const taskUid of taskUids) {
        const status = await this.waitForTask({
          contentType,
          taskUid,
        })
        tasks.push(status)
      }
      return tasks
    },

    /**
     * Get enqueued tasks ids of indexed contentTypes.
     *
     * @returns { Promise<Record<string, number[]> | {}> } - ContentTypes with their respective task uids
     */
    getEnqueuedTaskUids: async function () {
      const indexes = await this.getIndexes()
      const indexUids = indexes.map(index => index.uid)
      const contentTypes = contentTypeService.getContentTypesUid()
      const { apiKey, host } = await store.getCredentials()
      const client = MeiliSearch({ apiKey, host })

      const contentTypeTaskUids = {}
      const { results: tasks } = await client.getTasks()
      for (const contentType of contentTypes) {
        const indexUid = config.getIndexNameOfContentType({ contentType })
        if (indexUids.includes(indexUid)) {
          const enqueueded = tasks
            .filter(
              task => task.status === 'enqueued' && task.indexUid === indexUid
            )
            .map(task => task.uid)
          contentTypeTaskUids[contentType] = enqueueded
        }
      }
      return contentTypeTaskUids
    },

    /**
     * Get stats of an index with a safe guard in case of error.
     *
     * @param  {object} options
     * @param { string } options.indexUid
     *
     * @returns {Promise<import("meilisearch").IndexStats> }
     */
    getStats: async function ({ indexUid }) {
      try {
        const { apiKey, host } = await store.getCredentials()
        const client = MeiliSearch({ apiKey, host })
        return await client.index(indexUid).getStats()
      } catch (e) {
        return {
          numberOfDocuments: 0,
          isIndexing: false,
          fieldDistribution: {},
        }
      }
    },

    /**
     * Information about contentTypes in Meilisearch.
     *
     * @returns {Promise<{ contentTypes: Array<{
     * contentType: string,
     * indexUid: string,
     * indexed: boolean,
     * isIndexing: boolean,
     * numberOfDocuments: number,
     * numberOfEntries: number,
     * listened: boolean,
     * }>}>} - List of contentTypes reports.
     */
    getContentTypesReport: async function () {
      const indexes = await this.getIndexes()
      const indexUids = indexes.map(index => index.uid)

      // All listened contentTypes
      const listenedContentTypes = await store.getListenedContentTypes()
      // All indexed contentTypes
      const indexedContentTypes = await store.getIndexedContentTypes()

      const contentTypes = contentTypeService.getContentTypesUid()

      const reports = await Promise.all(
        contentTypes.map(async contentType => {
          const collectionName = contentTypeService.getCollectionName({
            contentType,
          })
          const indexUid = config.getIndexNameOfContentType({ contentType })
          const indexInMeiliSearch = indexUids.includes(indexUid)

          const contentTypeInIndexStore = indexedContentTypes.includes(
            contentType
          )
          const indexed = indexInMeiliSearch && contentTypeInIndexStore

          // safe guard in case index does not exist anymore in Meilisearch
          if (!indexInMeiliSearch && contentTypeInIndexStore) {
            await store.removeIndexedContentType({ contentType })
          }

          const {
            numberOfDocuments = 0,
            isIndexing = false,
          } = indexUids.includes(indexUid)
            ? await this.getStats({ indexUid })
            : {}

          const contentTypesWithSameIndexUid = await config.listContentTypesWithCustomIndexName(
            { indexName: indexUid }
          )
          const numberOfEntries = await contentTypeService.totalNumberOfEntries(
            {
              contentTypes: contentTypesWithSameIndexUid,
            }
          )
          return {
            collection: collectionName,
            contentType: contentType,
            indexUid,
            indexed,
            isIndexing,
            numberOfDocuments,
            numberOfEntries,
            listened: listenedContentTypes.includes(contentType),
          }
        })
      )
      return { contentTypes: reports }
    },

    /**
     * Add one entry from a contentType to its index in Meilisearch.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     * @param  {object[] | object} options.entry - Entry from the document.
     * @returns {Promise<{ taskUid: number }>} - Task identifier.
     */
    addOneEntryInMeiliSearch: async function ({ contentType, entry }) {
      let entries = entry
      if (!Array.isArray(entries)) entries = [entries]
      return this.addMultipleEntriesToMeilisearch({ contentType, entries })
    },

    /**
     * Add one entry from a contentType to its index in Meilisearch.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     * @param  {object[] | object} options.entries - Entry from the document.
     * @returns {Promise<{ taskUid: number }>} - Task identifier.
     */
    addMultipleEntriesToMeilisearch: async function ({ contentType, entries }) {
      const { apiKey, host } = await store.getCredentials()
      const client = MeiliSearch({ apiKey, host })

      if (!Array.isArray(entries)) entries = [entries]
      const indexUid = config.getIndexNameOfContentType({ contentType })
      const documents = await sanitizeEntries({
        contentType,
        entries,
        config,
        adapter,
      })

      const task = await client.index(indexUid).addDocuments(documents)
      await store.addIndexedContentType({ contentType })
      await lifecycle.subscribeContentType({ contentType })

      return task
    },

    /**
     * Add all entries from a contentType to its index in Meilisearch.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     *
     * @returns {Promise<number[]>} - All task uids from the batched indexation process.
     */
    addContentTypeInMeiliSearch: async function ({ contentType }) {
      const { apiKey, host } = await store.getCredentials()
      const client = MeiliSearch({ apiKey, host })
      const indexUid = config.getIndexNameOfContentType({ contentType })

      // Get Meilisearch Index settings from model
      const settings = config.getSettings({ contentType })
      await client.index(indexUid).updateSettings(settings)

      // Callback function for batching action
      const addDocuments = async ({ entries, contentType }) => {
        // Sanitize entries
        const documents = await sanitizeEntries({
          contentType,
          entries,
          config,
          adapter,
        })

        // Add documents in Meilisearch
        const task = await client.index(indexUid).addDocuments(documents)

        return task.uid
      }

      const tasksUids = await contentTypeService.actionInBatches({
        contentType,
        callback: addDocuments,
      })

      await store.addIndexedContentType({ contentType })
      await lifecycle.subscribeContentType({ contentType })

      return tasksUids
    },

    /**
     * Search for the list of all contentTypes that share the same index name.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     *
     * @returns {Promise<string[]>} - ContentTypes names.
     */
    getContentTypesWithSameIndex: async function ({ contentType }) {
      const indexUid = config.getIndexNameOfContentType({ contentType })

      // Fetch contentTypes that has the same indexName as the provided contentType
      const contentTypesWithSameIndex = await config.listContentTypesWithCustomIndexName(
        { indexUid }
      )

      // get all contentTypes (not indexes) indexed in Meilisearch.
      const indexedContentTypes = await store.getIndexedContentTypes()

      // Take union of both array
      const indexedContentTypesWithSameIndex = indexedContentTypes.filter(
        contentType => contentTypesWithSameIndex.includes(contentType)
      )

      return indexedContentTypesWithSameIndex
    },

    /**
     * Delete or empty an index depending if the contentType is part
     * of a composite index.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     */
    emptyOrDeleteIndex: async function ({ contentType }) {
      const indexedContentTypesWithSameIndex = await this.getContentTypesWithSameIndex(
        {
          contentType,
        }
      )
      if (indexedContentTypesWithSameIndex.length > 1) {
        const deleteEntries = async (entries, contentType) => {
          await this.deleteEntriesFromMeiliSearch({
            contentType,
            entriesId: entries.map(entry => entry.id),
          })
        }
        await contentTypeService.actionInBatches({
          contentType,
          callback: deleteEntries,
        })
      } else {
        const { apiKey, host } = await store.getCredentials()
        const client = MeiliSearch({ apiKey, host })

        const indexUid = config.getIndexNameOfContentType({ contentType })
        await client.index(indexUid).delete()
      }

      await store.removeIndexedContentType({ contentType })
    },

    /**
     * Update all entries from a contentType to its index in Meilisearch.
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     *
     * @returns {Promise<number[]>} - All tasks uid from the indexation process.
     */
    updateContentTypeInMeiliSearch: async function ({ contentType }) {
      const indexedContentTypes = await store.getIndexedContentTypes()
      if (indexedContentTypes.includes(contentType)) {
        await this.emptyOrDeleteIndex({ contentType })
      }
      return this.addContentTypeInMeiliSearch({ contentType })
    },

    /**
     * Remove or empty a contentType from Meilisearch
     *
     * @param  {object} options
     * @param  {string} options.contentType - ContentType name.
     *
     * @returns {Promise<void>} - All tasks uid from the indexation process.
     */
    removeContentTypeFromMeiliSearch: async function ({ contentType }) {
      await this.emptyOrDeleteIndex({ contentType })
    },

    /**
     * Get list of index uids in Meilisearch instance.
     *
     * @returns {Promise<string[]>} - Index uids
     */
    getContentTypesIndexedInMeiliSearch: async function ({ contentTypes }) {
      const { apiKey, host } = await store.getCredentials()
      const client = MeiliSearch({ apiKey, host })

      let indexes = await client.getIndexes()

      indexes = indexes.map(index => index.uid)
      return contentTypes.filter(contentType =>
        indexes.includes(config.getIndexNameOfContentType({ contentType }))
      )
    },
  }
}
