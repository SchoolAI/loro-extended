import { describe, expect, it } from "bun:test"
import { isValidUsername, USERNAME_REGEX } from "./schema"

describe("isValidUsername", () => {
  describe("valid usernames", () => {
    it("accepts minimum length (3 chars)", () => {
      expect(isValidUsername("abc")).toBe(true)
    })

    it("accepts maximum length (20 chars)", () => {
      expect(isValidUsername("A1B2C3D4E5F6G7H8I9J0")).toBe(true)
    })

    it("accepts alphanumeric with underscore", () => {
      expect(isValidUsername("user_123")).toBe(true)
    })

    it("accepts all lowercase", () => {
      expect(isValidUsername("username")).toBe(true)
    })

    it("accepts all uppercase", () => {
      expect(isValidUsername("USERNAME")).toBe(true)
    })

    it("accepts all numbers", () => {
      expect(isValidUsername("12345")).toBe(true)
    })

    it("accepts mixed case with numbers and underscore", () => {
      expect(isValidUsername("User_Name_123")).toBe(true)
    })
  })

  describe("invalid usernames", () => {
    it("rejects too short (2 chars)", () => {
      expect(isValidUsername("ab")).toBe(false)
    })

    it("rejects too long (21 chars)", () => {
      expect(isValidUsername("a".repeat(21))).toBe(false)
    })

    it("rejects special characters (@)", () => {
      expect(isValidUsername("user@name")).toBe(false)
    })

    it("rejects special characters (-)", () => {
      expect(isValidUsername("user-name")).toBe(false)
    })

    it("rejects special characters (.)", () => {
      expect(isValidUsername("user.name")).toBe(false)
    })

    it("rejects spaces", () => {
      expect(isValidUsername("user name")).toBe(false)
    })

    it("rejects empty string", () => {
      expect(isValidUsername("")).toBe(false)
    })

    it("rejects single character", () => {
      expect(isValidUsername("a")).toBe(false)
    })
  })

  describe("USERNAME_REGEX", () => {
    it("is exported and matches the validation function", () => {
      expect(USERNAME_REGEX).toBeDefined()
      expect(USERNAME_REGEX.test("valid_user")).toBe(true)
      expect(USERNAME_REGEX.test("ab")).toBe(false)
    })
  })
})
