import {useRouter} from 'next/router'

import posthog from 'posthog-js'
import {PostHogProvider} from 'posthog-js/react'
import {useEffect} from 'react'

export default function App({Component, pageProps}: {Component: React.ComponentType; pageProps: {}}) {
  const router = useRouter()

  // useEffect to check that PostHog is init'd client-side (used to handle Next.js SSR) https://github.com/PostHog/posthog-js/issues/1461
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST! || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      // Enable debug mode in development
      loaded: ph => {
        // if (process.env.NODE_ENV === 'development') ph.debug()
      },
    })
  }, [])
  useEffect(() => {
    // Track page views
    const handleRouteChange = () => posthog?.capture('$pageview')
    router.events.on('routeChangeComplete', handleRouteChange)

    return () => router.events.off('routeChangeComplete', handleRouteChange)
  }, [router.events])

  return (
    <PostHogProvider client={posthog}>
      <Component {...pageProps} />
    </PostHogProvider>
  )
}
