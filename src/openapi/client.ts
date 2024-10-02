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
    if (input && 'json' in input) {
      body = JSON.stringify(input.json)
      headers.set('content-type', 'application/json')
    } else if (input && 'content' in input) {
      const contentType = Object.keys(input.content)[0]
      const serializer = options.serializers?.[contentType]
      const content = input.content[contentType]
      body = serializer ? serializer.stringify(content) : content
      headers.set('content-type', contentType)
    }
    let url = options.baseUrl
    if (segments.length > 0) url += '/' + segments.join('/')
    if (input.query) url += `?${new URLSearchParams(input.query)}`

    const res = await fetch(url, {method: methodName, headers, body})
    const text = await res.clone().text()
    const partial = {
      // text: () => res.text(),
      // blob: () => res.blob(),
      // arrayBuffer: () => res.arrayBuffer(),
      matchStatus: (...matches: StatusCodeMatchable[]) => {
        const match = matchStatuses(matches)
        const result = {match, headers: res.headers, status: res.status}
        addSerializerGetters(result, matches)
        return result
      },
      $types: {} as any,
      $params: input,
      status: res.status,
      headers: res.headers,
    }

    function matchStatuses(matches: StatusCodeMatchable[]) {
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
        const message = `status code ${res.status} does not match any of the allowed status codes: ${matches.join(', ')}`
        throw new Error(message)
      }
      return match
    }

    function addSerializerGetters(obj: {}, matches: StatusCodeMatchable[]) {
      Object.entries(options.serializers as Record<string, RequestOptionSerializer>).forEach(
        ([contentType, serializer]: [string, RequestOptionSerializer]) => {
          Object.defineProperty(obj, serializer.key, {
            enumerable: true,
            get() {
              matchStatuses(matches)
              const contentTypeFromHeader = res.headers.get('content-type')?.split(';')[0]
              if (contentTypeFromHeader !== contentType) {
                throw new Error(`content-type header is ${contentTypeFromHeader}, so can't parse as ${contentType}`)
              }
              return serializer.parse(text)
            },
          })
        },
      )
    }

    addSerializerGetters(partial, ['200', '201', '202'])

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
  RO extends RequestOptions,
  Trace extends [{}, string],
> = (`/${K}` extends keyof Paths
  ? Paths[`/${K}`] extends infer D
    ? Cleanup<{
        get: EndpointFnOf<D, 'get', RO>
        post: EndpointFnOf<D, 'post', RO>
        put: EndpointFnOf<D, 'put', RO>
        delete: EndpointFnOf<D, 'delete', RO>
        options: EndpointFnOf<D, 'options', RO>
        head: EndpointFnOf<D, 'head', RO>
        patch: EndpointFnOf<D, 'patch', RO>
        trace: EndpointFnOf<D, 'trace', RO>
      }>
    : never
  : {}) &
  ProxyClient<
    {[L in keyof Paths as L extends `/${K}${infer Rest}` ? Rest : never]: Paths[L]}, //
    RO,
    [Trace[0], `${Trace[1]}/${K}`]
  >

type Droppable<T> = [T] extends [undefined] ? true : false
type Andable<T> = Droppable<T> extends true ? never : unknown
type GoodKeys<T> = {
  [K in keyof T]-?: Andable<T[K]> & K
}[keyof T]
type DropNevers<T> = Optionalize<{
  [K in GoodKeys<T>]: T[K]
}>
type Optionalize<T> = Omit<
  {
    [K in OptionalKeys<T>]?: T[K]
  } & {
    [K in RequiredKeys<T>]-?: T[K]
  },
  never
>
type OptionalKeys<T> = {
  [K in keyof T]: undefined extends T[K] ? K : never
}[keyof T]
type RequiredKeys<T> = {
  [K in keyof T]: undefined extends T[K] ? never : K
}[keyof T]

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
  status?: {
    type: 'accept' // | 'reject'
    match: AllowableStatusCode[]
  }
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
type StatusCode = `${PositiveDigit}${StringDigit}${StringDigit}`
type X = 'X'
type StatusCodeMatchable = `${PositiveDigit | X}${StringDigit | X}${StringDigit | X}`

type GetRequestOptionStatus<RO extends RequestOptions> = RO extends {status: {type: 'accept'; match: [...infer MS]}}
  ? MS[number]
  : '200'

type ResolveRequestOptions<RO extends RequestOptions> = {
  serializersByKey: GetRequestOptionSerializersByKey<RO>
  status: GetRequestOptionStatus<RO>
}

// type ProxyType<T> = {
//   [K in string]: K extends '$end' ? T : K extends keyof T ? ProxyType<T[K]> : ProxyType<[K, {}]>
// }

// type GenericThing<T> = {
//   status: ProxyType<T>['foo']
// }

type ResponseHelpers<Def, RO extends RequestOptions, Params> = {
  // @ts-expect-error trust me bro
  [K in keyof GetRequestOptionSerializersByKey<RO>]: Def['responses']['200']['content'][GetRequestOptionSerializersByKey<RO>[K]['contentType']]
} & {
  headers: ResponseHeaders<Def>
  status: number
  matchStatus: <TStatus extends StatusCodeMatchable>(
    ...statuses: TStatus[]
  ) => {
    [S in TStatus]: {
      match: S
      // @ts-expect-error trust me bro
      headers: ResponseHeaders<Def['responses'][S]>
    } & {
      // @ts-expect-error trust me bro
      [K in keyof GetRequestOptionSerializersByKey<RO>]: Def['responses'][S]['content'][GetRequestOptionSerializersByKey<RO>[K]['contentType']]
    }
  }[TStatus]
  // text: () => Promise<string>
  // blob: () => Promise<Blob>
  // arrayBuffer: () => Promise<ArrayBuffer>
  $types: Def
  $params: Params
}

type EndpointFnParams<Def, M extends Method, RO extends RequestOptions> = RequestBodyParameters<Def, M, RO> &
  OptionalizeEmpties<{
    query: QueryParameters<Def, RO>
    headers: HeaderParameters<Def, RO>
    cookie?: Partial<CookieParameters<Def, RO>>
  }>

// type OptionalizeEmpties<T> = DropNevers<{
//   [K in keyof T]?: {} extends T[K] ? T[K] : never
// }> &
//   DropNevers<{
//     [K in keyof T]: {} extends T[K] ? never : T[K]
//   }>

type OptionalizeEmpties<T> = Cleanup<{
  [K in keyof T]: [T[K]] extends [never] ? never : {} extends NonNullable<T[K]> ? T[K] | undefined : T[K]
}>

type EndpointFn<Def, M extends Method, RO extends RequestOptions> =
  EndpointFnParams<Def, M, RO> extends infer Params
    ? {} extends Params
      ? <P extends Partial<Params>>(input?: Params & P) => Promise<ResponseHelpers<Def, RO, P>>
      : <P extends Partial<Params>>(input: Params & P) => Promise<ResponseHelpers<Def, RO, P>>
    : never
type EndpointFnOf<Parent, M extends Method, RO extends RequestOptions> = Parent extends {[K in M]: infer D}
  ? EndpointFn<D, M, RO>
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
