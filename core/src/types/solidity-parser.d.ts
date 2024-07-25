declare module 'solidity-parser' {
  export function parse(code: string): any;
  export function generate(ast: any): string;
}
