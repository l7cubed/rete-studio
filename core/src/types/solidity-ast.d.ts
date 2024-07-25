declare module 'solidity-ast' {
  // Adjust this interface based on the actual exports
  export interface ASTNode {
    type: string;
    [key: string]: any;
  }

  export function parseSolidity(code: string): ASTNode;
}
