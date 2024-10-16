import React from 'react'
import {SearchUI} from '../../Search.server'
import {ArtifactViewPageTemplate} from '../../nav'
import {PathParams} from '../../params'
import {searchArtifacts} from '../../search'

export default async function ArtifactViewPage({params}: {params: Partial<PathParams>}) {
  const results = await searchArtifacts(params)

  return (
    <ArtifactViewPageTemplate params={params}>
      <SearchUI results={results} />
    </ArtifactViewPageTemplate>
  )
}
