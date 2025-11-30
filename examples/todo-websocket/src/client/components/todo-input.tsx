import { type default as React, useState } from "react"

interface TodoInputProps {
  onAdd: (text: string) => void
}

export const TodoInput: React.FC<TodoInputProps> = ({ onAdd }) => {
  const [text, setText] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (text.trim()) {
      onAdd(text.trim())
      setText("")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="todo-input-form">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What needs to be done?"
      />
      <button type="submit">Add</button>
    </form>
  )
}