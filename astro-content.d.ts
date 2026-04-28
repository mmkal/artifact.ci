declare module 'astro:content' {
  export const z: typeof import('zod')
  export function defineCollection(config: any): any
  export type SchemaContext = any
}
