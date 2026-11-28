/*
 * Leitor do formato KeyValues binário usado pelo cliente Steam nos arquivos de cache
 * (appcache/stats/*.bin). Só leitura; tipos não suportados interrompem a leitura com erro claro.
 */
export type KvValue = string | number | bigint | KvObject;
export type KvObject = { [key: string]: KvValue };

const TYPE = { object: 0, string: 1, int32: 2, float32: 3, pointer: 4, wstring: 5, color: 6, uint64: 7, end: 8, int64: 10, endAlt: 11 };

export class KeyValuesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyValuesError";
  }
}

export function parseBinaryKeyValues(buffer: Buffer): KvObject {
  let offset = 0;
  const need = (bytes: number) => {
    if (offset + bytes > buffer.length) throw new KeyValuesError(`arquivo truncado na posição ${offset}`);
  };
  const readString = () => {
    const end = buffer.indexOf(0, offset);
    if (end < 0) throw new KeyValuesError(`texto sem terminador na posição ${offset}`);
    const value = buffer.toString("utf8", offset, end);
    offset = end + 1;
    return value;
  };
  const readObject = (depth: number): KvObject => {
    if (depth > 32) throw new KeyValuesError("aninhamento excessivo");
    const out: KvObject = {};
    while (offset < buffer.length) {
      const type = buffer[offset++];
      if (type === TYPE.end || type === TYPE.endAlt) return out;
      const key = readString();
      switch (type) {
        case TYPE.object:
          out[key] = readObject(depth + 1);
          break;
        case TYPE.string:
          out[key] = readString();
          break;
        case TYPE.int32:
        case TYPE.pointer:
        case TYPE.color:
          need(4);
          out[key] = buffer.readInt32LE(offset);
          offset += 4;
          break;
        case TYPE.float32:
          need(4);
          out[key] = buffer.readFloatLE(offset);
          offset += 4;
          break;
        case TYPE.uint64:
          need(8);
          out[key] = buffer.readBigUInt64LE(offset);
          offset += 8;
          break;
        case TYPE.int64:
          need(8);
          out[key] = buffer.readBigInt64LE(offset);
          offset += 8;
          break;
        default:
          throw new KeyValuesError(`tipo ${type} não suportado na posição ${offset - 1}`);
      }
    }
    return out;
  };
  return readObject(0);
}

export const kvObject = (value: KvValue | undefined): KvObject | null =>
  value && typeof value === "object" ? (value as KvObject) : null;

export const kvNumber = (value: KvValue | undefined): number | null =>
  typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : null;

export const kvString = (value: KvValue | undefined): string | null => (typeof value === "string" ? value : null);
