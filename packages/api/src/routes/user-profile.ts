import { Elysia, t } from 'elysia'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { userProfile } from '../db/schema.js'

const UserProfileSchema = t.Object({
  id: t.Number(),
  height_cm: t.Union([t.Number(), t.Null()]),
  birth_date: t.Union([t.String(), t.Null()]),
  gender: t.Union([t.String(), t.Null()]),
  goal_weight_kg: t.Union([t.Number(), t.Null()]),
  updated_at: t.Union([t.String(), t.Null()]),
})

export const userProfileRoutes = new Elysia({ prefix: '/user-profile' })
  .get(
    '/',
    async () => {
      const [profile] = await db.select().from(userProfile).where(eq(userProfile.id, 1))
      if (!profile) {
        // Create default profile on first access
        const [created] = await db.insert(userProfile).values({ id: 1 }).returning()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return created as any
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return profile as any
    },
    {
      response: UserProfileSchema,
      detail: {
        tags: ['User Profile'],
        summary: 'Get user profile (single row, auto-created on first access)',
        security: [{ BearerAuth: [] }],
      },
    },
  )
  .put(
    '/',
    async ({ body }) => {
      const [existing] = await db.select().from(userProfile).where(eq(userProfile.id, 1))
      if (!existing) {
        const [created] = await db
          .insert(userProfile)
          .values({ id: 1, ...body, updated_at: sql`datetime('now')` })
          .returning()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return created as any
      }
      const [updated] = await db
        .update(userProfile)
        .set({ ...body, updated_at: sql`datetime('now')` })
        .where(eq(userProfile.id, 1))
        .returning()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return updated as any
    },
    {
      body: t.Object({
        height_cm: t.Optional(t.Number({ minimum: 100, maximum: 250 })),
        birth_date: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
        gender: t.Optional(t.Union([t.Literal('male'), t.Literal('female')])),
        goal_weight_kg: t.Optional(t.Number({ minimum: 30, maximum: 300 })),
      }),
      response: UserProfileSchema,
      detail: {
        tags: ['User Profile'],
        summary: 'Update user profile',
        security: [{ BearerAuth: [] }],
      },
    },
  )
