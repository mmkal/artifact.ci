/// <reference types="vite/client" />

declare module '*.css?url' {
  const href: string
  export default href
}
