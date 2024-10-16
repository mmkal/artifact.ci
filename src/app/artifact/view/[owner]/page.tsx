import React from 'react'
import {SearchReposUI, SearchUI} from '../Search.server'
import {ArtifactViewPageTemplate} from '../nav'
import {PathParams} from '../params'
import {searchArtifacts, searchRepos} from '../search'

export default async function ArtifactViewPage({params}: {params: Partial<PathParams>}) {
  const results = await searchRepos(params)

  return (
    <ArtifactViewPageTemplate params={params}>
      <SearchReposUI results={results} />
    </ArtifactViewPageTemplate>
  )
}
