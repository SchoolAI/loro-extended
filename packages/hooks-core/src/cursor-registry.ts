import { loro, type TextRef } from "@loro-extended/change"

/**
 * Information about a registered text element
 */
export interface RegisteredElement {
  /** The HTML element bound to the text ref */
  element: HTMLInputElement | HTMLTextAreaElement
  /** The TextRef this element is bound to */
  textRef: TextRef
  /** The undo namespace this element belongs to (if any) */
  namespace?: string
}

/**
 * Information about the currently focused element
 */
export interface FocusedElementInfo {
  /** The container ID of the focused element's TextRef */
  containerId: string
  /** The HTML element that is focused */
  element: HTMLInputElement | HTMLTextAreaElement
  /** The TextRef the focused element is bound to */
  textRef: TextRef
  /** The undo namespace of the focused element (if any) */
  namespace?: string
}

/**
 * Registry for tracking text elements and their focus state.
 * Used by useCollaborativeText and useUndoManager to coordinate
 * cursor restoration across multiple text fields.
 */
export class CursorRegistry {
  /** Map of container ID to registered element info */
  private elements = new Map<string, RegisteredElement>()

  /** Currently focused element's container ID (if any) */
  private focusedContainerId: string | null = null

  /**
   * Register a text element with the registry.
   *
   * @param textRef - The TextRef bound to the element
   * @param element - The HTML input/textarea element
   * @param namespace - Optional undo namespace for this element
   */
  register(
    textRef: TextRef,
    element: HTMLInputElement | HTMLTextAreaElement,
    namespace?: string,
  ): void {
    const containerId = this.getContainerId(textRef)
    this.elements.set(containerId, { element, textRef, namespace })
  }

  /**
   * Unregister a text element from the registry.
   *
   * @param textRef - The TextRef to unregister
   */
  unregister(textRef: TextRef): void {
    const containerId = this.getContainerId(textRef)
    this.elements.delete(containerId)

    // Clear focus if this was the focused element
    if (this.focusedContainerId === containerId) {
      this.focusedContainerId = null
    }
  }

  /**
   * Update the focused element.
   *
   * @param textRef - The TextRef of the element that gained focus, or null if focus was lost
   */
  setFocused(textRef: TextRef | null): void {
    if (textRef === null) {
      this.focusedContainerId = null
    } else {
      this.focusedContainerId = this.getContainerId(textRef)
    }
  }

  /**
   * Get information about the currently focused element.
   *
   * @returns The focused element info, or null if no element is focused
   */
  getFocused(): FocusedElementInfo | null {
    if (this.focusedContainerId === null) {
      return null
    }

    const registered = this.elements.get(this.focusedContainerId)
    if (!registered) {
      return null
    }

    return {
      containerId: this.focusedContainerId,
      element: registered.element,
      textRef: registered.textRef,
      namespace: registered.namespace,
    }
  }

  /**
   * Get the element registered for a specific container ID.
   *
   * @param containerId - The container ID to look up
   * @returns The registered element info, or null if not found
   */
  getElement(containerId: string): RegisteredElement | null {
    return this.elements.get(containerId) ?? null
  }

  /**
   * Get all registered container IDs.
   *
   * @returns Array of all registered container IDs
   */
  getAllContainerIds(): string[] {
    return Array.from(this.elements.keys())
  }

  /**
   * Get the container ID for a TextRef.
   * Uses the underlying LoroText container's ID.
   */
  private getContainerId(textRef: TextRef): string {
    // TextRef wraps a LoroText container - get its ID via loro()
    // The container ID is stable and unique within a document
    return loro(textRef).container.id.toString()
  }
}
