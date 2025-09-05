import { z } from "zod"

export const TodoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
})

export type Todo = z.infer<typeof TodoSchema>
