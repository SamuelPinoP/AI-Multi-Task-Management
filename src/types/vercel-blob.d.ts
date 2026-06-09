declare module "@vercel/blob" {
  export function put(
    pathname: string,
    body: File,
    options: {
      access: "public";
      addRandomSuffix?: boolean;
      contentType?: string;
      token?: string;
      multipart?: boolean;
    },
  ): Promise<{ pathname: string; url: string }>;

  export function del(urlOrPathname: string, options?: { token?: string }): Promise<void>;
}
