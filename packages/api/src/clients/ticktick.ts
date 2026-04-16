import { createClient, createConfig } from '../generated/ticktick/client'
import {
  getAllProjects,
  getProjectWithDataById,
  createSingleTask,
  completeSpecifyTask,
  deleteSpecifyTask,
} from '../generated/ticktick/sdk.gen'
import type { Task } from '../generated/ticktick/types.gen'

const API_KEY = process.env.TICKTICK_API_KEY ?? ''

export const ticktickClient = createClient(
  createConfig({ baseUrl: 'https://ticktick.com' }),
)

ticktickClient.interceptors.request.use((request) => {
  request.headers.set('Authorization', `Bearer ${API_KEY}`)
  return request
})

export const ticktickOps = {
  getProjects: () => getAllProjects({ client: ticktickClient }),

  getProjectData: (projectId: string) =>
    getProjectWithDataById({ client: ticktickClient, path: { projectId } }),

  createTask: (body: Task) =>
    createSingleTask({ client: ticktickClient, body }),

  updateTask: async (taskId: string, body: Task): Promise<Response> => {
    return fetch(`https://ticktick.com/open/v1/task/${taskId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  },

  completeTask: (projectId: string, taskId: string) =>
    completeSpecifyTask({ client: ticktickClient, path: { projectId, taskId } }),

  deleteTask: (projectId: string, taskId: string) =>
    deleteSpecifyTask({ client: ticktickClient, path: { projectId, taskId } }),
}
