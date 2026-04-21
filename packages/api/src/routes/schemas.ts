import { t } from 'elysia'

export const ExerciseSchema = t.String()

export const SetTypeSchema = t.Union([
  t.Literal('warmup'),
  t.Literal('work'),
  t.Literal('drop'),
  t.Literal('amrap'),
])

export const WorkoutSetSchema = t.Object({
  id: t.Number(),
  workout_id: t.Number(),
  set_number: t.Number(),
  set_type: t.String(),
  weight_kg: t.Number(),
  reps: t.Number(),
  created_at: t.Union([t.String(), t.Null()]),
})
