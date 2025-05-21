import * as path from 'node:path'
import * as zlib from 'node:zlib'
import openapiTS, {astToString, OpenAPI3} from 'openapi-typescript'
import * as tarStream from 'tar-stream'
import YAML from 'yaml'
import {z} from 'zod/v4'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const pathname = url.pathname
  const parsedOptions = Options.strict().safeParse(Object.fromEntries(url.searchParams))

  if (!parsedOptions.success) {
    const message = z.prettifyError(parsedOptions.error)
    return new Response(message, {
      status: 400,
      headers: {'Content-Type': 'text/plain; charset=utf-8'},
    })
  }

  const targetUrl = pathname.slice(pathname.indexOf('https')).replace(/^https:?\/+/, 'https://') // some server libraries convert https:// to https:/ when in pathnanme
  const specText = await fetch(targetUrl).then(r => r.text())

  const spec =
    targetUrl.endsWith('.yaml') || targetUrl.endsWith('.yml')
      ? (YAML.parse(specText) as OpenAPI3)
      : (JSON.parse(specText) as OpenAPI3)

  const {tgz, pkg} = await createNpmPackage(spec, parsedOptions.data)
  return new Response(tgz, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${pkg.name}-${pkg.version}.tgz"`,
    },
  })
}

// codegen:start {preset: custom, export: getOpenApiTsFlags, require: tsx/cjs}
// codegen:hash {input: 79a9a04cb35aa17703770dbc31dcab7f, output: 7e1cd77b87db84714576d28070d2bdbe, timestamp: 2025-05-21T20:36:33.731Z}
const OpenApiTsFlags = z.object({
  additionalProperties: z.stringbool().optional(),
  alphabetize: z.stringbool().optional(),
  arrayLength: z.stringbool().optional(),
  defaultNonNullable: z.stringbool().optional(),
  propertiesRequiredByDefault: z.stringbool().optional(),
  emptyObjectsUnknown: z.stringbool().optional(),
  enum: z.stringbool().optional(),
  enumValues: z.stringbool().optional(),
  dedupeEnums: z.stringbool().optional(),
  check: z.stringbool().optional(),
  excludeDeprecated: z.stringbool().optional(),
  exportType: z.stringbool().optional(),
  immutable: z.stringbool().optional(),
  pathParamsAsTypes: z.stringbool().optional(),
  rootTypes: z.stringbool().optional(),
  rootTypesNoSchemaPrefix: z.stringbool().optional(),
  makePathsEnum: z.stringbool().optional(),
  generatePathParams: z.stringbool().optional(),
})
// codegen:end

const Options = OpenApiTsFlags.extend({
  packageName: TemplatableString('name').prefault('{{name}}'),
  packageVersion: TemplatableString('version', 'epochTimestamp').prefault('{{version}}'),
  packageDescription: TemplatableString('original').prefault('Generated SDK for: {{original}}'),
  packageLicense: TemplatableString('license').prefault('{{license}}'),
  reactQuery: z.stringbool().optional(),
})

type Options = z.infer<typeof Options>

function TemplatableString<Variable extends string>(...variables: Variable[]) {
  return z.string().transform((str, ctx) => ({
    raw: str,
    format: (values: Record<Variable, string>) => {
      let result = str
      for (const v of variables) result = result.replaceAll(`{{${v}}}`, values[v])
      const templatedVariables = [...str.matchAll(/{{(.*?)}}/g)]
      if (templatedVariables.length) {
        const message = `Unexpected variables in string. Allowed: ${variables.map(v => `{{${v}}}`).join(', ') || 'none'}.`
        ctx.addIssue({code: 'custom', message})
      }
      return result
    },
  }))
}
async function createNpmPackage(spec: OpenAPI3, flags: Options) {
  const tsPaths = await openapiTS(spec, flags)
  const tsPathsString = astToString(tsPaths)

  const packageJsonObj = {
    name: flags.packageName.format({
      name: spec.info.title.toLowerCase().replaceAll(/\W/g, ' ').trim().replaceAll(/\s+/g, '-'),
    }),
    version: flags.packageVersion.format({
      version: spec.info.version,
      epochTimestamp: String(Math.floor(Date.now() / 1000)),
    }),
    description: flags.packageDescription.format({
      original: spec.info.description || spec.info.title,
    }),
    main: 'index.js',
    types: 'index.d.ts',
    license: flags.packageLicense.format({
      license: spec.info.license?.name || '',
    }),
    dependencies: undefined as Record<string, string> | undefined,
  }
  const packageJson = JSON.stringify(packageJsonObj, null, 2)

  const kebabToCamel = (str: string) => str.replaceAll(/-(\w)/g, (_, letter: string) => letter.toUpperCase())
  const createClientFnName = kebabToCamel(`create-${packageJsonObj.name}-client`)
  const entrypointDts = `
    import {paths} from './paths'
    export declare const ${createClientFnName}: () => {
      configure: <const RO extends import("./client").RequestOptions>(options: RO) => import("./client").ProxyClient<paths, RO, [paths, ""]>;
    };
  `
  const entrypointCjs = `
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.${createClientFnName} = void 0;
    const client_1 = require("./client");
    const ${createClientFnName} = () => (0, client_1.createProxyClient)();
    exports.${createClientFnName} = ${createClientFnName};
  `

  const files: FileEntry[] = [
    {name: 'package/package.json', content: packageJson},
    {name: 'package/index.js', content: entrypointCjs},
    {name: 'package/index.d.ts', content: entrypointDts},
    {name: 'package/paths.d.ts', content: tsPathsString},
    ...clientFiles.map(file => ({name: `package/${file.name}`, content: file.content})),
  ]

  if (flags.reactQuery) {
    // const createReactQueryClientFnName = kebabToCamel(`create-react-query-${packageJsonObj.name}-client`)
    // const reactQueryDts = `
    //   import {paths} from './paths'
    //   import {MediaType} from 'openapi-typescript-helpers'
    //   import {ClientOptions, Client} from "openapi-react-query"
    //   export declare function ${createReactQueryClientFnName}<Media extends MediaType = MediaType>(options?: ClientOptions): Client<paths, Media>
    // `
    // const reactQueryCjs = `
    //   "use strict";
    //   Object.defineProperty(exports, "__esModule", { value: true });
    //   exports.${createReactQueryClientFnName} = void 0;
    //   const client_1 = require("./client");
    //   const ${createReactQueryClientFnName} = () => (0, client_1.createProxyClient)();
    //   exports.${createReactQueryClientFnName} = ${createReactQueryClientFnName};
    // `
    // files.push({name: 'package/react-query.d.ts', content: reactQueryDts})
  }

  const tgz = await createTarGzBuffer(files)
  return {pkg: packageJsonObj, tgz}
}

type FileEntry = {name: string; content: string; mode?: number; mtime?: Date}
function createTarGzBuffer(files: FileEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Create a tar pack stream
    const pack = tarStream.pack()

    // Create gzip compression stream
    const gzip = zlib.createGzip()

    // Set up pipeline: pack -> gzip
    const tarGzStream = pack.pipe(gzip)

    // Collect chunks into a buffer
    const chunks: Buffer[] = []
    tarGzStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    tarGzStream.on('end', () => resolve(Buffer.concat(chunks)))
    tarGzStream.on('error', reject)

    // Track when we're done adding files
    let filesAdded = 0

    // Add each file to the archive
    files.forEach(file => {
      // Add file entry to the tar archive
      const entry = pack.entry(
        {
          name: file.name,
          size: Buffer.from(file.content).length,
          mode: file.mode || 0o644,
          mtime: file.mtime || new Date(),
        },
        err => {
          if (err) {
            reject(err)
            return
          }

          filesAdded++

          // If all files have been added, finalize the pack
          if (filesAdded === files.length) {
            pack.finalize()
          }
        },
      )

      // Write the file content to the entry
      entry.write(file.content)
      entry.end()
    })
  })
}

export const getOpenApiTsFlags: import('eslint-plugin-mmkal').CodegenPreset = ({
  dependencies: {cheerio, fetchSync},
  cache,
}) => {
  return cache({maxAge: '8 weeks'}, () => {
    const openapiTsDocs = fetchSync('https://openapi-ts.dev/cli')
    const $ = cheerio.load(openapiTsDocs.text)
    const table = $('#flags').nextAll('table').first()
    const props = table
      .find('tbody tr')
      .toArray()
      .flatMap(row => {
        const text = $(row).find('td').first().text()
        const [flagName, parameter] = text.split(' ')
        if (parameter) return [] // only allow boolean flags for now
        const prop = flagName.replace(/^--/, '').replaceAll(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        if (prop === 'help' || prop === 'version') return []
        return [prop]
      })
    return [
      `const OpenApiTsFlags = z.object({`,
      `  ${props.map(p => `${p}: z.stringbool().optional(),`).join('\n  ')}`,
      `})`,
    ].join('\n')
  })
}

export const getClientCode: import('eslint-plugin-mmkal').CodegenPreset = ({
  dependencies: {fs, child_process},
  context,
  meta,
}) => {
  const generatedAt = new Date(meta.existingContent.match(/generated at (20.*Z)/)?.[1] || 0)
  const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 24)
  if (generatedAt > yesterday) {
    return meta.existingContent
  }
  const dirname = path.dirname(context.physicalFilename)
  const sourceTsPath = path.join(dirname, '../../../../../openapi/client.ts')
  const tempOutDir = '/tmp/openapi/tscoutput'
  fs.mkdirSync(tempOutDir, {recursive: true})
  if (fs.readdirSync(tempOutDir).length > 0) {
    throw new Error(`tempOutDir ${tempOutDir} is not empty - run "rm -rf ${tempOutDir}" before retrying`)
  }
  try {
    child_process
      .execSync(`npx tsc --lib dom --module nodenext --declaration --outDir ${tempOutDir} ${sourceTsPath}`)
      .toString()
      .trim()
  } catch (error) {
    const e = error as {message?: string; stdout?: string; stderr?: string}
    // we don't really care if typescript fails, as long as it produces output
    if (fs.readdirSync(tempOutDir).length === 0) {
      throw new Error(`Failed to generate typescript: ${e.message}.\n\nStdout:\n${e.stdout}.\n\nStderr:\n${e.stderr}`)
    }
  }
  const files = fs.readdirSync(tempOutDir).map(file => {
    return {name: file, content: fs.readFileSync(path.join(tempOutDir, file), 'utf8')}
  })
  const lines = [
    `// generated at ${new Date().toISOString()}`,
    `export const clientFiles: FileEntry[] = ${JSON.stringify(files, null, 2)}`,
  ]

  fs.readdirSync(tempOutDir).forEach(file => {
    fs.unlinkSync(path.join(tempOutDir, file))
  })

  return lines.join('\n')
}

// codegen:start {preset: custom, export: getClientCode, require: tsx/cjs}
// generated at 2025-05-21T17:19:38.140Z
export const clientFiles: FileEntry[] = [
  {
    name: 'client.d.ts',
    content:
      "export declare const createProxyClient: <Paths extends {}>() => {\n    configure: <const RO extends RequestOptions>(options: RO) => ProxyClient<Paths, RO, [Paths, \"\"]>;\n};\nexport type ProxyClient<Paths extends {}, RO extends RequestOptions, Trace extends [{}, string] = [Paths, '']> = {\n    [K in Root<keyof Paths> as K extends `{${string}}` ? never : K]: ProxyClientRHSValue<Paths, K, RO, Trace>;\n} & {\n    [K in Root<keyof Paths> as K extends `{${infer Name}}` ? Name : never]: (value: string) => ProxyClientRHSValue<Paths, K, RO, Trace>;\n} & {\n    $options: RO;\n    /** compile-time only type info for the full path. Useful for cmd-clicking into the source types */\n    $types: Pick<Trace[0], Extract<Trace[1], keyof Trace[0]>>;\n};\ntype ProxyClientRHSValue<Paths extends {}, K extends string, BaseRequestOptions extends RequestOptions, Trace extends [{}, string]> = (`/${K}` extends keyof Paths ? Paths[`/${K}`] extends infer Def ? Cleanup<{\n    get: EndpointFnOf<Def, 'get', BaseRequestOptions, Trace>;\n    post: EndpointFnOf<Def, 'post', BaseRequestOptions, Trace>;\n    put: EndpointFnOf<Def, 'put', BaseRequestOptions, Trace>;\n    delete: EndpointFnOf<Def, 'delete', BaseRequestOptions, Trace>;\n    options: EndpointFnOf<Def, 'options', BaseRequestOptions, Trace>;\n    head: EndpointFnOf<Def, 'head', BaseRequestOptions, Trace>;\n    patch: EndpointFnOf<Def, 'patch', BaseRequestOptions, Trace>;\n    trace: EndpointFnOf<Def, 'trace', BaseRequestOptions, Trace>;\n}> : never : {}) & ProxyClient<{\n    [L in keyof Paths as L extends `/${K}${infer Rest}` ? Rest : never]: Paths[L];\n}, //\nBaseRequestOptions, [\n    Trace[0],\n    `${Trace[1]}/${K}`\n]>;\ntype Method = 'get' | 'post' | 'put' | 'delete' | 'options' | 'head' | 'patch' | 'trace';\ntype NoBodyMethod = 'get' | 'options' | 'head' | 'trace';\ntype GetOr<T, K extends string, Default = {}> = K extends keyof T ? T[K] : Default;\ntype GetRequestOption<RO extends RequestOptions, K extends keyof RequestOptions> = GetOr<RO, K>;\ntype QueryParameters<Def, _RO extends RequestOptions> = Def extends {\n    parameters: {\n        query?: {};\n    };\n} ? Def['parameters']['query'] : Def extends {\n    parameters: {\n        query: {};\n    };\n} ? Def['parameters']['query'] : never;\ntype HeadersLike = {\n    [H in Header]?: string | string[] | undefined;\n};\ntype HeaderParameters<Def, RO extends RequestOptions> = Def extends {\n    parameters: {\n        header: infer H;\n    };\n} ? SomeOptional<H, keyof GetRequestOption<RO, 'headers'>> & HeadersLike : HeadersLike;\ntype RequestBodyParameters<Def, M extends Method, RO extends RequestOptions> = Def extends {\n    requestBody?: infer RB;\n} ? RequestBodyInput<RB, M, RO> : {};\ntype CookieParameters<Def, _RO extends RequestOptions> = Get<Def, ['parameters', 'cookie'], Record<string, string>>;\ntype Get<T, Path extends Array<string | number>, Default = undefined> = Path extends [] ? T : Path extends [infer First extends string | number, ...infer Rest extends Array<string | number>] ? T extends {\n    [K in First]: infer V;\n} ? Get<V, Rest, Default> : Default : Default;\ntype AnyRequestBody = {\n    content?: {\n        [K in ContentType]?: unknown;\n    };\n};\ntype RequestOptionSerializer = {\n    key: string;\n    parse: (body: string) => unknown;\n    stringify: (body: unknown) => string;\n};\nexport type RequestOptions = {\n    baseUrl: string;\n    headers?: Record<string, string>;\n    /** default ['2XX'] */\n    acceptStatus?: AllowableStatusCode[];\n    serializers?: {\n        [K in ContentType]?: RequestOptionSerializer | null;\n    };\n};\ntype ShallowMerge<A, B> = {\n    [K in keyof A | keyof B]: K extends keyof B ? B[K] : K extends keyof A ? A[K] : never;\n};\ntype RequestOptionSerializerKey<S extends RequestOptions['serializers']> = S extends Record<infer _CT, {\n    key: infer Key;\n} | null | undefined> ? Extract<Key, string> : never;\ndeclare const defaultSerializers: {\n    readonly 'application/json': {\n        readonly key: \"json\";\n        readonly parse: (text: string, reviver?: (this: any, key: string, value: any) => any) => any;\n        readonly stringify: {\n            (value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string;\n            (value: any, replacer?: (number | string)[] | null, space?: string | number): string;\n        };\n    };\n    readonly 'text/plain': {\n        readonly key: \"text\";\n        readonly parse: (body: string) => string;\n        readonly stringify: StringConstructor;\n    };\n};\ntype DefaultSerializers = typeof defaultSerializers;\ntype GetRequestOptionSerializersByKey<RO extends RequestOptions> = ShallowMerge<DefaultSerializers, RO['serializers']> extends infer Serializers extends RequestOptions['serializers'] ? {\n    [K in RequestOptionSerializerKey<Serializers>]: Extract<{\n        [CT in keyof Serializers]: Serializers[CT] & {\n            contentType: CT;\n        };\n    }[keyof Serializers], //\n    {\n        key: K;\n    }>;\n} : never;\ntype RequestBodyInput<RB, M extends Method, Options extends RequestOptions> = M extends NoBodyMethod ? {} : RB extends {} ? {\n    content: Partial<GetOr<RB, 'content'>>;\n} | (GetRequestOptionSerializersByKey<Options> extends infer Serializers ? {\n    [K in keyof Serializers]?: Serializers[K] extends {\n        contentType: infer CT extends ContentType;\n    } ? RB extends {\n        content: {\n            [_CT in CT]: infer Shape;\n        };\n    } ? Shape : never : never;\n} : RB extends {\n    content: infer Content;\n} ? {\n    content: Content;\n} : AnyRequestBody) : AnyRequestBody;\ntype ResponseHeaders<R> = R extends {\n    headers: infer H;\n} ? H & Headers : 'no R does not extend header: infer R';\ntype Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;\ntype PositiveDigit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;\ntype StringDigit = `${Digit}`;\ntype LetterX = 'X';\ntype StatusCodeMatchable = `${PositiveDigit | LetterX}${StringDigit | LetterX}${StringDigit | LetterX}`;\ntype ResponseHelpers<Def, BaseRequestOptions extends RequestOptions, Params> = {\n    [S in AcceptedStatus<BaseRequestOptions, Params>]: {\n        [K in keyof GetRequestOptionSerializersByKey<BaseRequestOptions>]: Def['responses'][Extract<S, `${keyof Def['responses']}`>]['content'][GetRequestOptionSerializersByKey<BaseRequestOptions>[K]['contentType']];\n    } & {\n        headers: ResponseHeaders<Get<Def, ['responses', S], {\n            headers: unknown;\n        }>>;\n        statusMatch: S;\n        /** The raw `fetch` response object */\n        response: Response;\n        $def: Def;\n        $params: Params;\n    };\n}[AcceptedStatus<BaseRequestOptions, Params>];\ntype AcceptedStatus<BaseRequestOptions extends RequestOptions, Params> = Params extends {\n    acceptStatus: AllowableStatusCode[];\n} ? Params['acceptStatus'][number] : BaseRequestOptions['acceptStatus'] extends AllowableStatusCode[] ? BaseRequestOptions['acceptStatus'][number] : '200' | '201' | '202';\ntype EndpointFnParams<Def, M extends Method, RO extends RequestOptions, Trace extends [{}, string]> = RequestBodyParameters<Def, M, RO> & OptionalizeEmpties<{\n    query: QueryParameters<Def, RO>;\n    headers: HeaderParameters<Def, RO>;\n    cookie?: Partial<CookieParameters<Def, RO>>;\n    acceptStatus?: AllowableStatusCode[];\n    $types?: Pick<Trace[0], Extract<Trace[1], keyof Trace[0]>>;\n}>;\ntype OptionalizeEmpties<T> = Cleanup<{\n    [K in keyof T]: [T[K]] extends [never] ? never : {} extends NonNullable<T[K]> ? T[K] | undefined : T[K];\n}>;\ntype EndpointFn<Def, M extends Method, BaseRequestOptions extends RequestOptions, Trace extends [{}, string]> = EndpointFnParams<Def, M, BaseRequestOptions, Trace> extends infer Params ? {} extends Params ? <P extends Partial<Params>>(input?: Params & P) => Promise<ResponseHelpers<Def, BaseRequestOptions, P>> : <P extends Partial<Params>>(input: Params & P) => Promise<ResponseHelpers<Def, BaseRequestOptions, P>> : never;\ntype EndpointFnOf<Parent, M extends Method, BaseRequestOptions extends RequestOptions, Trace extends [{}, string]> = Parent extends {\n    [K in M]: infer D;\n} ? EndpointFn<D, M, BaseRequestOptions, Trace> : never;\nexport type Split<S extends string, Delimiter extends string> = S extends `${infer Start}${Delimiter}${infer End}` ? [Start, ...Split<End, Delimiter>] : [S];\ntype Root<Path extends string | number | symbol> = Path extends `/${infer X}` ? Split<X, '/'>[0] : never;\ntype SomeOptional<T, K extends string | number | symbol> = Partial<Pick<T, K & keyof T>> & Omit<T, K>;\ntype CommonStatusCodes = 200 | 201 | 202 | 204 | 301 | 302 | 304 | 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 502 | 503 | 504;\ntype AllowableStatusCode = CommonStatusCodes | StatusCodeMatchable | (number & {});\ntype CommonContentType = `application/json` | `application/x-www-form-urlencoded` | `multipart/form-data` | `text/plain` | `image/png` | `image/jpeg` | `image/webp` | `video/mp4` | `video/quicktime` | `video/x-ms-wmv` | `video/x-ms-asf` | `video/x-flv` | `video/avi` | `video/mov` | `video/wmv` | `video/3gpp` | `video/3gpp2` | `video/mp2t` | `video/mpeg`;\ntype ContentType = CommonContentType | (`${string}/${string}` & {});\ntype CommonHeaders = 'content-type' | 'accept' | 'user-agent' | 'authorization' | 'cookie' | 'set-cookie' | 'location' | 'content-length' | 'content-encoding' | 'content-language' | 'content-disposition' | 'content-range' | 'content-security-policy' | 'expires' | 'last-modified' | 'pragma' | 'cache-control' | 'if-none-match' | 'if-modified-since' | 'if-unmodified-since' | 'if-match' | 'if-range' | 'range' | 'etag' | 'date' | 'server' | 'age' | 'vary' | 'www-authenticate' | 'proxy-authenticate' | 'proxy-authorization' | 'refresh' | 'retry-after';\ntype Header = CommonHeaders | (string & {});\ntype NeverableKeys<T> = {\n    [K in keyof T]: [T[K]] extends [never] ? K : never;\n}[keyof T];\ntype UndefinedableKeys<T> = {\n    [K in keyof T]: undefined extends T[K] ? K : never;\n}[keyof T];\ntype NonUndefinedableKeys<T> = {\n    [K in keyof T]: T[K] extends {} | null ? K : never;\n}[keyof T];\n/**\n * Makes a type more ergonomic in a couple of opinionated ways:\n * - Drops keys whose value type is `never`\n * - Makes optional keys whose value type includes `undefined`\n *\n * @example\n * type Input = {a: 1; b: never; c: 3 | undefined}\n * type Output = Cleanup<Input> // equivalent to {a: 1; c?: 3}\n */\ntype Cleanup<T> = Pick<{\n    [K in keyof T]?: T[K];\n}, UndefinedableKeys<T>> & Pick<{\n    [K in keyof T]: T[K];\n}, Exclude<NonUndefinedableKeys<T>, NeverableKeys<T>>>;\nexport {};\n",
  },
  {
    name: 'client.js',
    content:
      "\"use strict\";\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.createProxyClient = void 0;\n/* eslint-disable @typescript-eslint/no-explicit-any */\n/* eslint-disable @typescript-eslint/no-unsafe-assignment */\n/* eslint-disable @typescript-eslint/no-unsafe-argument */\nconst createProxyClient = () => {\n    return {\n        configure: (options) => createProxyClientInner(options, []),\n    };\n};\nexports.createProxyClient = createProxyClient;\nconst createProxyClientInner = (options, segments) => {\n    options = {\n        ...options,\n        serializers: {\n            ...defaultSerializers,\n            ...options.serializers,\n        },\n    };\n    const method = (methodName) => async (input) => {\n        input ||= {};\n        const headers = new Headers({ ...options.headers, ...input.headers });\n        let body;\n        if ('json' in input) {\n            body = JSON.stringify(input.json);\n            headers.set('content-type', 'application/json');\n        }\n        else if (input.content) {\n            const [contentType, ...otherKeys] = Object.keys(input.content);\n            if (otherKeys.length > 0) {\n                throw new Error(`Multiple content types specified: ${Object.keys(input.content).join(', ')}`);\n            }\n            headers.set('content-type', contentType);\n            const content = input.content[contentType];\n            if (content instanceof Buffer) {\n                body = content;\n            }\n            else {\n                const serializer = options.serializers?.[contentType];\n                body = serializer ? serializer.stringify(content) : content;\n            }\n        }\n        let url = options.baseUrl;\n        if (segments.length > 0)\n            url += '/' + segments.join('/');\n        if (input.query)\n            url += `?${new URLSearchParams(input.query)}`;\n        const res = await fetch(url, { method: methodName, headers, body });\n        const acceptStatus = input.acceptStatus || options.acceptStatus || ['2XX'];\n        let text = undefined;\n        const statusMatch = await matchStatuses(acceptStatus);\n        text = await res.clone().text();\n        const partial = {\n            response: res,\n            $def: {},\n            $params: input,\n            statusMatch,\n            headers: res.headers,\n        };\n        async function matchStatuses(matches) {\n            const actualStatusDigits = res.status.toString().split('');\n            const match = matches.find(s => {\n                const expectedDigits = s.toLowerCase().split('');\n                return (expectedDigits.length === 3 &&\n                    expectedDigits.every((ch, i) => {\n                        return ch === 'x' || ch === actualStatusDigits[i];\n                    }));\n            });\n            if (!match) {\n                const message = `status code ${res.status} does not match any of the allowed status codes: ${matches.join(', ')}. text: ${text ?? (await res.clone().text())}`;\n                throw new Error(message, { cause: res });\n            }\n            return match;\n        }\n        function addSerializerGetters(obj) {\n            Object.entries(options.serializers).forEach(([contentType, serializer]) => {\n                const contentTypeFromHeader = res.headers.get('content-type')?.split(';')[0];\n                Object.defineProperty(obj, serializer.key, {\n                    enumerable: contentTypeFromHeader === contentType,\n                    get() {\n                        if (contentTypeFromHeader !== contentType) {\n                            throw new Error(`content-type header is ${contentTypeFromHeader}, so can't parse as ${contentType}`);\n                        }\n                        if (text === undefined) {\n                            throw new Error('text is undefined. did you override the fetch implementation?');\n                        }\n                        return serializer.parse(text);\n                    },\n                });\n            });\n        }\n        addSerializerGetters(partial);\n        return partial;\n    };\n    const methods = {\n        get: method('get'),\n        post: method('post'),\n        put: method('put'),\n        delete: method('delete'),\n        options: method('options'),\n        head: method('head'),\n        patch: method('patch'),\n        trace: method('trace'),\n    };\n    const definePathParamFn = (value) => {\n        return createProxyClientInner(options, [...segments.slice(0, -1), value]);\n    };\n    return new Proxy(Object.assign(definePathParamFn, methods), {\n        get(_, p) {\n            if (p === '$options')\n                return options;\n            if (p in methods)\n                return methods[p];\n            return createProxyClientInner(options, [...segments, p]);\n        },\n    });\n};\nconst defaultSerializers = {\n    'application/json': {\n        key: 'json',\n        parse: JSON.parse,\n        stringify: JSON.stringify,\n    },\n    'text/plain': {\n        key: 'text',\n        parse: body => body,\n        stringify: String,\n    },\n};\n",
  },
]
// codegen:end
