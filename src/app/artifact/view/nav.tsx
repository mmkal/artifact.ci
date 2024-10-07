import Link from 'next/link'
import React from 'react'
import {toBreadcrumbs, type PathParams} from './params'

export const Header = ({params}: {params: Partial<PathParams>}) => {
  const breadcrumbs = toBreadcrumbs(params)
  return (
    <header className="mb-6 border-b-2 border-amber-300/50 pb-2">
      <div className="flex items-center justify-between mb-4">
        <Link href="/" className="text-2xl font-bold hover:text-amber-300 transition-colors">
          🗿 artifact.ci
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
    <footer className="mt-8 pt-4 border-t-2 border-amber-300/50 text-sm text-amber-200/60">
      <p>artifact.ci</p>
    </footer>
  )
}

export declare namespace ArtifactViewPageTemplate {
  export type Props = {params: Partial<PathParams>; children: React.ReactNode}
}

export const ArtifactViewPageTemplate = ({params, children}: ArtifactViewPageTemplate.Props) => {
  return (
    <>
      <Header params={params} />
      {children}
      <Footer />
    </>
  )
}
