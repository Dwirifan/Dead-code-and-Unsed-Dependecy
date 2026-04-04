import * as acorn from "acorn";
import tsPlugin from "acorn-typescript";

const parser = acorn.Parser.extend(tsPlugin());

/**
 * Parses a string of JavaScript or TypeScript code into an Abstract Syntax Tree (AST).
 * @param {string} codeString - The source code to parse.
 * @returns {object} The generated AST node.
 */
export function parseCode(codeString) {
  try {
    return parser.parse(codeString, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true, // Useful for reporting errors/positions
    });
  } catch (error) {
    throw new Error(`Failed to parse code: ${error.message}`);
  }
}
