import React from 'react'
import {SearchReposUI} from '../Search.server'
import {ArtifactViewPageTemplate} from '../nav'
import {PathParams} from '../params'
import {searchRepos} from '../search'

export default async function ArtifactViewPage({params}: {params: Partial<PathParams>}) {
  const results = await searchRepos(params)

  return (
    <ArtifactViewPageTemplate params={params}>
      <SearchReposUI results={results} />
    </ArtifactViewPageTemplate>
  )
}
