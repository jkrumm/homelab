import type { DataProvider } from '@refinedev/core'
import { api, API_URL } from './eden'

type FlatFilter = { field: string; operator: string; value: unknown }

function buildWorkoutQuery(
  pagination: { current?: number; pageSize?: number } | undefined,
  sorters: Array<{ field: string; order: string }> | undefined,
  filters: FlatFilter[],
): Record<string, string> {
  const { current = 1, pageSize = 20 } = pagination ?? {}
  const _start = (current - 1) * pageSize
  const _end = _start + pageSize

  const query: Record<string, string> = {
    _start: String(_start),
    _end: String(_end),
  }

  const sorter = sorters?.[0]
  if (sorter) {
    query._sort = sorter.field
    query._order = sorter.order
  }

  for (const f of filters) {
    if (f.field === 'exercise' && f.operator === 'eq') query.exercise = String(f.value)
    if (f.field === 'date' && f.operator === 'gte') query.date_from = String(f.value)
    if (f.field === 'date' && f.operator === 'lte') query.date_to = String(f.value)
  }

  return query
}

export const dataProvider: DataProvider = {
  getApiUrl: () => API_URL,

  getList: async ({ resource, pagination, sorters, filters }) => {
    const flatFilters = ((filters as FlatFilter[] | undefined) ?? []).filter(
      (f): f is FlatFilter => 'field' in f,
    )
    const flatSorters = (sorters as Array<{ field: string; order: string }> | undefined) ?? []

    if (resource === 'workouts') {
      const query = buildWorkoutQuery(pagination, flatSorters, flatFilters)
      const { data, error, response } = await api.workouts.get({ query })
      if (error) throw new Error(String(error.value))
      const total = Number(response.headers.get('x-total-count') ?? 0)
      return { data: (data ?? []) as never[], total }
    }

    if (resource === 'daily-metrics') {
      const query: Record<string, string> = {}
      for (const f of flatFilters) {
        if (f.field === 'date' && f.operator === 'gte') query.date_from = String(f.value)
        if (f.field === 'date' && f.operator === 'lte') query.date_to = String(f.value)
      }
      const sorter = flatSorters[0]
      if (sorter) query._order = sorter.order
      const { data, error, response } = await api['daily-metrics'].get({ query })
      if (error) throw new Error(String(error.value))
      const total = Number(response.headers.get('x-total-count') ?? 0)
      return { data: (data ?? []) as never[], total }
    }

    if (resource === 'weight-log') {
      const query: Record<string, string> = {}
      const sorter = flatSorters[0]
      if (sorter) query._order = sorter.order
      const { data, error, response } = await api['weight-log'].get({ query })
      if (error) throw new Error(String(error.value))
      const total = Number(response.headers.get('x-total-count') ?? 0)
      return { data: (data ?? []) as never[], total }
    }

    if (resource === 'exercises') {
      const { data, error } = await api.exercises.get()
      if (error) throw new Error(String(error.value))
      return { data: (data ?? []) as never[], total: (data ?? []).length }
    }

    throw new Error(`Unsupported resource for getList: ${resource}`)
  },

  getOne: async ({ resource, id }) => {
    if (resource === 'workouts') {
      const { data, error } = await api.workouts({ id: String(id) }).get()
      if (error) throw new Error(String(error.value))
      return { data: data as never }
    }
    throw new Error(`Unsupported resource for getOne: ${resource}`)
  },

  create: async ({ resource, variables }) => {
    if (resource === 'workouts') {
      const { data, error } = await api.workouts.post(variables as never)
      if (error) throw new Error(String(error.value))
      return { data: data as never }
    }
    if (resource === 'weight-log') {
      const { data, error } = await api['weight-log'].post(variables as never)
      if (error) throw new Error(String(error.value))
      return { data: data as never }
    }
    throw new Error(`Unsupported resource for create: ${resource}`)
  },

  update: async ({ resource, id, variables }) => {
    if (resource === 'workouts') {
      const { data, error } = await api.workouts({ id: String(id) }).patch(variables as never)
      if (error) throw new Error(String(error.value))
      return { data: data as never }
    }
    throw new Error(`Unsupported resource for update: ${resource}`)
  },

  deleteOne: async ({ resource, id }) => {
    if (resource === 'workouts') {
      const { data, error } = await api.workouts({ id: String(id) }).delete()
      if (error) throw new Error(String(error.value))
      return { data: data as never }
    }
    if (resource === 'weight-log') {
      const { data, error } = await api['weight-log']({ id: String(id) }).delete()
      if (error) throw new Error(String(error.value))
      return { data: data as never }
    }
    throw new Error(`Unsupported resource for deleteOne: ${resource}`)
  },
}
