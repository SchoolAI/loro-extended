import { create, type Patch } from "mutative"

/**
 * Creates a raj-compatible update function from a mutative update function.
 *
 * The mutative update function directly mutates the model (draft) and returns
 * only a Command. The transformer handles the immutability and patch generation.
 *
 * @param mutativeUpdate - Function that mutates the model and returns a command
 * @param onPatch - Optional callback to receive patches for debugging
 * @returns A raj-compatible update function that returns [Model, Command?]
 */
export function makeMutableUpdate<Msg, Model, Command>(
  mutativeUpdate: (msg: Msg, model: Model) => Command | undefined,
  onPatch?: (patches: Patch[]) => void,
): (msg: Msg, model: Model) => [Model, Command | undefined] {
  return (msg: Msg, model: Model) => {
    let command: Command | undefined

    const result = create(
      model,
      draft => {
        command = mutativeUpdate(msg, draft as Model)
      },
      { enablePatches: !!onPatch },
    )

    // When enablePatches is true, result is [newModel, patches, inversePatches]
    // When enablePatches is false, result is just newModel
    const newModel = Array.isArray(result) ? result[0] : result
    const patches = Array.isArray(result) ? result[1] : []

    if (onPatch && patches.length > 0) {
      onPatch(patches)
    }

    return [newModel, command]
  }
}
