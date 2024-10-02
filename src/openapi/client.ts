/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
export const createProxyClient = <Paths extends {}>() => {
  return {
    configure: <const RO extends RequestOptions>(options: RO) => createProxyClientInner<Paths, RO>(options, []),
  }
}

const createProxyClientInner = <Paths extends {}, const RO extends RequestOptions>(
  options: RO,
  segments: string[],
): ProxyClient<Paths, RO> => {
  options = {
    ...options,
    serializers: {
      ...defaultSerializers,
      ...options.serializers,
    },
  }
  const method = (methodName: Method) => async (input: any) => {
    input ||= {}
    const headers = new Headers({...options.headers, ...input.headers})
    let body: BodyInit | null | undefined
    if ('json' in input) {
      body = JSON.stringify(input.json)
      headers.set('content-type', 'application/json')
    } else if (input.content) {
      const [contentType, ...otherKeys] = Object.keys(input.content)
      if (otherKeys.length > 0) {
        throw new Error(`Multiple content types specified: ${Object.keys(input.content).join(', ')}`)
      }

      headers.set('content-type', contentType)
      const content = input.content[contentType]
      if (content instanceof Buffer) {
        body = content
      } else {
        const serializer = options.serializers?.[contentType as never] as RequestOptionSerializer | undefined
        body = serializer ? serializer.stringify(content) : content
      }
    }
    let url = options.baseUrl
    if (segments.length > 0) url += '/' + segments.join('/')
    if (input.query) url += `?${new URLSearchParams(input.query)}`

    const res = await fetch(url, {method: methodName, headers, body})
    const acceptStatus = input.acceptStatus || options.acceptStatus || ['2XX']
    const statusMatch = await matchStatuses(acceptStatus)
    const text = await res.clone().text()
    const partial = {
      response: res,
      $types: {} as any,
      $params: input,
      statusMatch,
      rawStatus: res.status,
      headers: res.headers,
    } satisfies Partial<ResponseHelpers<any, any, any>>

    async function matchStatuses(matches: StatusCodeMatchable[]) {
      const actualStatusDigits = res.status.toString().split('')
      const match = matches.find(s => {
        const expectedDigits = s.toLowerCase().split('')
        return (
          expectedDigits.length === 3 &&
          expectedDigits.every((ch, i) => {
            return ch === 'x' || ch === actualStatusDigits[i]
          })
        )
      })
      if (!match) {
        const message = `status code ${res.status} does not match any of the allowed status codes: ${matches.join(', ')}. text: ${await res.clone().text()}`
        throw new Error(message, {cause: res})
      }
      return match
    }

    function addSerializerGetters(obj: {}) {
      Object.entries(options.serializers as Record<string, RequestOptionSerializer>).forEach(
        ([contentType, serializer]: [string, RequestOptionSerializer]) => {
          const contentTypeFromHeader = res.headers.get('content-type')?.split(';')[0]
          Object.defineProperty(obj, serializer.key, {
            enumerable: contentTypeFromHeader === contentType,
            get() {
              if (contentTypeFromHeader !== contentType) {
                throw new Error(`content-type header is ${contentTypeFromHeader}, so can't parse as ${contentType}`)
              }
              return serializer.parse(text)
            },
          })
        },
      )
    }

    addSerializerGetters(partial)

    return partial as never
  }
  const methods: Record<Method, ReturnType<typeof method>> = {
    get: method('get'),
    post: method('post'),
    put: method('put'),
    delete: method('delete'),
    options: method('options'),
    head: method('head'),
    patch: method('patch'),
    trace: method('trace'),
  }
  const definePathParamFn = (value: string) => {
    return createProxyClientInner<Paths, RO>(options, [...segments.slice(0, -1), value])
  }
  return new Proxy(Object.assign(definePathParamFn, methods), {
    get(_, p: string) {
      if (p === '$options') return options
      if (p in methods) return methods[p as Method]
      return createProxyClientInner<Paths, RO>(options, [...segments, p])
    },
  }) as never
}

export type ProxyClient<Paths extends {}, RO extends RequestOptions, Trace extends [{}, string] = [Paths, '']> = {
  [K in Root<keyof Paths> as K extends `{${string}}` ? never : K]: ProxyClientRHSValue<Paths, K, RO, Trace>
} & {
  [K in Root<keyof Paths> as K extends `{${infer Name}}` ? Name : never]: (
    value: string,
  ) => ProxyClientRHSValue<Paths, K, RO, Trace>
} & {
  $options: RO
  /** compile-time only type info for the full path. Useful for cmd-clicking into the source types */
  $types: Pick<Trace[0], Extract<Trace[1], keyof Trace[0]>>
}

type ProxyClientRHSValue<
  Paths extends {},
  K extends string,
  BaseRequestOptions extends RequestOptions,
  Trace extends [{}, string],
> = (`/${K}` extends keyof Paths
  ? Paths[`/${K}`] extends infer Def
    ? Cleanup<{
        get: EndpointFnOf<Def, 'get', BaseRequestOptions, Trace>
        post: EndpointFnOf<Def, 'post', BaseRequestOptions, Trace>
        put: EndpointFnOf<Def, 'put', BaseRequestOptions, Trace>
        delete: EndpointFnOf<Def, 'delete', BaseRequestOptions, Trace>
        options: EndpointFnOf<Def, 'options', BaseRequestOptions, Trace>
        head: EndpointFnOf<Def, 'head', BaseRequestOptions, Trace>
        patch: EndpointFnOf<Def, 'patch', BaseRequestOptions, Trace>
        trace: EndpointFnOf<Def, 'trace', BaseRequestOptions, Trace>
      }>
    : never
  : {}) &
  ProxyClient<
    {[L in keyof Paths as L extends `/${K}${infer Rest}` ? Rest : never]: Paths[L]}, //
    BaseRequestOptions,
    [Trace[0], `${Trace[1]}/${K}`]
  >

type Method = 'get' | 'post' | 'put' | 'delete' | 'options' | 'head' | 'patch' | 'trace'
type NoBodyMethod = 'get' | 'options' | 'head' | 'trace'

type GetOr<T, K extends string, Default = {}> = K extends keyof T ? T[K] : Default
type GetRequestOption<RO extends RequestOptions, K extends keyof RequestOptions> = GetOr<RO, K>

type QueryParameters<Def, _RO extends RequestOptions> = Def extends {parameters: {query?: {}}}
  ? Def['parameters']['query']
  : Def extends {parameters: {query: {}}}
    ? Def['parameters']['query']
    : never

type HeadersLike = {
  [H in Header]?: string | string[] | undefined
}
type HeaderParameters<Def, RO extends RequestOptions> = Def extends {parameters: {header: infer H}}
  ? SomeOptional<H, keyof GetRequestOption<RO, 'headers'>> & HeadersLike
  : HeadersLike

type RequestBodyParameters<Def, M extends Method, RO extends RequestOptions> = Def extends {requestBody?: infer RB}
  ? RequestBodyInput<RB, M, RO>
  : {}
type CookieParameters<Def, _RO extends RequestOptions> = Get<Def, ['parameters', 'cookie'], Record<string, string>>

type Get<T, Path extends (string | number)[], Default = undefined> = Path extends []
  ? T
  : Path extends [infer First, ...infer Rest]
    ? First extends keyof T
      ? Get<T[First], Extract<Rest, (string | number)[]>, Default>
      : Default
    : Default

type AnyRequestBody = {
  content?: {[K in ContentType]?: unknown}
}

type RequestOptionSerializer = {
  key: string
  parse: (body: string) => unknown
  stringify: (body: unknown) => string
}

type RequestOptions = {
  baseUrl: string
  headers?: Record<string, string>
  /** default ['2XX'] */
  acceptStatus?: AllowableStatusCode[]
  serializers?: {
    [K in ContentType]?: RequestOptionSerializer | null
  }
}

type ShallowMerge<A, B> = {
  [K in keyof A | keyof B]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : never
}

type RequestOptionSerializerKey<S extends RequestOptions['serializers']> =
  S extends Record<infer _CT, {key: infer Key} | null | undefined> ? Extract<Key, string> : never

const defaultSerializers = {
  'application/json': {
    key: 'json',
    parse: JSON.parse,
    stringify: JSON.stringify,
  },
  'text/plain': {
    key: 'text',
    parse: body => body,
    stringify: String,
  },
} as const satisfies RequestOptions['serializers']
type DefaultSerializers = typeof defaultSerializers

type GetRequestOptionSerializersByKey<RO extends RequestOptions> =
  ShallowMerge<DefaultSerializers, RO['serializers']> extends infer Serializers extends RequestOptions['serializers']
    ? {
        [K in RequestOptionSerializerKey<Serializers>]: Extract<
          {[CT in keyof Serializers]: Serializers[CT] & {contentType: CT}}[keyof Serializers], //
          {key: K}
        >
      }
    : never

type RequestBodyInput<RB, M extends Method, Options extends RequestOptions> = M extends NoBodyMethod
  ? {}
  : RB extends {}
    ?
        | {content: Partial<GetOr<RB, 'content'>>}
        | (GetRequestOptionSerializersByKey<Options> extends infer Serializers
            ? {
                [K in keyof Serializers]?: Serializers[K] extends {contentType: infer CT extends ContentType}
                  ? RB extends {content: {[_CT in CT]: infer Shape}}
                    ? Shape
                    : never
                  : never
              }
            : RB extends {content: infer Content}
              ? {content: Content}
              : AnyRequestBody)
    : AnyRequestBody

type ResponseHeaders<R> = R extends {headers: infer H} ? H & Headers : never

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type PositiveDigit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type StringDigit = `${Digit}`
type _StatusCode = `${PositiveDigit}${StringDigit}${StringDigit}`
type X = 'X'
type StatusCodeMatchable = `${PositiveDigit | X}${StringDigit | X}${StringDigit | X}`

type CheckMatchable<L extends string, R extends string> = L extends ''
  ? R extends ''
    ? true
    : false
  : L extends `${'X' | R[0]}${infer LTail}`
    ? R extends `${R[0]}${infer RTail}`
      ? CheckMatchable<LTail, RTail>
      : false
    : false

type _SelectStatusCodeValues<DefResponses, StatusCode extends StatusCodeMatchable> = {
  [K in keyof DefResponses]: CheckMatchable<`${Extract<K, string | number>}`, StatusCode> extends true
    ? DefResponses[K]
    : never
}[keyof DefResponses]

type ResponseHelpers<Def, BaseRequestOptions extends RequestOptions, Params> = {
  [S in AcceptedStatus<
    BaseRequestOptions,
    Params
  >]: {
    // prettier-ignore
    // @ts-expect-error trust me bro
    [K in keyof GetRequestOptionSerializersByKey<BaseRequestOptions>]: Def['responses'][Extract<S, `${keyof Def['responses']}`>]['content'][GetRequestOptionSerializersByKey<BaseRequestOptions>[K]['contentType']]
  } & {
    headers: ResponseHeaders<Def>
    statusMatch: S
    rawStatus: number
    /** The raw `fetch` response object */
    response: Response
    $types: Def
    $params: Params
  }
}[AcceptedStatus<BaseRequestOptions, Params>]

type AcceptedStatus<BaseRequestOptions extends RequestOptions, Params> = Params extends {
  acceptStatus: AllowableStatusCode[]
}
  ? Params['acceptStatus'][number]
  : BaseRequestOptions['acceptStatus'] extends AllowableStatusCode[]
    ? BaseRequestOptions['acceptStatus'][number]
    : '200' | '201' | '202'

type EndpointFnParams<
  Def,
  M extends Method,
  RO extends RequestOptions,
  Trace extends [{}, string],
> = RequestBodyParameters<Def, M, RO> &
  OptionalizeEmpties<{
    query: QueryParameters<Def, RO>
    headers: HeaderParameters<Def, RO>
    cookie?: Partial<CookieParameters<Def, RO>>
    acceptStatus?: AllowableStatusCode[]
    $types?: Pick<Trace[0], Extract<Trace[1], keyof Trace[0]>>
  }>

type OptionalizeEmpties<T> = Cleanup<{
  [K in keyof T]: [T[K]] extends [never] ? never : {} extends NonNullable<T[K]> ? T[K] | undefined : T[K]
}>

type EndpointFn<Def, M extends Method, BaseRequestOptions extends RequestOptions, Trace extends [{}, string]> =
  EndpointFnParams<Def, M, BaseRequestOptions, Trace> extends infer Params
    ? {} extends Params
      ? <P extends Partial<Params>>(input?: Params & P) => Promise<ResponseHelpers<Def, BaseRequestOptions, P>>
      : <P extends Partial<Params>>(input: Params & P) => Promise<ResponseHelpers<Def, BaseRequestOptions, P>>
    : never
type EndpointFnOf<
  Parent,
  M extends Method,
  BaseRequestOptions extends RequestOptions,
  Trace extends [{}, string],
> = Parent extends {
  [K in M]: infer D
}
  ? EndpointFn<D, M, BaseRequestOptions, Trace>
  : never

export type Split<S extends string, Delimiter extends string> = S extends `${infer Start}${Delimiter}${infer End}`
  ? [Start, ...Split<End, Delimiter>]
  : [S]

type Root<Path extends string | number | symbol> = Path extends `/${infer X}` ? Split<X, '/'>[0] : never

type SomeOptional<T, K extends string | number | symbol> = Partial<Pick<T, K & keyof T>> & Omit<T, K>

type CommonStatusCodes =
  | 200
  | 201
  | 202
  | 204
  | 301
  | 302
  | 304
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 422
  | 429
  | 500
  | 502
  | 503
  | 504
type AllowableStatusCode = CommonStatusCodes | StatusCodeMatchable | (number & {})
type CommonContentType =
  | `application/json`
  | `application/x-www-form-urlencoded`
  | `multipart/form-data`
  | `text/plain`
  | `image/png`
  | `image/jpeg`
  | `image/webp`
  | `video/mp4`
  | `video/quicktime`
  | `video/x-ms-wmv`
  | `video/x-ms-asf`
  | `video/x-flv`
  | `video/avi`
  | `video/mov`
  | `video/wmv`
  | `video/3gpp`
  | `video/3gpp2`
  | `video/mp2t`
  | `video/mpeg`

type ContentType = CommonContentType | (`${string}/${string}` & {})

type CommonHeaders =
  | 'content-type'
  | 'accept'
  | 'user-agent'
  | 'authorization'
  | 'cookie'
  | 'set-cookie'
  | 'location'
  | 'content-length'
  | 'content-encoding'
  | 'content-language'
  | 'content-disposition'
  | 'content-range'
  | 'content-security-policy'
  | 'expires'
  | 'last-modified'
  | 'pragma'
  | 'cache-control'
  | 'if-none-match'
  | 'if-modified-since'
  | 'if-unmodified-since'
  | 'if-match'
  | 'if-range'
  | 'range'
  | 'etag'
  | 'date'
  | 'server'
  | 'age'
  | 'vary'
  | 'www-authenticate'
  | 'proxy-authenticate'
  | 'proxy-authorization'
  | 'refresh'
  | 'retry-after'

type Header = CommonHeaders | (string & {})

// 10-02

type NeverableKeys<T> = {
  [K in keyof T]: [T[K]] extends [never] ? K : never
}[keyof T]

type UndefinedableKeys<T> = {
  [K in keyof T]: undefined extends T[K] ? K : never
}[keyof T]

type NonUndefinedableKeys<T> = {
  [K in keyof T]: T[K] extends {} | null ? K : never
}[keyof T]

/**
 * Makes a type more ergonomic in a couple of opinionated ways:
 * - Drops keys whose value type is `never`
 * - Makes optional keys whose value type includes `undefined`
 *
 * @example
 * type Input = {a: 1; b: never; c: 3 | undefined}
 * type Output = Cleanup<Input> // equivalent to {a: 1; c?: 3}
 */
type Cleanup<T> = Pick<
  {
    [K in keyof T]?: T[K]
  },
  UndefinedableKeys<T>
> &
  Pick<
    {
      [K in keyof T]: T[K]
    },
    Exclude<NonUndefinedableKeys<T>, NeverableKeys<T>>
  >
