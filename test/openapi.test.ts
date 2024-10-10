/* eslint-disable @typescript-eslint/no-unused-vars */
import {expectTypeOf} from 'expect-type'
import {createProxyClient} from '../src/openapi/client'
// import {paths as openaiPaths} from '../src/openapi/generated/openai'
// import {paths as petstorePaths} from '../src/openapi/generated/petstore'
import {paths as supabaseStoragePaths} from '../src/openapi/generated/supabase-storage'

const test = (title: string, fn: () => void | Promise<void>) => void title && fn

test('supabase-storage', async () => {
  const open = createProxyClient<supabaseStoragePaths>().configure({
    baseUrl: 'https://api.supabase.com/v1',
  })

  // @ts-expect-error no headers from the client - so must be added on the request
  await open.bucket.bucketId('abc').empty.post()
  // @ts-expect-error no headers from the client - so must be added on the request
  await open.bucket.bucketId('abc').empty.post({})
  // @ts-expect-error no headers from the client - so must be added on the request
  await open.bucket.bucketId('abc').empty.post({headers: undefined})
  // @ts-expect-error client doesn't have headers - so `authorization` must be added on the request
  await open.bucket.bucketId('abc').empty.post({headers: {}})
  // you can make requests when you remember the required headers
  await open.bucket.bucketId('abc').empty.post({headers: {authorization: 'Bearer abc', 'x-custom': '123'}})
  await open.bucket.bucketId('abc').empty.post({headers: {authorization: 'Bearer abc'}})
  // @ts-expect-error invalid headers
  await open.bucket.bucketId('abc').empty.post({headers: {authorization: ['Bearer xyz']}})

  const authed = createProxyClient<supabaseStoragePaths>().configure({
    baseUrl: 'https://api.supabase.com/v1',
    headers: {authorization: 'Bearer abc'},
  })

  await authed.bucket.bucketId('abc').empty.post()
  await authed.bucket.bucketId('abc').empty.post({})
  await authed.bucket.bucketId('abc').empty.post({headers: {}})
  await authed.bucket.bucketId('abc').empty.post({headers: undefined})
  // you can still override headers on the request, they will be shallow merged
  await authed.bucket.bucketId('abc').empty.post({headers: {authorization: 'Bearer xyz'}})
  await authed.bucket.bucketId('abc').empty.post({headers: {authorization: 'Bearer xyz', 'x-custom': '123'}})

  // make sure we can get the source types easily
  expectTypeOf(authed.bucket.bucketId('abc').empty.$types['/bucket/{bucketId}/empty']).toMatchTypeOf<{
    post: {parameters: {}} //
  }>()

  // @ts-expect-error invalid headers
  await authed.bucket.bucketId('abc').empty.post({headers: {authorization: ['Bearer xyz']}})

  await authed.object.bucketName('abc').delete({
    json: {prefixes: ['a', 'b']},
  })

  const res = await authed.bucket.bucketId('abc').empty.post({
    acceptStatus: ['200', '4XX'],
  })

  if (res.statusMatch === '200') {
    expectTypeOf(res.json).toEqualTypeOf<{message?: string}>()
    expectTypeOf(res.headers).toEqualTypeOf<{[name: string]: unknown} & Headers>()
  } else if (res.statusMatch === '4XX') {
    expectTypeOf(res.json).toEqualTypeOf<{error: string; statusCode: string; message: string}>()
  } else {
    expectTypeOf(res).toBeNever()
  }
})

test('abstract', () => {
  type sampleRequestBody = {
    content: {
      'application/xml': {x: 1}
      'application/json5': {x: 2}
    }
  }
  type sampleSerializers = {
    serializers: {
      'application/xml': {
        key: 'xml'
        parse: typeof JSON.parse
        stringify: typeof JSON.stringify
      }
      'application/json5': {
        key: 'json5'
        parse: typeof JSON.parse
        stringify: typeof JSON.stringify
      }
    }
  }
})
