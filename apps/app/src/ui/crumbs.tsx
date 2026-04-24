import {Fragment} from 'react'

export type Crumb = {label: string; path: string}

export function Crumbs({trail}: {trail: Crumb[]}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="crumbs">
        {trail.map((c, i) => {
          const last = i === trail.length - 1
          return (
            <Fragment key={c.path}>
              {i > 0 && <li className="crumbs__sep">/</li>}
              <li>
                {last ? <span className="crumbs__current">{c.label}</span> : <a href={c.path}>{c.label}</a>}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
