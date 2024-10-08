import Link from 'next/link'
import React from 'react'
import {toBreadcrumbs, type PathParams} from './params'
import {emoji, productionUrl} from '~/site-config'

// don't put these in a layout because layout is cached between routes. so it won't show the right breadcrumbs for child pages

export const Header = ({params}: {params: Partial<PathParams>}) => {
  const breadcrumbs = toBreadcrumbs(params)
  return (
    <header className="mb-6 border-b-2 border-amber-300/50 p-2 md:px-6 md:pt-4">
      <div className="flex items-center justify-between mb-4">
        <Link href="/" className="text-2xl font-bold hover:text-amber-300 transition-colors">
          {emoji} {productionUrl.hostname}
        </Link>
      </div>
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center space-x-2 text-sm">
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.path}>
              {index > 0 && <li className="text-amber-200/60">/</li>}
              <li>
                {crumb.path ? (
                  <Link href={crumb.path} className="hover:text-amber-300 transition-colors">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className={index === breadcrumbs.length - 1 ? 'text-amber-300' : 'text-amber-200/60'}>
                    {crumb.label}
                  </span>
                )}
              </li>
            </React.Fragment>
          ))}
        </ol>
      </nav>
    </header>
  )
}

export const Footer = () => {
  return (
    <footer className="mt-8 border-t-2 border-amber-300/50 text-sm text-amber-200/60 p-2 md:px-6 md:pb-6">
      <p>{productionUrl.hostname}</p>
    </footer>
  )
}

export declare namespace ArtifactViewPageTemplate {
  export type Props = {params: Partial<PathParams>; children: React.ReactNode}
}

export const ArtifactViewPageTemplate = ({params, children}: ArtifactViewPageTemplate.Props) => {
  return (
    <div className="flex flex-col h-full">
      <Header params={params} />
      <main className="flex-grow overflow-y-auto px-2 md:px-6 mx-auto w-full">{children}</main>
      <Footer />
    </div>
  )
}
