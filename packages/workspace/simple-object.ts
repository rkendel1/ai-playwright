type SimpleValue = string | number | boolean | null | SimpleObject;

export type SimpleObject = {
  [key: string]: SimpleValue;
};

function stripLineComments(source: string): string {
  let output = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        i += 1;
      }
      output += "\n";
      continue;
    }

    output += char;
  }

  return output;
}

function extractObjectLiteral(source: string): string | null {
  const exportIndex = source.search(/\bexport\s+default\b/);
  if (exportIndex === -1) return null;

  const start = source.indexOf("{", exportIndex);
  if (start === -1) return null;

  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  return null;
}

class SimpleObjectParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): SimpleObject {
    const value = this.parseObject();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new Error(`Unexpected content at offset ${this.index}`);
    }
    return value;
  }

  private parseObject(): SimpleObject {
    const object: SimpleObject = {};
    this.expect("{");
    this.skipWhitespace();

    while (this.peek() !== "}") {
      const key = this.parseKey();
      this.skipWhitespace();
      this.expect(":");
      this.skipWhitespace();
      object[key] = this.parseValue();
      this.skipWhitespace();

      if (this.peek() === ",") {
        this.index += 1;
        this.skipWhitespace();
        continue;
      }

      break;
    }

    this.expect("}");
    return object;
  }

  private parseKey(): string {
    const char = this.peek();
    if (char === '"' || char === "'") return this.parseString();

    const match = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(this.source.slice(this.index));
    if (!match) {
      throw new Error(`Expected property name at offset ${this.index}`);
    }
    this.index += match[0].length;
    return match[0];
  }

  private parseValue(): SimpleValue {
    const char = this.peek();
    if (char === '"' || char === "'") return this.parseString();
    if (char === "{") return this.parseObject();

    const remaining = this.source.slice(this.index);
    const literal = /^(true|false|null)\b/.exec(remaining);
    if (literal) {
      this.index += literal[0].length;
      if (literal[0] === "true") return true;
      if (literal[0] === "false") return false;
      return null;
    }

    const number = /^-?\d+(?:\.\d+)?/.exec(remaining);
    if (number) {
      this.index += number[0].length;
      return Number(number[0]);
    }

    throw new Error(`Expected simple value at offset ${this.index}`);
  }

  private parseString(): string {
    const quote = this.peek();
    this.index += 1;
    let value = "";
    let escaped = false;

    while (this.index < this.source.length) {
      const char = this.source[this.index];
      this.index += 1;

      if (escaped) {
        if (char === "n") value += "\n";
        else if (char === "r") value += "\r";
        else if (char === "t") value += "\t";
        else value += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) return value;
      value += char;
    }

    throw new Error("Unterminated string literal");
  }

  private expect(expected: string): void {
    if (this.peek() !== expected) {
      throw new Error(`Expected '${expected}' at offset ${this.index}`);
    }
    this.index += 1;
  }

  private peek(): string {
    return this.source[this.index] ?? "";
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.peek())) {
      this.index += 1;
    }
  }
}

export function parseExportDefaultObject(source: string): SimpleObject | null {
  const literal = extractObjectLiteral(stripLineComments(source));
  if (!literal) return null;
  return new SimpleObjectParser(literal).parse();
}
