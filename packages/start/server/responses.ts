import { FormError } from "../form/FormError";
import type { RequestContext } from "../entry-server/StartServer";

export const XSolidStartStatusCodeHeader = "x-solidstart-status-code";
export const XSolidStartLocationHeader = "x-solidstart-location";
export const LocationHeader = "Location";
export const ContentTypeHeader = "content-type";
export const XSolidStartResponseTypeHeader = "x-solidstart-response-type";
export const XSolidStartContentTypeHeader = "x-solidstart-content-type";
export const XSolidStartOrigin = "x-solidstart-origin";
export const JSONResponseType = "application/json";

declare global {
  interface Response {
    context?: Pick<RequestContext, "request" | "responseHeaders">;
  }

  interface ResponseInit {
    context?: Pick<RequestContext, "request" | "responseHeaders">;
  }
}
/**
 * A JSON response. Converts `data` to JSON and sets the `Content-Type` header.
 */
export function json<Data>(data: Data, init: number | ResponseInit = {}): Response {
  let responseInit: any = init;
  if (typeof init === "number") {
    responseInit = { status: init };
  }

  let headers = new Headers(responseInit.headers);

  if (!headers.has(ContentTypeHeader)) {
    headers.set(ContentTypeHeader, "application/json; charset=utf-8");
  }

  const response = new Response(JSON.stringify(data), {
    ...responseInit,
    headers
  });

  response.context = responseInit.context;
  return response;
}

/**
 * A redirect response. Sets the status code and the `Location` header.
 * Defaults to "302 Found".
 */
export function redirect(
  url: string,
  // we use 204 no content to signal that the response body is empty
  // and the X-Location header should be used instead to do the redirect client side
  init: number | ResponseInit = 302
): Response {
  let responseInit = init;
  if (typeof responseInit === "number") {
    responseInit = { status: responseInit };
  } else if (typeof responseInit.status === "undefined") {
    responseInit.status = 302;
  }

  const response = new Response(null, {
    ...responseInit,
    headers: {
      ...responseInit.headers,
      [XSolidStartLocationHeader]: url,
      [LocationHeader]: url
    }
  });

  response.context = responseInit.context;
  return response;
}

export function isResponse(value: any): value is Response {
  return (
    value != null &&
    typeof value.status === "number" &&
    typeof value.statusText === "string" &&
    typeof value.headers === "object" &&
    typeof value.body !== "undefined"
  );
}

const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

export function isRedirectResponse(response: Response): boolean {
  return response && response instanceof Response && redirectStatusCodes.has(response.status);
}

export class ResponseError extends Error implements Response {
  status: number;
  headers: Headers;
  name = "ResponseError";
  ok: boolean;
  statusText: string;
  redirected: boolean;
  url: string;
  constructor(response: Response) {
    let message = JSON.stringify({
      $type: "response",
      status: response.status,
      message: response.statusText,
      headers: [...response.headers.entries()]
    });
    super(message);
    this.status = response.status;
    this.headers = new Map([...response.headers.entries()]) as any as Headers;
    this.url = response.url;
    this.ok = response.ok;
    this.statusText = response.statusText;
    this.redirected = response.redirected;
    this.bodyUsed = false;
    this.type = response.type;
    this.response = () => response;
  }

  response: () => Response;
  type: ResponseType;
  clone(): Response {
    return this.response();
  }
  get body(): ReadableStream<Uint8Array> {
    return this.response().body;
  }
  bodyUsed: boolean;
  async arrayBuffer(): Promise<ArrayBuffer> {
    return await this.response().arrayBuffer();
  }
  async blob(): Promise<Blob> {
    return await this.response().blob();
  }
  async formData(): Promise<FormData> {
    return await this.response().formData();
  }

  async text() {
    return await this.response().text();
  }

  async json() {
    return await this.response().json();
  }
}

export function respondWith(
  request: Request,
  data: Response | Error | FormError | string | object,
  responseType: "throw" | "return"
) {
  if (data instanceof ResponseError) {
    data = data.clone();
  }

  if (data instanceof Response) {
    if (isRedirectResponse(data) && request.headers.get(XSolidStartOrigin) === "client") {
      data.headers.set(XSolidStartOrigin, "server");
      data.headers.set(XSolidStartLocationHeader, data.headers.get(LocationHeader));
      data.headers.set(XSolidStartResponseTypeHeader, responseType);
      data.headers.set(XSolidStartContentTypeHeader, "response");
      return new Response(null, {
        status: 204,
        headers: data.headers
      });
    } else {
      data.headers.set(XSolidStartResponseTypeHeader, responseType);
      data.headers.set(XSolidStartContentTypeHeader, "response");
      return data;
    }
  } else if (data instanceof FormError) {
    return new Response(
      JSON.stringify({
        error: {
          message: data.message,
          stack: data.stack,
          formError: data.formError,
          fields: data.fields,
          fieldErrors: data.fieldErrors
        }
      }),
      {
        status: 400,
        headers: {
          [XSolidStartResponseTypeHeader]: responseType,
          [XSolidStartContentTypeHeader]: "form-error"
        }
      }
    );
  } else if (data instanceof Error) {
    return new Response(
      JSON.stringify({
        error: {
          message: data.message,
          stack: data.stack,
          status: (data as any).status
        }
      }),
      {
        status: (data as any).status || 500,
        headers: {
          [XSolidStartResponseTypeHeader]: responseType,
          [XSolidStartContentTypeHeader]: "error"
        }
      }
    );
  } else if (
    typeof data === "object" ||
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  ) {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        [ContentTypeHeader]: "application/json",
        [XSolidStartResponseTypeHeader]: responseType,
        [XSolidStartContentTypeHeader]: "json"
      }
    });
  }

  return new Response("null", {
    status: 200,
    headers: {
      [ContentTypeHeader]: "application/json",
      [XSolidStartContentTypeHeader]: "json",
      [XSolidStartResponseTypeHeader]: responseType
    }
  });
}

export async function parseResponse(request: Request, response: Response) {
  const contentType =
    response.headers.get(XSolidStartContentTypeHeader) ||
    response.headers.get(ContentTypeHeader) ||
    "";
  if (contentType.includes("json")) {
    return await response.json();
  } else if (contentType.includes("text")) {
    return await response.text();
  } else if (contentType.includes("form-error")) {
    const data = await response.json();
    return new FormError(data.error.message, {
      fieldErrors: data.error.fieldErrors,
      fields: data.error.fields,
      stack: data.error.stack
    });
  } else if (contentType.includes("error")) {
    const data = await response.json();
    const error = new Error(data.error.message);
    if (data.error.stack) {
      error.stack = data.error.stack;
    }
    return error;
  } else if (contentType.includes("response")) {
    if (response.status === 204 && response.headers.get(LocationHeader)) {
      return redirect(response.headers.get(LocationHeader));
    }
    return response;
  } else {
    if (response.status === 200) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {}
    }
    if (response.status === 204 && response.headers.get(LocationHeader)) {
      return redirect(response.headers.get(LocationHeader));
    }
    return response;
  }
}
