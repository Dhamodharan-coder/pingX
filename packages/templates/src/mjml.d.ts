declare module 'mjml' {
  interface MjmlResult {
    html: string;
    errors: { line: number; message: string; tagName: string; formattedMessage: string }[];
  }
  export default function mjml2html(
    input: string,
    options?: { validationLevel?: 'strict' | 'soft' | 'skip'; minify?: boolean },
  ): Promise<MjmlResult>;
}
