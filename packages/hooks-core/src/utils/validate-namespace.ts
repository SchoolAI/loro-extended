/**
 * Namespace validation for undo manager namespaces.
 *
 * Namespaces are used to isolate undo stacks for different parts of a document.
 * They must follow specific rules to ensure they work correctly with Loro's
 * commit origin system.
 */

/**
 * Pattern for valid namespace strings.
 * - Must start with a letter (a-z, A-Z)
 * - Can contain letters, numbers, underscores, and hyphens
 * - Maximum length of 64 characters
 */
const NAMESPACE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/**
 * Validates a namespace string.
 *
 * @param namespace - The namespace to validate
 * @throws Error if the namespace is invalid
 *
 * @example
 * ```ts
 * validateNamespace('header')      // OK
 * validateNamespace('body-content') // OK
 * validateNamespace('section_1')   // OK
 * validateNamespace('')            // throws
 * validateNamespace('123')         // throws (starts with number)
 * validateNamespace('a'.repeat(65)) // throws (too long)
 * ```
 */
export function validateNamespace(namespace: string): void {
  if (!NAMESPACE_PATTERN.test(namespace)) {
    throw new Error(
      `Invalid namespace "${namespace}". ` +
        `Namespaces must start with a letter, contain only letters, numbers, underscores, and hyphens, ` +
        `and be at most 64 characters long.`,
    )
  }
}

/**
 * Checks if a namespace string is valid without throwing.
 *
 * @param namespace - The namespace to check
 * @returns true if valid, false otherwise
 */
export function isValidNamespace(namespace: string): boolean {
  return NAMESPACE_PATTERN.test(namespace)
}

/**
 * Validates a namespace and logs a warning if invalid.
 *
 * This allows existing code with invalid namespaces to continue working
 * while alerting developers to fix the issue.
 *
 * @param namespace - The namespace to validate
 */
export function validateNamespaceSafe(namespace: string): void {
  if (!isValidNamespace(namespace)) {
    console.warn(
      `[validateNamespace] Invalid namespace "${namespace}". ` +
        `Namespaces must start with a letter, contain only letters, numbers, underscores, and hyphens, ` +
        `and be at most 64 characters long.`,
    )
  }
}
