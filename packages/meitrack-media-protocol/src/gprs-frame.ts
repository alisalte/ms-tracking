/**
 * Meitrack GPRS text frame parse/build (Meitrack GPRS Protocol §1.1).
 *
 *   Device → server:  $$<DataID><Length>,<IMEI>,<CommandCode>[,Content]*<Checksum>\r\n
 *   Server → device:  @@<DataID><Length>,<IMEI>,<CommandCode>[,Content]*<Checksum>\r\n
 *
 *   Length   = decimal count of chars from the FIRST comma through "\r\n" inclusive
 *   Checksum = modular byte sum (mod 256) from the flag through '*' inclusive,
 *              rendered as 2 uppercase hex digits
 *
 * The device may multiplex binary 0x12 media packets on the same connection, so
 * the Length field (not a \r\n scan) must locate the frame end — CCE bodies are
 * binary and can contain 0x0d/0x0a themselves.
 */

/** Parse outcome for one GPRS frame at the start of a buffer. */
export type ParseGprsFrameResult =
  | { readonly status: 'incomplete'; readonly need?: number }
  | { readonly status: 'invalid' }
  | {
      readonly status: 'ok';
      readonly consumed: number;
      readonly direction: 'reply' | 'command';
      readonly dataId: string;
      readonly length: number;
      readonly imei: string;
      readonly commandCode: string;
      readonly content: string;
      readonly validChecksum: boolean;
    };

/** Meitrack checksum: byte sum mod 256 of flag..'*' inclusive, 2 uppercase hex. */
export function gprsChecksum(buf: Buffer): number {
  let sum = 0;
  for (const b of buf) sum = (sum + b) & 0xff;
  return sum;
}

/**
 * Parse one GPRS text frame from the head of `buf`.
 * `invalid` means "not a frame here" — the caller skips a byte and retries.
 */
export function parseGprsFrame(buf: Buffer): ParseGprsFrameResult {
  if (buf.length < 2) return { status: 'incomplete' };
  const isReply = buf[0] === 0x24 && buf[1] === 0x24; // $$
  const isCmd = buf[0] === 0x40 && buf[1] === 0x40; // @@
  if (!isReply && !isCmd) return { status: 'invalid' };

  const firstComma = buf.indexOf(0x2c, 2);
  if (firstComma === -1) {
    return buf.length > 16 ? { status: 'invalid' } : { status: 'incomplete' };
  }
  if (firstComma < 4) return { status: 'invalid' }; // DataID + >=1 length digit + comma

  const dataId = String.fromCharCode(buf[2] ?? 0);
  const lengthStr = buf.subarray(3, firstComma).toString('ascii');
  const length = Number.parseInt(lengthStr, 10);
  if (Number.isNaN(length) || length < 4) return { status: 'invalid' };

  // Frame = flag(2) + dataId(1) + lengthStr + length (length spans comma..\r\n).
  const frameEnd = 2 + 1 + lengthStr.length + length;
  if (buf.length < frameEnd) {
    if (frameEnd > 65_536) return { status: 'invalid' }; // sanity guard
    return { status: 'incomplete', need: frameEnd };
  }

  // Terminator: ...*<CC>\r\n at the very end.
  if (buf[frameEnd - 2] !== 0x0d || buf[frameEnd - 1] !== 0x0a) return { status: 'invalid' };
  if (buf[frameEnd - 5] !== 0x2a) return { status: 'invalid' };

  const checksumHex = buf.subarray(frameEnd - 4, frameEnd - 2).toString('ascii');
  const body = buf.subarray(2, frameEnd - 5).toString('binary');
  const bodyFirstComma = body.indexOf(',');
  if (bodyFirstComma < 2) return { status: 'invalid' };

  const rest = body.substring(bodyFirstComma + 1); // <IMEI>,<CommandCode>[,Content]
  const imeiEnd = rest.indexOf(',');
  let imei = rest;
  let remainder = '';
  if (imeiEnd !== -1) {
    imei = rest.substring(0, imeiEnd);
    remainder = rest.substring(imeiEnd + 1);
  }

  let commandCode = remainder;
  let content = '';
  const cmdEnd = remainder.indexOf(',');
  if (cmdEnd !== -1) {
    commandCode = remainder.substring(0, cmdEnd);
    content = remainder.substring(cmdEnd + 1);
  }

  const calc = gprsChecksum(buf.subarray(0, frameEnd - 4));
  const recv = Number.parseInt(checksumHex, 16);

  return {
    status: 'ok',
    consumed: frameEnd,
    direction: isReply ? 'reply' : 'command',
    dataId,
    length,
    imei,
    commandCode,
    content,
    validChecksum: calc === recv,
  };
}

/**
 * Build a server→device text command frame:
 *   @@<DataID><Length>,<IMEI>,<CommandCode>[,<Content>]*<CC>\r\n
 */
export function buildGprsCommand(
  imei: string,
  commandCode: string,
  content = '',
  dataId = 'A',
): Buffer {
  const commaBlock = `,${imei},${commandCode}${content ? `,${content}` : ''}`;
  // Length = commaBlock + '*' + checksum(2) + '\r\n'(2).
  const length = commaBlock.length + 1 + 2 + 2;
  const head = `@@${dataId}${String(length)}`;
  const checksumRegion = Buffer.from(`${head}${commaBlock}*`, 'ascii');
  const cs = gprsChecksum(checksumRegion);
  const csHex = cs.toString(16).toUpperCase().padStart(2, '0');
  return Buffer.from(`${head}${commaBlock}*${csHex}\r\n`, 'ascii');
}

/**
 * Build a device→server text frame (simulator): $$<DataID><Length>,…
 * Same shape as buildGprsCommand with the $$ flag.
 */
export function buildGprsReply(
  imei: string,
  commandCode: string,
  content = '',
  dataId = 'A',
): Buffer {
  const commaBlock = `,${imei},${commandCode}${content ? `,${content}` : ''}`;
  const length = commaBlock.length + 1 + 2 + 2;
  const head = `$$${dataId}${String(length)}`;
  const checksumRegion = Buffer.from(`${head}${commaBlock}*`, 'ascii');
  const cs = gprsChecksum(checksumRegion);
  const csHex = cs.toString(16).toUpperCase().padStart(2, '0');
  return Buffer.from(`${head}${commaBlock}*${csHex}\r\n`, 'ascii');
}

/** A9A decoded from an @@ frame's binary content (after `A9A,`). */
export interface A9aStruct {
  readonly server: string;
  readonly tcpPort: number;
  readonly udpPort: number;
  readonly channel: number;
  readonly dataType: number;
  readonly streamType: number;
}

/**
 * Decode the binary A9A struct (§3.16): ip_len(1) + ip + tcp(2) + udp(2) +
 * channel(1) + data_type(1) + stream_type(1). Used by the simulator to learn
 * where to dial back, and by tests as the inverse of the platform's builder.
 */
export function decodeA9aStruct(body: Buffer): A9aStruct | null {
  if (body.length < 1) return null;
  const ipLen = body[0] ?? 0;
  if (ipLen > 64 || body.length < 1 + ipLen + 7) return null;
  const server = body.subarray(1, 1 + ipLen).toString('ascii');
  const off = 1 + ipLen;
  return {
    server,
    tcpPort: body.readUInt16BE(off),
    udpPort: body.readUInt16BE(off + 2),
    channel: body[off + 4] ?? 0,
    dataType: body[off + 5] ?? 0,
    streamType: body[off + 6] ?? 0,
  };
}

/**
 * Build a device→server frame with a BINARY body (CCE): `$$<id><len>,<IMEI>,CCE,<body>*<cc>\r\n`.
 * Length counts bytes from the first comma through `\r\n` inclusive; the
 * checksum is the byte sum over the flag..`*` region — identical rules to the
 * text frames, just byte-wise.
 */
export function buildGprsBinaryReply(
  imei: string,
  commandCode: string,
  body: Buffer,
  dataId = 'A',
): Buffer {
  const head = Buffer.from(`$$${dataId}`, 'ascii');
  const commaBlock = Buffer.concat([
    Buffer.from(',', 'ascii'),
    Buffer.from(imei, 'ascii'),
    Buffer.from(`,${commandCode},`, 'ascii'),
    body,
  ]);
  const length = commaBlock.length + 1 + 2 + 2; // '*' + checksum(2) + \r\n(2)
  const lengthBytes = Buffer.from(String(length), 'ascii');
  const checksumRegion = Buffer.concat([head, lengthBytes, commaBlock, Buffer.from('*', 'ascii')]);
  const cs = gprsChecksum(checksumRegion).toString(16).toUpperCase().padStart(2, '0');
  return Buffer.concat([checksumRegion, Buffer.from(cs, 'ascii'), Buffer.from('\r\n', 'ascii')]);
}
