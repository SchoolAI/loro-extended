import type { ListContainerShape } from "../shape.js"
import { ListDraftNodeBase } from "./list-base.js"

// List draft node
export class ListDraftNode<
  Shape extends ListContainerShape,
> extends ListDraftNodeBase<Shape> {}
