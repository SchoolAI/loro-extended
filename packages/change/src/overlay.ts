import type { TreeID, Value } from "loro-crdt"
import { deriveShapePlaceholder } from "./derive-placeholder.js"
import type {
  ContainerShape,
  DiscriminatedUnionValueShape,
  DocShape,
  StructContainerShape,
  TreeContainerShape,
  TreeNodeJSON,
  ValueShape,
} from "./shape.js"
import { isObjectValue } from "./utils/type-guards.js"

/**
 * Overlays CRDT state with placeholder defaults
 */
export function overlayPlaceholder<Shape extends DocShape>(
  shape: Shape,
  crdtValue: { [key: string]: Value },
  placeholderValue: { [key: string]: Value },
): { [key: string]: Value } {
  if (typeof crdtValue !== "object") {
    throw new Error("crdt object is required")
  }

  if (typeof placeholderValue !== "object") {
    throw new Error("placeholder object is required")
  }

  const result = { ...placeholderValue }

  for (const [key, propShape] of Object.entries(shape.shapes)) {
    const propCrdtValue = crdtValue[key]

    const propPlaceholderValue =
      placeholderValue[key as keyof typeof placeholderValue]

    result[key as keyof typeof result] = mergeValue(
      propShape,
      propCrdtValue,
      propPlaceholderValue,
    )
  }

  return result
}

/**
 * Merges individual CRDT values with placeholder defaults
 */
export function mergeValue<Shape extends ContainerShape | ValueShape>(
  shape: Shape,
  crdtValue: Value,
  placeholderValue: Value,
): Value {
  // For "any" shapes, just return the CRDT value as-is (no placeholder merging)
  if (shape._type === "any") {
    return crdtValue
  }

  // For "any" value shapes, just return the CRDT value as-is
  if (shape._type === "value" && (shape as any).valueType === "any") {
    return crdtValue
  }

  if (crdtValue === undefined && placeholderValue === undefined) {
    throw new Error("either crdt or placeholder value must be defined")
  }

  switch (shape._type) {
    case "text":
      return crdtValue !== undefined ? crdtValue : (placeholderValue ?? "")
    case "counter":
      return crdtValue !== undefined ? crdtValue : (placeholderValue ?? 0)
    case "list":
    case "movableList": {
      if (crdtValue === undefined) {
        return placeholderValue ?? []
      }

      const crdtArray = crdtValue as Value[]
      const itemShape = shape.shape
      const itemPlaceholder = deriveShapePlaceholder(itemShape)

      return crdtArray.map(item =>
        mergeValue(itemShape, item, itemPlaceholder as Value),
      )
    }
    case "struct": {
      if (!isObjectValue(crdtValue) && crdtValue !== undefined) {
        throw new Error("struct crdt must be object")
      }

      const crdtStructValue = crdtValue ?? {}

      if (!isObjectValue(placeholderValue) && placeholderValue !== undefined) {
        throw new Error("struct placeholder must be object")
      }

      const placeholderStructValue = placeholderValue ?? {}

      const result = { ...placeholderStructValue }
      for (const [key, nestedShape] of Object.entries(shape.shapes)) {
        const nestedCrdtValue = crdtStructValue[key]
        const nestedPlaceholderValue = placeholderStructValue[key]

        result[key as keyof typeof result] = mergeValue(
          nestedShape,
          nestedCrdtValue,
          nestedPlaceholderValue,
        )
      }

      return result
    }
    case "tree": {
      if (crdtValue === undefined) {
        return placeholderValue ?? []
      }
      // Transform Loro's native tree format to our typed format
      const treeShape = shape as TreeContainerShape
      return transformTreeNodes(crdtValue as any[], treeShape.shape) as any
    }
    case "record": {
      if (!isObjectValue(crdtValue) && crdtValue !== undefined) {
        throw new Error("record crdt must be object")
      }

      const crdtRecordValue = (crdtValue as Record<string, Value>) ?? {}
      const result: Record<string, Value> = {}

      // For records, we iterate over the keys present in the CRDT value
      // and apply the nested shape's placeholder logic to each value
      for (const key of Object.keys(crdtRecordValue)) {
        const nestedCrdtValue = crdtRecordValue[key]
        // For records, the placeholder is always {}, so we need to derive
        // the placeholder for the nested shape on the fly
        const nestedPlaceholderValue = deriveShapePlaceholder(shape.shape)

        result[key] = mergeValue(
          shape.shape,
          nestedCrdtValue,
          nestedPlaceholderValue as Value,
        )
      }

      return result
    }
    default:
      if (shape._type === "value" && shape.valueType === "struct") {
        const crdtObj = (crdtValue as any) ?? {}
        const placeholderObj = (placeholderValue as any) ?? {}
        const result = { ...placeholderObj }

        if (typeof crdtObj !== "object" || crdtObj === null) {
          return crdtValue !== undefined ? crdtValue : placeholderValue
        }

        for (const [key, propShape] of Object.entries(shape.shape)) {
          const propCrdt = crdtObj[key]
          const propPlaceholder = placeholderObj[key]
          result[key] = mergeValue(propShape, propCrdt, propPlaceholder)
        }
        return result
      }

      // Handle discriminated unions
      if (shape._type === "value" && shape.valueType === "discriminatedUnion") {
        return mergeDiscriminatedUnion(
          shape as DiscriminatedUnionValueShape,
          crdtValue,
          placeholderValue,
        )
      }

      return crdtValue !== undefined ? crdtValue : placeholderValue
  }
}

/**
 * Merges a discriminated union value by determining the variant from the discriminant key.
 * Uses the placeholderValue's discriminant to determine the default variant when the discriminant is missing.
 */
function mergeDiscriminatedUnion(
  shape: DiscriminatedUnionValueShape,
  crdtValue: Value,
  placeholderValue: Value,
): Value {
  const crdtObj = (crdtValue as Record<string, Value>) ?? {}
  const placeholderObj = (placeholderValue as Record<string, Value>) ?? {}

  // Get the discriminant value from CRDT, falling back to placeholder
  const discriminantValue =
    crdtObj[shape.discriminantKey] ?? placeholderObj[shape.discriminantKey]

  if (typeof discriminantValue !== "string") {
    // If no valid discriminant, return the placeholder
    return placeholderValue
  }

  // Find the variant shape for this discriminant value
  const variantShape = shape.variants[discriminantValue]

  if (!variantShape) {
    // Unknown variant - return CRDT value or placeholder
    return crdtValue !== undefined ? crdtValue : placeholderValue
  }

  // Merge using the variant's object shape
  // If the placeholder's discriminant doesn't match the current discriminant,
  // we shouldn't use the placeholder for merging as it belongs to a different variant.
  const placeholderDiscriminant = placeholderObj[shape.discriminantKey]
  const effectivePlaceholderValue =
    placeholderDiscriminant === discriminantValue ? placeholderValue : undefined

  return mergeValue(variantShape, crdtValue, effectivePlaceholderValue as Value)
}

/**
 * Loro's native tree node format from toJSON()
 */
interface LoroTreeNodeJSON {
  id: string
  parent: string | null
  index: number
  fractional_index: string
  meta: Record<string, Value>
  children: LoroTreeNodeJSON[]
}

/**
 * Transforms Loro's native tree format to our typed TreeNodeJSON format.
 * - Renames `meta` to `data`
 * - Renames `fractional_index` to `fractionalIndex`
 * - Applies placeholder merging to node data
 */
function transformTreeNodes<DataShape extends StructContainerShape>(
  nodes: LoroTreeNodeJSON[],
  dataShape: DataShape,
): TreeNodeJSON<DataShape>[] {
  const dataPlaceholder = deriveShapePlaceholder(dataShape) as Value

  return nodes.map(node => transformTreeNode(node, dataShape, dataPlaceholder))
}

/**
 * Transforms a single tree node and its children recursively.
 */
function transformTreeNode<DataShape extends StructContainerShape>(
  node: LoroTreeNodeJSON,
  dataShape: DataShape,
  dataPlaceholder: Value,
): TreeNodeJSON<DataShape> {
  // Merge the node's meta (data) with the placeholder
  const mergedData = mergeValue(dataShape, node.meta, dataPlaceholder)

  return {
    id: node.id as TreeID,
    parent: node.parent as TreeID | null,
    index: node.index,
    fractionalIndex: node.fractional_index,
    data: mergedData as DataShape["_plain"],
    children: node.children.map(child =>
      transformTreeNode(child, dataShape, dataPlaceholder),
    ),
  }
}
