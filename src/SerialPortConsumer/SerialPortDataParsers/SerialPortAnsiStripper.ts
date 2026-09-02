const ANSI_ESCAPE_SEQUENCE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export class SerialPortAnsiStripper {
  strip(data: Buffer): Buffer {
    return Buffer.from(data.toString('utf-8').replace(ANSI_ESCAPE_SEQUENCE, ''), 'utf-8');
  }
}
