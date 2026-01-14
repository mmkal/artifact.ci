import {source} from '~/lib/source'
import {DocsPage, DocsBody, DocsTitle, DocsDescription} from 'fumadocs-ui/page'
import {notFound} from 'next/navigation'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type {Metadata} from 'next'

interface PageProps {
  params: Promise<{slug?: string[]}>
}

export default async function Page(props: PageProps) {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDXContent = page.data.body

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug)
  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
  }
}
