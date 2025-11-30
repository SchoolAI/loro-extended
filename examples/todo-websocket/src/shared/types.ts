import { Shape } from "@loro-extended/change"

export const TodoSchema = Shape.plain.object({
  id: Shape.plain.string(),
  text: Shape.plain.string(),
  completed: Shape.plain.boolean(),
})

export type Todo = {
  id: string
  text: string
  completed: boolean
}